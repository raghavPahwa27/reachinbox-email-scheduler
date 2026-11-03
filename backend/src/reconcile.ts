import { reconcile } from "./services/reconcile.js";
import { closeQueues } from "./queues/index.js";
import { prisma } from "./config/db.js";
import { redis } from "./config/redis.js";
import { logger } from "./utils/logger.js";
try {
  await reconcile();
  logger.info("Queue and search reconciliation finished");
} catch (error) {
  logger.error({ err: error }, "Reconciliation failed");
  process.exitCode = 1;
} finally {
  await closeQueues();
  redis.disconnect();
  await prisma.$disconnect();
}
