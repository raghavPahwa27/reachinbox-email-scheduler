import { z } from "zod";
import { env } from "../../config/env.js";
import { SlackOAuthError, safeSlackErrorCode } from "./errors.js";

export const SLACK_SCOPES = "chat:write";
export const slackChannelSchema = z
  .string()
  .trim()
  .regex(
    /^[CG][A-Z0-9]{8,31}$/,
    "Enter the Slack channel ID from the channel details (starts with C or G).",
  );

export async function exchangeSlackCode(code: string, redirectUri: string) {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.SLACK_CLIENT_ID}:${env.SLACK_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await response.json();
  const envelope = z
    .object({ ok: z.boolean(), error: z.unknown().optional() })
    .safeParse(body);
  if (envelope.success && !envelope.data.ok)
    throw new SlackOAuthError(
      safeSlackErrorCode(envelope.data.error),
      response.status,
    );
  if (!response.ok)
    throw new SlackOAuthError("slack_http_error", response.status);
  const result = z
    .object({
      ok: z.literal(true),
      access_token: z.string().min(1),
      token_type: z.literal("bot"),
      scope: z.string(),
      team: z.object({ id: z.string().min(1), name: z.string().nullish() }),
    })
    .safeParse(body);
  if (!result.success)
    throw new SlackOAuthError(
      "invalid_token_response",
      response.status,
      result.error.issues.map((issue) => issue.path.join(".")),
    );
  if (
    !result.data.scope
      .split(",")
      .map((scope) => scope.trim())
      .includes("chat:write")
  )
    throw new SlackOAuthError("missing_scope", response.status);
  return result.data;
}
