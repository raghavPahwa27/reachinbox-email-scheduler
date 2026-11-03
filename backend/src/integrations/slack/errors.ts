// Only documented/fixed codes may enter logs or redirect URLs. Never log the
// raw Slack response: successful responses contain bot and webhook credentials.
const safeCodes = new Set([
  "access_denied",
  "accesslimited",
  "account_inactive",
  "bad_client_secret",
  "bad_redirect_uri",
  "cannot_install_an_org_installed_app",
  "deprecated_endpoint",
  "ekm_access_denied",
  "enterprise_is_restricted",
  "fatal_error",
  "internal_error",
  "invalid_arg_name",
  "invalid_arguments",
  "invalid_array_arg",
  "invalid_auth",
  "invalid_charset",
  "invalid_client_id",
  "invalid_code",
  "invalid_form_data",
  "invalid_grant_type",
  "invalid_scope",
  "invalid_team_for_non_distributed_app",
  "missing_post_type",
  "missing_scope",
  "no_bot_scopes_requested",
  "not_allowed_token_type",
  "org_login_required",
  "ratelimited",
  "request_timeout",
  "service_unavailable",
  "team_access_not_granted",
  "token_revoked",
  "too_many_redirect_uris",
  "unknown_error",
  "code_already_used",
  "unsupported_grant_type",
]);
export function safeSlackErrorCode(value: unknown): string {
  return typeof value === "string" && safeCodes.has(value)
    ? value
    : "unknown_slack_error";
}
export class SlackOAuthError extends Error {
  constructor(
    public code: string,
    public httpStatus?: number,
    public fields?: string[],
  ) {
    super("Slack OAuth failed");
  }
}
