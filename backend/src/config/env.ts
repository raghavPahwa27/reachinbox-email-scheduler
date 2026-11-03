import "dotenv/config";
import { z } from "zod";
const optional = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: optional,
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3001/api/auth/google/callback"),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (s) => Buffer.from(s, "base64").length === 32,
      "Must be a base64-encoded 32-byte key",
    ),
  ETHEREAL_HOST: z
    .literal("smtp.ethereal.email")
    .default("smtp.ethereal.email"),
  ETHEREAL_PORT: z.coerce
    .number()
    .refine((p) => p === 587 || p === 465)
    .default(587),
  ETHEREAL_USER: optional,
  ETHEREAL_PASS: optional,
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  SLACK_REDIRECT_URI: z
    .string()
    .url()
    .default("http://localhost:3001/api/slack/callback"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MIN_DELAY_SECONDS: z.coerce.number().int().min(0).max(86400).default(2),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
  SYSTEM_MAX_EMAILS_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1000),
  ADMIN_EMAILS: z.string().default(""),
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
});
export const env = schema.parse(process.env);
if (env.MAX_EMAILS_PER_HOUR_PER_SENDER > env.SYSTEM_MAX_EMAILS_PER_HOUR)
  throw new Error("Default hourly limit exceeds system maximum");
if (env.NODE_ENV === "production" && !env.FRONTEND_URL.startsWith("https://"))
  throw new Error("Production requires HTTPS FRONTEND_URL");
