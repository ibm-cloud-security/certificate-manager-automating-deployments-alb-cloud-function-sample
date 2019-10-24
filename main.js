const { promisify } = require('bluebird');
const request = promisify(require('request'));
const jwtVerify = promisify(require('jsonwebtoken').verify);

/* Prerequisites */

// The CRN-based instance ID of the Certificate Manager service instance.
const instanceCrn = "";

// An Service ID's API key with:
// - "Administrator" platform access policy to the cluster the certificate will be deployed to.
// - "Writer" service access policy to the Certificate Manager service instance the certificate is stored at.
const apiKey = "";

// The cluster ID.
const clusterId = "";

// The secret name as defined in your Ingress service.
const secretName = "";

// A Slack webhook and channel to send success/failure notifications to.
const slackWebhook = ""
const slackChannel = ""

const albSecretConfig

/* Functions */

// Get the public key from the Certificate Manager service instance in order to decode the notification payload.
async function getPublicKey(instanceCrn) {
    const encodedInstanceCrn = encodeURIComponent(instanceCrn);
    const region = instanceCrn.split(':')[5];

    const options = {
        method: "GET",
        json: true,
        url: `https://${region}.certificate-manager.cloud.ibm.com/api/v1/instances/${encodedInstanceCrn}/notifications/publicKey?keyFormat=pem`,
        headers: {
            "cache-control": "no-cache"
        }
    };

    const response = await request(options);
    if (response.statusCode !== 200) {
        throw new Error(`Couldn't get the public key for the provided instance. Reason is: status code ${response.statusCode} and body ${JSON.stringify(response.body)}.`);
    }

    return response.body.publicKey;
}

// Get valid access token and refresh token.
async function getTokens(apiKey) {
    const options = {
        method: "POST",
        json: true,
        url: `https://iam.cloud.ibm.com/identity/token?grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${apiKey}`,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json"
        }
    }

    const response = await request(options);
    if (response.statusCode !== "200") {
        console.error(`Couldn't get tokens from IBM Cloud IAM. Reason is: status code ${response.statusCode}.`);
        throw new Error(`Couldn't obtain tokens. Reason: status code ${response.statusCode}.`);
    }

    return {
        access_token: response.access_token,
        refresh_token: response.refresh_token
    }
}

// Update the Ingress Secret with the renewed certificate in the cluster using the ALB API.
async function deployCertificate(access_token, refresh_token, albSecretConfig) {
    const options = {
        method: "PUT",
        url: "https://containers.cloud.ibm.com/global/v1/alb/albsecrets",
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "X-Auth-Refresh-Token": `Bearer ${refresh_token}`
        },
        body: albSecretConfig
    }

    const response = await request(options);
    if (response.statusCode !== "204") {
        sendToSlack({
            text: `@channel ALB failed updating the certificate secret. Reason: statusCode: ${response.statusCode}`,
            color: danger,
            channel: slackChannel
        });

        throw new Error(`ALB failed updating the certificate secret. Reason: status code ${response.statusCode}.`);
    }
}

// Verify the update state of the Ingress Secret.
async function verifyDeployment(access_token, refresh_token, albSecretConfig) {
    const options = {
        method: "GET",
        url: "https://containers.cloud.ibm.com/global/v1/alb/albsecrets",
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "X-Auth-Refresh-Token": `Bearer ${refresh_token}`
        },
        body: albSecretConfig
    }

    const response = await request(options);
    if (response.statusCode !== "200") {
        sendToSlack({
            text: `@channel ALB failed updating the certificate secret. Reason: statusCode: ${response.statusCode}`,
            color: danger,
            channel: slackChannel
        });

        throw new Error(`ALB failed updating the certificate secret. Reason: status code ${response.statusCode}.`);
    } else if (response.albSecrets[0].state === "updated") {
        console.log(`ALB Secret updated in cluster ${clusterId}.`);
        sendToSlack({
            text: `@channel ALB Secret updated in cluster ${clusterId}.`,
            color: good,
            channel: slackChannel
        });
    } else {
        sendToSlack({
            text: `@channel ALB failed updating the certificate secret. Reason: statusCode: ${response.statusCode}`,
            color: danger,
            channel: slackChannel
        });

        throw new Error(`ALB failed updating the certificate secret. Reason: status code ${response.statusCode}.`);
    }
}

// Send a success/failure notification to the provided Slack channel.
async function sendToSlack(data) {
    const options = {
        url: slackWebhook,
        method: "POST",
        json: true,
        body: data
    };

    const response = await request(options);
    if (response.statusCode !== 200) {
        throw new Error(`Error occured when sending Slack message:` + JSON.stringify(response.body));
    }
}

/* Main */
async function main(params) {
    try {
        // Decode the notification payload using the Certificate Manager service instance's public key.
        const publicKey = await getPublicKey(instanceCrn);
        const decodedNotificationPayload = await jwtVerify(params.data, publicKey);
        const albSecretConfig = {
            "certCrn": decodedNotificationPayload.certificates[0].cert_crn,
            "clusterID": clusterId,
            "secretName": secretName
        }

        // Check for the "cert_renewed" certificate lifecycle event type.
        if (decodedNotificationPayload.event_type === "cert_renewed") {
            // Get required tokens.
            const { access_token, refresh_token } = await getTokens(apiKey);

            // Deploy the renewed certificate to the cluster.
            await deployCertificate(access_token, refresh_token, albSecretConfig);

            // Wait 1 minute to allow the Ingress controller to finalize deployment, and then verify the deployment's state.
            setTimeout(() => {
                await verifyDeployment(access_token, refresh_token, albSecretConfig);
            }, 60000);
        }
    } catch (err) {
        console.log(`Action failed.Reason: ${err}`);
        return Promise.reject({
            statusCode: err.statusCode ? err.statusCode : 500,
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                message: err.message ? err.message : "Error processing your request."
            },
        });
    } return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json"
        },
        body: {}
    };
}
