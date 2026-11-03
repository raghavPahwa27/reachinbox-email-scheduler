export type GoogleOAuthStage =
  | "session"
  | "state"
  | "provider"
  | "exchange"
  | "verify"
  | "profile"
  | "database";

/** Return only fixed categories. Provider errors can contain tokens and request bodies. */
export function googleOAuthFailureReason(
  stage: GoogleOAuthStage,
  error: unknown,
): string {
  if (stage === "state") return "session_expired";
  if (stage === "session") return "session_unavailable";
  if (stage === "database") return "storage_unavailable";
  if (stage === "verify" || stage === "profile") return "profile_invalid";
  if (stage === "provider")
    return error === "access_denied" ? "cancelled" : "provider_error";
  const failure = error as { response?: { data?: { error?: unknown } } } | null;
  const code = failure?.response?.data?.error;
  if (
    code === "invalid_client" ||
    code === "unauthorized_client" ||
    code === "deleted_client"
  )
    return "client_configuration";
  if (code === "redirect_uri_mismatch") return "redirect_configuration";
  if (code === "invalid_grant") return "authorization_expired";
  return "provider_error";
}
