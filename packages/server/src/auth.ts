import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

export interface StoredCredentials {
  passwordHash: string; // hex(salt):hex(hash)
}

/** Sessions: token → player name */
const sessions = new Map<string, string>();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");
  const derivedHash = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return timingSafeEqual(storedHash, derivedHash);
}

export function createSession(playerName: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, playerName);
  return token;
}

export function getSessionPlayer(token: string): string | null {
  return sessions.get(token) ?? null;
}

export function removeSessionsForPlayer(playerName: string): void {
  for (const [token, name] of sessions) {
    if (name === playerName) {
      sessions.delete(token);
    }
  }
}
