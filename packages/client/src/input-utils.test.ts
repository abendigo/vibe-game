import { describe, it, expect } from "vitest";
import {
  isPlayerInCombat,
  findNearestPlayer,
  driveStateChanged,
  shouldSendDriveState,
} from "./input-utils.js";
import type { CombatZone } from "@game/shared";

describe("input-utils", () => {
  describe("driveStateChanged", () => {
    it("should return true when prev is null", () => {
      expect(driveStateChanged(null, { targetSpeed: 0, steeringAngle: 0 })).toBe(true);
    });

    it("should return false when states are identical", () => {
      const state = { targetSpeed: 3, steeringAngle: 10 };
      expect(driveStateChanged(state, { ...state })).toBe(false);
    });

    it("should return true when targetSpeed changes", () => {
      const prev = { targetSpeed: 3, steeringAngle: 0 };
      const curr = { targetSpeed: 4, steeringAngle: 0 };
      expect(driveStateChanged(prev, curr)).toBe(true);
    });

    it("should return true when steeringAngle changes", () => {
      const prev = { targetSpeed: 3, steeringAngle: 0 };
      const curr = { targetSpeed: 3, steeringAngle: 5 };
      expect(driveStateChanged(prev, curr)).toBe(true);
    });
  });

  describe("shouldSendDriveState", () => {
    const zeroDrive = { targetSpeed: 0, steeringAngle: 0 };
    const movingDrive = { targetSpeed: 3, steeringAngle: 0 };

    it("should return false when disconnected", () => {
      expect(shouldSendDriveState(false, null, movingDrive)).toBe(false);
    });

    it("should return false when drive state hasn't changed", () => {
      expect(shouldSendDriveState(true, zeroDrive, zeroDrive)).toBe(false);
    });

    it("should return true when drive state changed", () => {
      expect(shouldSendDriveState(true, zeroDrive, movingDrive)).toBe(true);
    });

    it("should return true when prev is null (first send)", () => {
      expect(shouldSendDriveState(true, null, zeroDrive)).toBe(true);
    });
  });

  describe("isPlayerInCombat", () => {
    const zone: CombatZone = {
      center: { x: 0, y: 0 },
      radius: 300,
      combatantIds: ["p1", "p2"],
      turnOrder: ["p1", "p2"],
      currentTurn: "p1",
    };

    it("should return true for a combatant", () => {
      expect(isPlayerInCombat("p1", zone)).toBe(true);
    });

    it("should return false for a non-combatant", () => {
      expect(isPlayerInCombat("p3", zone)).toBe(false);
    });

    it("should return false when combat zone is null", () => {
      expect(isPlayerInCombat("p1", null)).toBe(false);
    });

    it("should return false when combat zone is undefined", () => {
      expect(isPlayerInCombat("p1", undefined)).toBe(false);
    });

    it("should return false when player id is null", () => {
      expect(isPlayerInCombat(null, zone)).toBe(false);
    });
  });

  describe("findNearestPlayer", () => {
    const players = new Map([
      ["p1", { id: "p1", position: { x: 100, y: 100 } }],
      ["p2", { id: "p2", position: { x: 200, y: 100 } }],
      ["p3", { id: "p3", position: { x: 500, y: 500 } }],
    ]);

    it("should find the nearest player within range", () => {
      expect(findNearestPlayer({ x: 105, y: 100 }, players, "local", 50)).toBe("p1");
    });

    it("should skip the local player", () => {
      expect(findNearestPlayer({ x: 100, y: 100 }, players, "p1", 150)).toBe("p2");
    });

    it("should return null when no player is in range", () => {
      expect(findNearestPlayer({ x: 900, y: 900 }, players, "local", 50)).toBeNull();
    });

    it("should return null for empty player map", () => {
      expect(findNearestPlayer({ x: 0, y: 0 }, new Map(), "local", 50)).toBeNull();
    });

    it("should pick the closest when multiple are in range", () => {
      expect(findNearestPlayer({ x: 180, y: 100 }, players, "local", 50)).toBe("p2");
    });
  });
});
