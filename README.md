# Automating deployments using IBM Cloud's Kubernetes Service Application Load Balancer (ALB) API
This sample demonstrates:

- How to detect the `cert_renewed` certificate lifecycle event
- How to update a Kubernetes cluster's Ingress host Secret resource with the renewed certificate using Kubernetes Service's ALB API

The sample uses an IBM Cloud Functions action to execute the ALB API. You can also choose to implement this automation using the IBM Cloud CLI in a CI system such as Jenkins, Travis and others.

> **Important:** This implementation requires you to have previously used ALB, either via CLI or API, to setup your Ingress service with a Secret that uses an ordered certificate prior to its renewal. To learn more about using ALB CLI commands or API, refer to the [IBM Cloud Kubernetes Service documentation](https://cloud.ibm.com/docs/containers?topic=containers-ingress-about).

> **Important:** for demonstration purposes the sample handles a scenario of 1 cluster with an Ingress service that handles 1 host. If your topology uses more than 1 cluster and host, you will need to modify the Cloud Function action, eg:
>
> 1. Use a mapping of clusters to certificate CRNs
> 2. Use a loop to go over each cluster and update the certificates

## Prerequisites
1. An instance of [Certificate Manager](https://cloud.ibm.com/docs/services/certificate-manager).
2. A [Kubernetes Service](https://cloud.ibm.com/docs/containers?topic=containers-getting-started) Classic flavored cluster.

> **Note:** Both the Kubernetes cluster and the Certificate Manager service instance must be located in the same IBM Cloud account.

## Configuration
### Access policies
Create a Service ID and assign it the **Writer** service access policy for the Certificate Manager service instance and the **Administrator** platform policy for the Kubernetes cluster that you're working with.

1. In the IBM Cloud dashboard, click **Manage > Access (IAM) > Service IDs**.
2. Select a service ID or create a new one. Click the set of credentials to open the management screen.
3. Click **Access Policies > Assign access > Assign access to resources**.
4. Select Certificate Manager from the list of services. Provide the needed information and click the **Writer** checkbox.
5. Click **Save**.
6. In the list of services, select the Kubernetes cluster. Provide the needed information and click the **Administrator** checkbox.
7. Click **Save**.

Create an API key for the Service ID. You will use the API key in the sample code.

1. Click **API keys**.
2. Click **Create**.
3. Provide a Name and click **Create**.
4. Copy the generated value.

### IBM Cloud Function action
1. Create a new [IBM Cloud Function action](https://cloud.ibm.com/docs/openwhisk/index.html#openwhisk_start_hello_world)
   
   * In IBM Cloud Functions, select **Actions** from the sidebar
   * Click on **Create**
   * Follow the on-screen instructions
   
2. Deploy the sample
   
   * Select **Code** from the sidebar, and paste the contents of the **main.js** file from this repository

3. [Bind parameters to the action](https://cloud.ibm.com/docs/openwhisk/parameters.html#default-params-action) 

   Select **Parameters** from the sidebar, and add the following:
   
   | Property | Description |
   |----------|-------------|
   | `instanceCrn` | The CRN-based instance ID of your Certificate Manager service instance. |
   | `apiKey` | Your Service ID's API key. |
   | `clusterId` | Your Cluster ID. |
   | `secretName` | The secret name as defined in your Ingress YAML file. |
   | `slackWebhook` | A Slack webhook used to send Slack notifications. |
   | `slackChannel` | The Slack channel name where notifications will be sent to. |
  
3. Select **Endpoints** from the sidebar, and tick the **Enable as Web Action** checkbox and click **Save**.
 
 ### IBM Cloud Certificate Manager
1. From the Cloud Function -> Endpoints screen, copy the Web Action URL
2. In Certificate Manager, click on **Notifications** in the sidebar
   * Click **Add Notification Channel**
   * From the **Channel Type** dropdown select **Callback URL**
   * Paste the copied Web Action URL to the **Channel Endpoint** input field
   * Change the `.json` suffix to `.http` in the endpoint URL
   * Click the **Save** (disk icon)

## Testing
After you have finished configuring your notification channel and Cloud Function action, you can optionally click on **Test Connection** from the channel menu. The test will send a test notification payload to your endpoint. 

> **Note:** You can also extend the sample by calling a CI system, eg a Jenkins job, that will use the ALB API or CLI commands to verify that the renewed certificate is being used by the Ingress controller.

## More information
- [Certificate Manager API docs](https://cloud.ibm.com/apidocs/certificate-manager)
- [Event types and notification payloads](https://cloud.ibm.com/docs/services/certificate-manager?topic=certificate-manager-event-types-payload-versions)
