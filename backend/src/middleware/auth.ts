import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { HttpError } from "./errors.js";

export function safeEqual(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export const requireAuth: RequestHandler = async (req, _res, next) => {
  if (!req.session.userId)
    throw new HttpError(401, "Please sign in.", "UNAUTHENTICATED");
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
  });
  if (!user)
    throw new HttpError(401, "Your session has expired.", "UNAUTHENTICATED");
  req.user = user;
  next();
};
export function isAdmin(email: string): boolean {
  return env.ADMIN_EMAILS.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user || !isAdmin(req.user.email))
    throw new HttpError(403, "Administrator access is required.", "FORBIDDEN");
  next();
};
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (!safeEqual(req.get("X-CSRF-Token"), req.session.csrfToken))
    throw new HttpError(
      403,
      "Your session has changed. Refresh and try again.",
      "CSRF_INVALID",
    );
  next();
};
// bull-board's UI cannot send the application CSRF header. Require an exact same-site
// Origin on all board mutations, in addition to authenticated administrator access.
export const requireBoardOrigin: RequestHandler = (req, _res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const allowed = new Set([
      new URL(env.FRONTEND_URL).origin,
      new URL(env.GOOGLE_CALLBACK_URL).origin,
    ]);
    if (!req.get("Origin") || !allowed.has(req.get("Origin")!))
      throw new HttpError(403, "Invalid request origin.", "CSRF_INVALID");
  }
  next();
};
