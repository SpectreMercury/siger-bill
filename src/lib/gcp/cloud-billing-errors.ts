export interface CloudBillingApiErrorInfo {
  code: 'CLOUD_BILLING_API_DISABLED' | 'GCP_BILLING_API_ERROR';
  message: string;
}

function extractGoogleErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message || body;
  } catch {
    return body;
  }
}

export function formatCloudBillingApiError(
  statusCode: number,
  body: string,
  quotaProjectId?: string | null
): CloudBillingApiErrorInfo {
  const message = extractGoogleErrorMessage(body);
  const projectLabel = quotaProjectId || '<project-id>';

  if (
    statusCode === 403 &&
    /Cloud Billing API has not been used in project .* before or it is disabled/i.test(message)
  ) {
    return {
      code: 'CLOUD_BILLING_API_DISABLED',
      message:
        `Cloud Billing API is not enabled for quota project ${projectLabel}. ` +
        `Enable Cloud Billing API with: gcloud services enable cloudbilling.googleapis.com --project=${projectLabel}`,
    };
  }

  return {
    code: 'GCP_BILLING_API_ERROR',
    message: `GCP Billing API returned ${statusCode}: ${message.slice(0, 200)}`,
  };
}
