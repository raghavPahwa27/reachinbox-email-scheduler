import "express-session";
import type { User } from "@prisma/client";
declare module "express-session" {
  interface SessionData {
    userId: string;
    csrfToken: string;
    googleOAuth: {
      state: string;
      nonce: string;
      verifier: string;
      expiresAt: number;
    };
    slackOAuth: {
      state: string;
      userId: string;
      channelId: string;
      redirectUri: string;
      expiresAt: number;
    };
  }
}
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
export {};
