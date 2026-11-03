import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { encrypt } from "../utils/crypto.js";
import { safeEqual } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { saveSession } from "./auth.js";
import { logger } from "../utils/logger.js";
import {
  SlackOAuthError,
  safeSlackErrorCode,
} from "../integrations/slack/errors.js";

import {
  exchangeSlackCode,
  slackChannelSchema,
  SLACK_SCOPES,
} from "../integrations/slack/oauth.js";

export const slackRouter = Router();
slackRouter.get("/connect", async (req, res) => {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET)
    throw new HttpError(503, "Slack OAuth is not configured.");
  const channelId = slackChannelSchema.parse(req.query.channelId);
  const state = randomBytes(32).toString("base64url");
  req.session.slackOAuth = {
    state,
    userId: req.user!.id,
    channelId,
    redirectUri: env.SLACK_REDIRECT_URI,
    expiresAt: Date.now() + 10 * 60_000,
  };
  await saveSession(req);
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: SLACK_SCOPES,
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  }).toString();
  res.redirect(url.toString());
});
slackRouter.get("/callback", async (req, res) => {
  let stage = "session";
  try {
    const pending = req.session.slackOAuth;
    delete req.session.slackOAuth;
    await saveSession(req);
    stage = "state";
    const query = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1),
        error: z.string().optional(),
      })
      .parse(req.query);
    if (
      !pending ||
      pending.userId !== req.user!.id ||
      pending.expiresAt < Date.now() ||
      !safeEqual(query.state, pending.state)
    )
      throw new SlackOAuthError("invalid_oauth_state");
    stage = "authorization";
    if (query.error) throw new SlackOAuthError(safeSlackErrorCode(query.error));
    if (!query.code) throw new SlackOAuthError("missing_authorization_code");
    stage = "token_exchange";
    if (pending.redirectUri !== env.SLACK_REDIRECT_URI)
      throw new SlackOAuthError("redirect_configuration_changed");
    const channel = slackChannelSchema.safeParse(pending.channelId);
    if (!channel.success) throw new SlackOAuthError("missing_channel");
    const result = await exchangeSlackCode(query.code, pending.redirectUri);
    stage = "encryption";
    const data = {
      accessTokenEncrypted: encrypt(result.access_token),
      teamId: result.team.id,
      teamName: result.team.name || result.team.id,
      channelId: channel.data,
      connectedAt: new Date(),
    };
    stage = "database";
    await prisma.slackIntegration.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, ...data },
      update: data,
    });
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (error) {
    const code =
      error instanceof SlackOAuthError
        ? error.code
        : stage === "state"
          ? "invalid_oauth_state"
          : `${stage}_failed`;
    logger.warn(
      {
        stage,
        code,
        ...(error instanceof SlackOAuthError
          ? { httpStatus: error.httpStatus, fields: error.fields }
          : {}),
      },
      "Slack OAuth callback failed",
    );
    res.redirect(
      `${env.FRONTEND_URL}/dashboard?oauthError=slack&slackError=${code}`,
    );
  }
});
slackRouter.get("/status", async (req, res) => {
  const integration = await prisma.slackIntegration.findUnique({
    where: { userId: req.user!.id },
    select: { teamName: true, channelId: true, connectedAt: true },
  });
  res.json({
    data: integration
      ? { connected: true, ...integration }
      : { connected: false },
  });
});
slackRouter.post("/disconnect", async (req, res) => {
  // Remove only this user's credential. Revoking a shared workspace bot token could
  // break another user's installation of the same Slack app.
  await prisma.slackIntegration.deleteMany({ where: { userId: req.user!.id } });
  res.json({ data: { connected: false } });
});
