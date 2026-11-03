import pino from "pino";
export const logger = pino({
  redact: [
    "password",
    "smtpPassword",
    "accessToken",
    "accessTokenEncrypted",
    "smtpPasswordEncrypted",
    "req.headers.cookie",
    "req.headers.authorization",
  ],
  level: process.env.NODE_ENV === "test" ? "silent" : "info",
});
