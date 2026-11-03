import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";
const options = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  connectTimeout: 5000,
  retryStrategy: (attempt: number) => Math.min(attempt * 250, 5000),
};
export const redis = new Redis({
  ...options,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
redis.on("error", (err) =>
  logger.warn({ err: err.message }, "Redis connection error"),
);
export function createWorkerConnection() {
  const connection = new Redis({ ...options, maxRetriesPerRequest: null });
  connection.on("error", (err) =>
    logger.warn({ err: err.message }, "Worker Redis connection error"),
  );
  return connection;
}
