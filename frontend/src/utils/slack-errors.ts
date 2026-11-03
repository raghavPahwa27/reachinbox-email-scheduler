const messages: Record<string, string> = {
  bad_client_secret:
    "Slack rejected the app credentials. The app administrator must check the client secret.",
  invalid_client_id:
    "Slack did not recognize this app. The app administrator must check the client ID.",
  bad_redirect_uri:
    "Slack rejected the return address. The app administrator must check the registered redirect URL.",
  invalid_oauth_state:
    "Your connection attempt expired or belongs to another session. Start Connect Slack again.",
  invalid_code:
    "Slack rejected this authorization attempt. Start Connect Slack again.",
  code_already_used:
    "This authorization was already used. Start Connect Slack again.",
  access_denied: "Slack authorization was cancelled or denied.",
  missing_scope:
    "Slack did not grant permission to post messages. Check the app’s chat:write bot scope and reconnect.",
  invalid_token_response:
    "Slack returned an incomplete bot authorization. Check the app configuration and reconnect.",
  missing_channel: "Choose a Slack channel ID and start Connect Slack again.",
  redirect_configuration_changed:
    "The app configuration changed during authorization. Start Connect Slack again.",
  database_failed:
    "Slack authorized the app, but the connection could not be saved. Please try again.",
  encryption_failed:
    "The connection could not be stored securely. Please contact the app administrator.",
  token_exchange_failed:
    "Slack could not be reached to complete authorization. Please try again.",
  session_failed:
    "Your connection session could not be saved. Please try again.",
  slack_http_error: "Slack returned a service error. Please try again.",
  ratelimited:
    "Slack has temporarily limited requests. Please wait and try again.",
  invalid_scope:
    "The app requested an unsupported Slack permission. Please contact the app administrator.",
  invalid_team_for_non_distributed_app:
    "This Slack app cannot be installed in the selected workspace. Check its distribution settings.",
};
export function slackErrorMessage(code: string | null): string {
  return code && Object.hasOwn(messages, code)
    ? `${messages[code]} (Slack: ${code})`
    : "Slack could not be connected. The backend log contains a safe error category for the app administrator.";
}
