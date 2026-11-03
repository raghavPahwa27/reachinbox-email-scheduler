import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/errors.js";

export function googleClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new HttpError(503, "Google OAuth is not configured.");
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALLBACK_URL,
  );
}
export { CodeChallengeMethod };
