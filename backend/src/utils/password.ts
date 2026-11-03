import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  const [, salt, expected] = stored?.split(":") ?? [];
  const hash = (await scrypt(
    password,
    salt || "missing-account-timing-salt",
    64,
  )) as Buffer;
  if (!expected) return false;
  const bytes = Buffer.from(expected, "hex");
  return bytes.length === hash.length && timingSafeEqual(bytes, hash);
}
