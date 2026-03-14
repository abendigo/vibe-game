import { describe, it, expect } from "vitest";
import { CarPartType, WeaponKind } from "@game/shared";
import type { Player } from "@game/shared";
import {
  screenToWorld,
  computeCameraPosition,
  assignPlayerColor,
  worldToMinimap,
  computeMinimapViewport,
  computeMinimapCombatZone,
  hpBarColor,
  rotationToCompass,
  computePlayerStats,
  MINIMAP_SCALE,
  WORLD_SIZE,
  PLAYER_COLORS,
} from "./render-utils.js";

describe("render-utils", () => {
  describe("screenToWorld", () => {
    it("should subtract world offset from screen coords", () => {
      expect(screenToWorld(400, 300, -100, -200)).toEqual({ x: 500, y: 500 });
    });

    it("should handle zero offset", () => {
      expect(screenToWorld(100, 200, 0, 0)).toEqual({ x: 100, y: 200 });
    });

    it("should handle positive offset (camera moved right/down)", () => {
      expect(screenToWorld(100, 100, 50, 50)).toEqual({ x: 50, y: 50 });
    });
  });

  describe("computeCameraPosition", () => {
    it("should center player on screen", () => {
      const cam = computeCameraPosition(800, 600, { x: 500, y: 400 });
      expect(cam).toEqual({ x: -100, y: -100 });
    });

    it("should place player at origin when at center of canvas", () => {
      const cam = computeCameraPosition(800, 600, { x: 400, y: 300 });
      expect(cam).toEqual({ x: 0, y: 0 });
    });

    it("should handle player at world origin", () => {
      const cam = computeCameraPosition(800, 600, { x: 0, y: 0 });
      expect(cam).toEqual({ x: 400, y: 300 });
    });
  });

  describe("assignPlayerColor", () => {
    it("should assign the first color to a new player", () => {
      const map = new Map<string, number>();
      const { color, newIndex } = assignPlayerColor("p1", map, 0);
      expect(color).toBe(PLAYER_COLORS[0]);
      expect(newIndex).toBe(1);
      expect(map.get("p1")).toBe(PLAYER_COLORS[0]);
    });

    it("should return the same color for the same player", () => {
      const map = new Map<string, number>();
      assignPlayerColor("p1", map, 0);
      const { color, newIndex } = assignPlayerColor("p1", map, 1);
      expect(color).toBe(PLAYER_COLORS[0]);
      expect(newIndex).toBe(1); // index not incremented
    });

    it("should cycle through colors", () => {
      const map = new Map<string, number>();
      for (let i = 0; i < PLAYER_COLORS.length; i++) {
        const { color } = assignPlayerColor(`p${i}`, map, i);
        expect(color).toBe(PLAYER_COLORS[i]);
      }
      // Should wrap around
      const { color } = assignPlayerColor("wrap", map, PLAYER_COLORS.length);
      expect(color).toBe(PLAYER_COLORS[0]);
    });
  });

  describe("worldToMinimap", () => {
    it("should scale world position to minimap coordinates relative to center", () => {
      const center = { x: 5000, y: 5000 };
      const result = worldToMinimap({ x: 6000, y: 6000 }, center);
      // 6000 - 5000 + 2000 = 3000, 3000 * (150/4000) = 112.5
      expect(result.x).toBeCloseTo(112.5);
      expect(result.y).toBeCloseTo(112.5);
    });

    it("should place center at minimap center", () => {
      const center = { x: 5000, y: 5000 };
      const result = worldToMinimap({ x: 5000, y: 5000 }, center);
      // 5000 - 5000 + 2000 = 2000, 2000 * (150/4000) = 75
      expect(result.x).toBeCloseTo(75);
      expect(result.y).toBeCloseTo(75);
    });

    it("should map edge of minimap radius to minimap edge", () => {
      const center = { x: 5000, y: 5000 };
      const result = worldToMinimap({ x: 7000, y: 7000 }, center);
      // 7000 - 5000 + 2000 = 4000, 4000 * (150/4000) = 150
      expect(result.x).toBeCloseTo(150);
      expect(result.y).toBeCloseTo(150);
    });
  });

  describe("computeMinimapViewport", () => {
    it("should compute correct viewport rect relative to center", () => {
      const center = { x: 5000, y: 5000 };
      // World offset of -100,-200 means camera shows from (100,200)
      const vp = computeMinimapViewport(-100, -200, 800, 600, center);
      // x: (100 - 5000 + 2000) * scale = -2900 * scale
      expect(vp.x).toBeCloseTo((-2900) * MINIMAP_SCALE);
      expect(vp.y).toBeCloseTo((-2800) * MINIMAP_SCALE);
      expect(vp.width).toBeCloseTo(800 * MINIMAP_SCALE);
      expect(vp.height).toBeCloseTo(600 * MINIMAP_SCALE);
    });

    it("should handle zero offset with center at origin", () => {
      const center = { x: 0, y: 0 };
      const vp = computeMinimapViewport(0, 0, 800, 600, center);
      // x: (0 - 0 + 2000) * scale = 2000 * scale = 75
      expect(vp.x).toBeCloseTo(2000 * MINIMAP_SCALE);
      expect(vp.y).toBeCloseTo(2000 * MINIMAP_SCALE);
    });
  });

  describe("computeMinimapCombatZone", () => {
    it("should scale combat zone to minimap coordinates relative to center", () => {
      const zone = {
        center: { x: 500, y: 500 },
        radius: 300,
        combatantIds: [],
        turnOrder: [],
        currentTurn: "",
      };
      const center = { x: 500, y: 500 };
      const { cx, cy, cr } = computeMinimapCombatZone(zone, center);
      // 500 - 500 + 2000 = 2000, 2000 * scale = 75
      expect(cx).toBeCloseTo(2000 * MINIMAP_SCALE);
      expect(cy).toBeCloseTo(2000 * MINIMAP_SCALE);
      expect(cr).toBeCloseTo(300 * MINIMAP_SCALE);
    });
  });

  describe("hpBarColor", () => {
    it("should return green for hp > 50%", () => {
      expect(hpBarColor(0.75)).toBe(0x66bb6a);
      expect(hpBarColor(1.0)).toBe(0x66bb6a);
      expect(hpBarColor(0.51)).toBe(0x66bb6a);
    });

    it("should return orange for hp 25-50%", () => {
      expect(hpBarColor(0.5)).toBe(0xffa726);
      expect(hpBarColor(0.3)).toBe(0xffa726);
      expect(hpBarColor(0.26)).toBe(0xffa726);
    });

    it("should return red for hp <= 25%", () => {
      expect(hpBarColor(0.25)).toBe(0xef5350);
      expect(hpBarColor(0.1)).toBe(0xef5350);
      expect(hpBarColor(0)).toBe(0xef5350);
    });
  });

  describe("rotationToCompass", () => {
    it("should return E for 0 radians", () => {
      expect(rotationToCompass(0)).toBe("E");
    });

    it("should return S for PI/2", () => {
      expect(rotationToCompass(Math.PI / 2)).toBe("S");
    });

    it("should return W for PI", () => {
      expect(rotationToCompass(Math.PI)).toBe("W");
    });

    it("should return N for -PI/2 (or 3PI/2)", () => {
      expect(rotationToCompass(-Math.PI / 2)).toBe("N");
      expect(rotationToCompass(3 * Math.PI / 2)).toBe("N");
    });

    it("should return SE for PI/4", () => {
      expect(rotationToCompass(Math.PI / 4)).toBe("SE");
    });

    it("should return NE for -PI/4", () => {
      expect(rotationToCompass(-Math.PI / 4)).toBe("NE");
    });
  });

  describe("computePlayerStats", () => {
    const mockPlayer: Player = {
      id: "p1",
      name: "Alice",
      position: { x: 123.7, y: 456.2 },
      rotation: Math.PI / 2,
      velocity: { speed: 3.5, heading: Math.PI / 2 },
      steeringAngle: 0,
      skills: { driving: 2, gunnery: 3, luck: 1 },
      car: {
        id: "c1",
        baseSpeed: 4,
        baseArmor: 2,
        baseHealth: 75,
        parts: [
          { id: "e1", name: "Engine", type: CarPartType.Engine, stats: { speed: 3 } },
          { id: "w1", name: "Wheels", type: CarPartType.Wheels, stats: { speed: 1 } },
          { id: "a1", name: "Armor", type: CarPartType.Armor, stats: { armor: 2 } },
          { id: "wp1", name: "Laser", type: CarPartType.Weapon, stats: { weaponKind: WeaponKind.Laser, damage: 8, range: 200, energy: 10, maxEnergy: 10 } },
          { id: "wp2", name: "Gun", type: CarPartType.Weapon, stats: { weaponKind: WeaponKind.Projectile, damage: 4, range: 150, ammo: 20, maxAmmo: 20 } },
        ],
      },
    };

    it("should compute effective speed from base + parts", () => {
      const stats = computePlayerStats(mockPlayer, null);
      // base 4 + engine 3 + wheels 1 = 8
      expect(stats.speed).toBe(8);
      expect(stats.maxSpeed).toBe(8);
    });

    it("should return current speed from velocity", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.currentSpeed).toBe(3.5);
    });

    it("should compute combat movement remaining", () => {
      const playerInCombat = {
        ...mockPlayer,
        combatMovementBudget: 160,
        combatMovementUsed: 40,
      };
      const stats = computePlayerStats(playerInCombat, null);
      expect(stats.combatMovementRemaining).toBe(120);
    });

    it("should default combat movement remaining to full budget", () => {
      const stats = computePlayerStats(mockPlayer, null);
      // tick-based budget: 30 ticks
      expect(stats.combatMovementRemaining).toBe(30);
    });

    it("should compute effective armor from base + parts", () => {
      const stats = computePlayerStats(mockPlayer, null);
      // base 2 + armor part 2 = 4
      expect(stats.armor).toBe(4);
    });

    it("should return weapon damage and range", () => {
      const stats = computePlayerStats(mockPlayer, null);
      // damage/weaponRange use first weapon with damage (laser)
      expect(stats.damage).toBe(8);
      expect(stats.weaponRange).toBe(200);
    });

    it("should return laser weapon stats", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.laserDamage).toBe(8);
      expect(stats.laserEnergy).toBe(10);
      expect(stats.maxLaserEnergy).toBe(10);
      expect(stats.laserRange).toBe(200);
    });

    it("should return projectile weapon stats", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.projectileDamage).toBe(4);
      expect(stats.projectileAmmo).toBe(20);
      expect(stats.maxProjectileAmmo).toBe(20);
      expect(stats.projectileRange).toBe(150);
    });

    it("should round position to integers", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.position).toEqual({ x: 124, y: 456 });
    });

    it("should compute compass direction from rotation", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.direction).toBe("S"); // PI/2
    });

    it("should show inCombat when player is a combatant", () => {
      const zone = {
        center: { x: 0, y: 0 },
        radius: 300,
        combatantIds: ["p1", "p2"],
        turnOrder: ["p1", "p2"],
        currentTurn: "p1",
      };
      expect(computePlayerStats(mockPlayer, zone).inCombat).toBe(true);
    });

    it("should show not inCombat when player is not a combatant", () => {
      const zone = {
        center: { x: 0, y: 0 },
        radius: 300,
        combatantIds: ["p2"],
        turnOrder: ["p2"],
        currentTurn: "p2",
      };
      expect(computePlayerStats(mockPlayer, zone).inCombat).toBe(false);
    });

    it("should show not inCombat when no combat zone", () => {
      expect(computePlayerStats(mockPlayer, null).inCombat).toBe(false);
    });

    it("should return 0 damage when no weapon equipped", () => {
      const noWeaponPlayer: Player = {
        ...mockPlayer,
        car: { ...mockPlayer.car, parts: mockPlayer.car.parts.filter(p => p.type !== CarPartType.Weapon) },
      };
      const stats = computePlayerStats(noWeaponPlayer, null);
      expect(stats.damage).toBe(0);
      expect(stats.weaponRange).toBe(0);
      expect(stats.laserDamage).toBe(0);
      expect(stats.laserEnergy).toBe(0);
      expect(stats.projectileAmmo).toBe(0);
    });

    it("should count parts correctly", () => {
      expect(computePlayerStats(mockPlayer, null).partCount).toBe(5);
    });

    it("should include player skills", () => {
      const stats = computePlayerStats(mockPlayer, null);
      expect(stats.skills).toEqual({ driving: 2, gunnery: 3, luck: 1 });
    });
  });
});
