import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger.js";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: "Please check your request.",
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      },
    });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({
        error: {
          message: "A record with these details already exists.",
          code: "CONFLICT",
        },
      });
      return;
    }
    if (error.code === "P2025") {
      res
        .status(404)
        .json({ error: { message: "Record not found.", code: "NOT_FOUND" } });
      return;
    }
    if (error.code === "P2003") {
      res.status(409).json({
        error: {
          message: "This record is still referenced by email history.",
          code: "CONFLICT",
        },
      });
      return;
    }
  }
  if (error instanceof HttpError) {
    res
      .status(error.statusCode)
      .json({ error: { message: error.message, code: error.code } });
    return;
  }
  const candidate = error as {
    statusCode?: number;
    status?: number;
    code?: string;
    message?: string;
  };
  const status = candidate.statusCode ?? candidate.status;
  if (status && status >= 400 && status < 500) {
    res
      .status(status)
      .json({ error: { message: candidate.message, code: candidate.code } });
    return;
  }
  // Do not log request bodies, OAuth codes, tokens, or SMTP credentials.
  logger.error(
    {
      name: error instanceof Error ? error.name : "Error",
      code: candidate.code,
    },
    "Request failed",
  );
  res.status(status && status >= 500 && status <= 599 ? status : 503).json({
    error: {
      message: "A service is temporarily unavailable. Please try again.",
      code: "SERVICE_UNAVAILABLE",
    },
  });
};
