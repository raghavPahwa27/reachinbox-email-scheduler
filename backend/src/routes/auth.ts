import { randomBytes, createHash } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { HttpError } from "../middleware/errors.js";
import {
  googleClient,
  CodeChallengeMethod,
} from "../integrations/google/oauth.js";
import { requireAuth, safeEqual, isAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import {
  googleOAuthFailureReason,
  type GoogleOAuthStage,
} from "../integrations/google/errors.js";

export const authRouter = Router();
export const saveSession = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
const regenerate = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
const random = () => randomBytes(32).toString("base64url");

authRouter.get("/csrf", async (req, res) => {
  req.session.csrfToken ??= random();
  await saveSession(req);
  res.json({ data: { csrfToken: req.session.csrfToken } });
});
async function loginRateLimit(identity: string) {
  const key = `reachinbox:password-attempt:${createHash("sha256").update(identity).digest("hex")}`;
  const count = (await redis.eval(
    "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 900) end; return n",
    1,
    key,
  )) as number;
  if (count > 10)
    throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
}
authRouter.post("/login", async (req, res) => {
  const input = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(1).max(128),
    })
    .parse(req.body);
  await loginRateLimit(`ip:${req.ip}`);
  await loginRateLimit(`email:${input.email}`);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (
    !(await verifyPassword(input.password, user?.passwordHash ?? null)) ||
    !user
  )
    throw new HttpError(
      401,
      "Email or password is incorrect. You can also sign in with Google.",
    );
  await regenerate(req);
  req.session.userId = user.id;
  req.session.csrfToken = random();
  await saveSession(req);
  res.json({ data: { signedIn: true } });
});
authRouter.post("/password", requireAuth, async (req, res) => {
  const input = z
    .object({
      password: z.string().min(12).max(128),
      currentPassword: z.string().max(128).optional(),
    })
    .parse(req.body);
  await loginRateLimit(`password:${req.user!.id}`);
  if (
    req.user!.passwordHash &&
    !(await verifyPassword(input.currentPassword ?? "", req.user!.passwordHash))
  )
    throw new HttpError(400, "Current password is incorrect.");
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash: await hashPassword(input.password) },
  });
  res.json({ data: { saved: true } });
});

authRouter.get("/google", async (req, res) => {
  const client = googleClient();
  const verifier = random();
  const nonce = random();
  const state = random();
  req.session.googleOAuth = {
    state,
    nonce,
    verifier,
    expiresAt: Date.now() + 10 * 60_000,
  };
  await saveSession(req);
  res.redirect(
    client.generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }),
  );
});
authRouter.get("/google/callback", async (req, res) => {
  let stage: GoogleOAuthStage = "session";
  try {
    const pending = req.session.googleOAuth;
    delete req.session.googleOAuth;
    await saveSession(req); // Consume state even when provider rejects consent.
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
      pending.expiresAt < Date.now() ||
      !safeEqual(query.state, pending.state)
    )
      throw new Error("Invalid OAuth state");
    stage = "provider";
    if (query.error) throw query.error;
    if (!query.code) throw new Error("Missing authorization code");
    stage = "exchange";
    const client = googleClient();
    const { tokens } = await client.getToken({
      code: query.code,
      codeVerifier: pending.verifier,
    });
    if (!tokens.id_token) throw new Error("Missing Google ID token");
    stage = "verify";
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    stage = "profile";
    const profile = ticket.getPayload();
    if (
      !profile?.sub ||
      !profile.email ||
      !profile.email_verified ||
      !safeEqual(
        (profile as typeof profile & { nonce?: string }).nonce,
        pending.nonce,
      )
    )
      throw new Error("Invalid Google profile");
    stage = "database";
    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      create: {
        googleId: profile.sub,
        email: profile.email.toLowerCase(),
        name: profile.name ?? profile.email,
        avatar: profile.picture ?? null,
      },
      update: {
        email: profile.email.toLowerCase(),
        name: profile.name ?? profile.email,
        avatar: profile.picture ?? null,
      },
    });
    stage = "session";
    await regenerate(req); // Prevent session fixation after authentication.
    req.session.userId = user.id;
    req.session.csrfToken = random();
    await saveSession(req);
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    const reason = googleOAuthFailureReason(stage, error);
    logger.warn({ stage, reason }, "Google OAuth callback failed");
    res.redirect(
      `${env.FRONTEND_URL}/login?oauthError=google&reason=${reason}`,
    );
  }
});
authRouter.get("/me", requireAuth, async (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = random();
    await saveSession(req);
  }
  const { id, name, email, avatar } = req.user!;
  res.json({
    data: {
      user: { id, name, email, avatar },
      hasPassword: !!req.user!.passwordHash,
      isAdmin: isAdmin(email),
      csrfToken: req.session.csrfToken,
      senderDefaults: {
        hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        minDelaySeconds: env.MIN_DELAY_SECONDS,
        maxHourlyLimit: env.SYSTEM_MAX_EMAILS_PER_HOUR,
      },
    },
  });
});
authRouter.post("/logout", requireAuth, async (req, res) => {
  await new Promise<void>((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
  res.clearCookie("reachinbox.sid", {
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.json({ data: { loggedOut: true } });
});
