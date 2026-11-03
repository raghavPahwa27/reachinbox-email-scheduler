import { app } from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";
import { prisma } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { emailQueue, indexQueue, slackQueue } from "./queues/index.js";
import { reconcile } from "./services/reconcile.js";

let recovering = false;
const recover = async () => {
  if (recovering) return;
  recovering = true;
  try {
    await reconcile();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Reconciliation deferred; run npm run reconcile after services recover",
    );
  } finally {
    recovering = false;
  }
};
redis.on("ready", () => void recover());
if (redis.status === "ready") void recover();
const server = app.listen(env.PORT, () =>
  logger.info({ port: env.PORT }, "API listening"),
);
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "Stopping API");
  const deadline = setTimeout(() => process.exit(1), 15_000).unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([
    emailQueue.close(),
    indexQueue.close(),
    slackQueue.close(),
    prisma.$disconnect(),
  ]);
  await redis.quit().catch(() => redis.disconnect());
  clearTimeout(deadline);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
