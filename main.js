const {promisify} = require('bluebird');
const request = promisify(require('request'));
const jwtVerify = promisify(require('jsonwebtoken').verify);


/**
 * Replying error response.
 * @param err
 * @returns {{headers: {"Content-Type": string}, body: {message: string}, statusCode: *}}
 */
function replyError(err) {
    console.log(`Action failed.Reason: ${JSON.stringify(err)}`);
    return {
        statusCode: err.statusCode ? err.statusCode : 500,
        headers: {
            "Content-Type": "application/json"
        },
        body: {
            message: err.message ? err.message : "Error processing your request."
        },
    };
}

/**
 * Replying success response.
 * @returns {{headers: {"Content-Type": string}, body: {}, statusCode: number}}
 */
function replySuccess() {
    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json"
        },
        body: {}
    };
}

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
    };

    const response = await request(options);

    if (response.statusCode !== 200) {
        console.error(`Couldn't get tokens from IBM Cloud IAM. Reason is: status code ${response.statusCode}.`);
        throw {statusCode: 500, message: `Couldn't obtain tokens. Reason: status code ${response.statusCode}.`};
    }

    return {
        access_token: response.body.access_token,
        refresh_token: response.body.refresh_token
    }
}

// Update the Ingress Secret with the renewed certificate in the cluster using the ALB API.
async function deployCertificate(access_token, refresh_token, albSecretConfig) {
    const options = {
        method: "PUT",
        url: "https://containers.cloud.ibm.com/global/v1/alb/albsecrets",
        json: true,
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "X-Auth-Refresh-Token": `Bearer ${refresh_token}`
        },
        body: albSecretConfig
    };

    return await request(options);
}

// Send a success/failure notification to the provided Slack channel.
async function sendToSlack(slackWebHook, data) {
    const options = {
        url: slackWebHook,
        method: "POST",
        json: true,
        body: data
    };

    const response = await request(options);
    if (response.statusCode !== 200) {
        throw new Error(`Error occurred when sending Slack message:` + JSON.stringify(response.body));
    }
}

/* Main */
async function main(params) {
    try {
        // Decode the notification payload using the Certificate Manager service instance's public key.
        const publicKey = await getPublicKey(params.instanceCrn);
        const decodedNotificationPayload = await jwtVerify(params.data, publicKey);
        const albSecretConfig = {
            "certCrn": decodedNotificationPayload.certificates[0].cert_crn,
            "clusterID": params.clusterId,
            "secretName": params.secretName
        };

        // Check for the "cert_renewed" certificate lifecycle event type.
        if (decodedNotificationPayload.event_type === "cert_renewed") {
            // Get required tokens.
            const {access_token, refresh_token} = await getTokens(params.apiKey);

            // Deploy the renewed certificate to the cluster.
            const response = await deployCertificate(access_token, refresh_token, albSecretConfig);

            if (response.statusCode !== 204) {
                await sendToSlack(params.slackWebHook, {
                    text: `@channel ALB failed updating the certificate secret. Reason: statusCode: ${response.statusCode}`,
                    color: '#FF3D00',
                    channel: params.slackChannel
                });

                return replyError({
                    statusCode: response.statusCode,
                    message: `ALB failed updating the certificate secret. Reason: status code ${response.statusCode}, body: ${JSON.stringify(response.body)}.`
                });
            } else {
                console.log('Update ALB request accepted successfully.')
                // Verify the deployment - it may take up to 1 minute to be deployed.
            }
        }
    } catch (err) {
        return replyError(err);
    }
    return replySuccess();
}
