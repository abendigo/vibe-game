import { describe, it, expect, beforeEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionPlayer,
  removeSessionsForPlayer,
} from "./auth.js";

describe("auth", () => {
  describe("hashPassword / verifyPassword", () => {
    it("should verify a correct password", async () => {
      const hash = await hashPassword("secret123");
      expect(await verifyPassword("secret123", hash)).toBe(true);
    });

    it("should reject an incorrect password", async () => {
      const hash = await hashPassword("secret123");
      expect(await verifyPassword("wrong", hash)).toBe(false);
    });

    it("should produce different hashes for the same password (unique salts)", async () => {
      const hash1 = await hashPassword("same");
      const hash2 = await hashPassword("same");
      expect(hash1).not.toBe(hash2);
      // Both should still verify
      expect(await verifyPassword("same", hash1)).toBe(true);
      expect(await verifyPassword("same", hash2)).toBe(true);
    });

    it("should produce hash in salt:hash format", async () => {
      const hash = await hashPassword("test");
      const parts = hash.split(":");
      expect(parts).toHaveLength(2);
      // Salt is 16 bytes = 32 hex chars, key is 64 bytes = 128 hex chars
      expect(parts[0]).toHaveLength(32);
      expect(parts[1]).toHaveLength(128);
    });
  });

  describe("sessions", () => {
    it("should create a session and retrieve the player name", () => {
      const token = createSession("Alice");
      expect(getSessionPlayer(token)).toBe("Alice");
    });

    it("should return null for an unknown token", () => {
      expect(getSessionPlayer("nonexistent")).toBeNull();
    });

    it("should create unique tokens per call", () => {
      const t1 = createSession("Bob");
      const t2 = createSession("Bob");
      expect(t1).not.toBe(t2);
      // Both should resolve to the same player
      expect(getSessionPlayer(t1)).toBe("Bob");
      expect(getSessionPlayer(t2)).toBe("Bob");
    });

    it("should remove all sessions for a player", () => {
      const t1 = createSession("Charlie");
      const t2 = createSession("Charlie");
      const tOther = createSession("Dave");

      removeSessionsForPlayer("Charlie");

      expect(getSessionPlayer(t1)).toBeNull();
      expect(getSessionPlayer(t2)).toBeNull();
      expect(getSessionPlayer(tOther)).toBe("Dave");
    });
  });
});
