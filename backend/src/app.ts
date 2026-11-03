import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import cors from "cors";
import helmet from "helmet";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";
import { prisma } from "./config/db.js";
import { authRouter } from "./routes/auth.js";
import { slackRouter } from "./routes/slack.js";
import { sendersRouter } from "./routes/senders.js";
import { emailsRouter } from "./routes/emails.js";
import {
  requireAuth,
  requireAdmin,
  requireCsrf,
  requireBoardOrigin,
} from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import { emailQueue, indexQueue, slackQueue } from "./queues/index.js";

export const app = express();
app.disable("x-powered-by");
if (env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: new URL(env.FRONTEND_URL).origin,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
  }),
);
app.use(express.json({ limit: "20mb" }));
app.get("/health", (_req, res) => res.json({ data: { status: "ok" } }));
app.get("/health/ready", async (_req, res) => {
  await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
  res.json({ data: { status: "ready" } });
});
app.use(
  session({
    name: "reachinbox.sid",
    store: new RedisStore({ client: redis, prefix: "reachinbox:session:" }),
    secret: env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60_000,
    },
  }),
);
app.use(
  "/api",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
  requireCsrf,
);
app.use("/api/auth", authRouter);
app.use("/api/senders", requireAuth, sendersRouter);
app.use("/api/emails", requireAuth, emailsRouter);
app.use("/api/slack", requireAuth, slackRouter);
const board = new ExpressAdapter();
board.setBasePath("/admin/queues");
createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(indexQueue),
    new BullMQAdapter(slackQueue),
  ],
  serverAdapter: board,
});
app.use(
  "/admin/queues",
  requireAuth,
  requireAdmin,
  requireBoardOrigin,
  board.getRouter(),
);
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { message: "Endpoint not found.", code: "NOT_FOUND" } });
});
app.use(errorHandler);
