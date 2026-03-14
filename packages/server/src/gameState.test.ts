import { describe, it, expect, beforeEach } from "vitest";
import { GameStateManager } from "./gameState.js";
import { GamePhase, PHYSICS } from "@game/shared";

describe("GameStateManager", () => {
  let gm: GameStateManager;

  beforeEach(() => {
    gm = new GameStateManager();
  });

  // ── Player management ──

  describe("addPlayer", () => {
    it("should add a player to the state", () => {
      const player = gm.addPlayer("p1", "Alice");
      expect(player.id).toBe("p1");
      expect(player.name).toBe("Alice");
      expect(gm.state.players.size).toBe(1);
      expect(gm.state.players.get("p1")).toBe(player);
    });

    it("should assign a position within expected bounds", () => {
      const player = gm.addPlayer("p1", "Alice");
      // Dusthaven spawn point: (9950, 4400) ± randomization
      expect(player.position.x).toBeGreaterThanOrEqual(9900);
      expect(player.position.x).toBeLessThanOrEqual(10000);
      expect(player.position.y).toBeGreaterThanOrEqual(4300);
      expect(player.position.y).toBeLessThanOrEqual(4500);
    });

    it("should create a car with default parts", () => {
      const player = gm.addPlayer("p1", "Alice");
      expect(player.car.parts).toHaveLength(5);
      expect(player.car.baseSpeed).toBe(4);
      expect(player.car.baseArmor).toBe(2);
      expect(player.car.baseHealth).toBe(100);
    });
  });

  describe("removePlayer", () => {
    it("should remove a player from the state", () => {
      gm.addPlayer("p1", "Alice");
      gm.removePlayer("p1");
      expect(gm.state.players.size).toBe(0);
    });

    it("should be a no-op for unknown player id", () => {
      gm.addPlayer("p1", "Alice");
      gm.removePlayer("unknown");
      expect(gm.state.players.size).toBe(1);
    });
  });

  // ── Physics / Movement ──

  describe("tickPhysics", () => {
    it("should set player speed instantly from drive state", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 0, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 0 });

      gm.tickPhysics();

      expect(player.velocity.speed).toBe(5);
    });

    it("should stop when targetSpeed is 0", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 5, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 0, steeringAngle: 0 });

      gm.tickPhysics();

      expect(player.velocity.speed).toBe(0);
    });

    it("should not go above effective max speed", () => {
      const player = gm.addPlayer("p1", "Alice");
      // Effective max = baseSpeed(4) + engine(3) + wheels(1) = 8
      player.velocity = { speed: 0, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 20, steeringAngle: 0 });

      gm.tickPhysics();

      expect(player.velocity.speed).toBe(8);
    });

    it("should update position based on velocity", () => {
      const player = gm.addPlayer("p1", "Alice");
      const startX = player.position.x;
      const startY = player.position.y;
      player.velocity = { speed: 0, heading: 0 }; // heading 0 = east
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 0 });

      gm.tickPhysics();

      expect(player.position.x).toBeCloseTo(startX + 5);
      expect(player.position.y).toBeCloseTo(startY);
    });

    it("should update rotation to match heading when moving", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 5, heading: Math.PI / 4 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 0 });

      gm.tickPhysics();

      expect(player.rotation).toBeCloseTo(Math.PI / 4);
    });

    it("should steer when steeringAngle is set", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 5, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 45 });

      gm.tickPhysics();

      // Turn rate = (45/45) * 0.06 = 0.06 rad/tick, 1 tick = 0.06
      expect(player.velocity.heading).toBeCloseTo(PHYSICS.MAX_TURN_RATE);
    });

    it("should not steer when speed is below MIN_SPEED_FOR_TURN", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 0.1, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 0.1, steeringAngle: 45 });

      gm.tickPhysics();

      expect(player.velocity.heading).toBe(0);
    });

    it("should steer left with negative steeringAngle", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 5, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: -45 });

      gm.tickPhysics();

      expect(player.velocity.heading).toBeCloseTo(-PHYSICS.MAX_TURN_RATE);
    });

    it("should skip combat players", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      const posBefore = { ...p1.position };
      p1.velocity = { speed: 5, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 0 });

      gm.tickPhysics();

      expect(p1.position).toEqual(posBefore);
    });

    it("should allow movement for non-combatants during combat", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 };

      gm.startCombat("p1");
      p3.velocity = { speed: 0, heading: 0 };
      gm.setDriveState("p3", { targetSpeed: 5, steeringAngle: 0 });

      const startX = p3.position.x;
      gm.tickPhysics();

      expect(p3.position.x).toBeGreaterThan(startX);
    });

    it("should hold speed with no drive state changes (no decay)", () => {
      const player = gm.addPlayer("p1", "Alice");
      player.velocity = { speed: 0, heading: 0 };
      gm.setDriveState("p1", { targetSpeed: 5, steeringAngle: 0 });

      gm.tickPhysics();
      const posAfterTick1 = player.position.x;
      gm.tickPhysics();
      const posAfterTick2 = player.position.x;

      // Should have moved the same distance both ticks
      expect(posAfterTick2 - posAfterTick1).toBeCloseTo(5);
    });
  });

  // ── Combat zone ──

  describe("startCombat", () => {
    it("should create a combat zone centered on the initiator", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 600, y: 500 };

      const zone = gm.startCombat("p1");
      expect(zone).not.toBeNull();
      expect(zone!.center).toEqual({ x: 500, y: 500 });
      expect(zone!.radius).toBe(300);
      expect(zone!.combatantIds).toContain("p1");
      expect(zone!.combatantIds).toContain("p2");
    });

    it("should set game phase to Combat", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      expect(gm.state.phase).toBe(GamePhase.Combat);
    });

    it("should return null if initiator doesn't exist", () => {
      expect(gm.startCombat("ghost")).toBeNull();
    });

    it("should return null if fewer than 2 players in range", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      p1.position = { x: 500, y: 500 };
      expect(gm.startCombat("p1")).toBeNull();
    });

    it("should exclude players outside the combat radius", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 }; // far away

      const zone = gm.startCombat("p1");
      expect(zone!.combatantIds).toContain("p1");
      expect(zone!.combatantIds).toContain("p2");
      expect(zone!.combatantIds).not.toContain("p3");
    });

    it("should return null if combat is already active", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      expect(gm.startCombat("p1")).toBeNull();
    });

    it("should assign a turn order containing all combatants", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      const zone = gm.startCombat("p1")!;
      expect(zone.turnOrder).toHaveLength(2);
      expect(zone.turnOrder).toContain("p1");
      expect(zone.turnOrder).toContain("p2");
      expect(zone.turnOrder).toContain(zone.currentTurn);
    });
  });

  describe("endCombat", () => {
    it("should clear combat zone and reset phase", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      gm.endCombat();

      expect(gm.state.combatZone).toBeUndefined();
      expect(gm.state.phase).toBe(GamePhase.Exploring);
      expect(gm.state.turnOrder).toBeUndefined();
      expect(gm.state.currentTurn).toBeUndefined();
    });
  });

  describe("addToCombat", () => {
    it("should add a non-combatant to the active combat zone", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 };

      gm.startCombat("p1");
      expect(gm.isInCombat("p3")).toBe(false);

      const result = gm.addToCombat("p3");
      expect(result).toBe(true);
      expect(gm.isInCombat("p3")).toBe(true);
      expect(gm.state.combatZone!.turnOrder).toContain("p3");
    });

    it("should return false if player is already in combat", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      expect(gm.addToCombat("p1")).toBe(false);
    });

    it("should return false if no combat zone exists", () => {
      gm.addPlayer("p1", "Alice");
      expect(gm.addToCombat("p1")).toBe(false);
    });

    it("should insert new combatant after current turn in turn order", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 };

      gm.startCombat("p1");
      const zone = gm.state.combatZone!;
      const currentTurn = zone.currentTurn;
      const currentIndex = zone.turnOrder.indexOf(currentTurn);

      gm.addToCombat("p3");
      expect(zone.turnOrder[currentIndex + 1]).toBe("p3");
    });
  });

  describe("driving into combat zone", () => {
    it("should auto-join combat when moving into the zone", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      // Place p3 just outside combat radius, moving toward center
      p3.position = { x: 500 + 305, y: 500 };
      p3.velocity = { speed: 0, heading: Math.PI }; // heading west
      gm.setDriveState("p3", { targetSpeed: 8, steeringAngle: 0 });

      gm.startCombat("p1");
      expect(gm.isInCombat("p3")).toBe(false);

      // Tick physics -- p3 moves 8 units west (to ~797)
      gm.tickPhysics();
      // p3 is now within 300 of center 500
      expect(gm.isInCombat("p3")).toBe(true);
    });
  });

  // ── Combat actions ──

  describe("processCombatAction", () => {
    function setupCombat() {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 550, y: 500 };
      gm.startCombat("p1");
      return { p1, p2, zone: gm.state.combatZone! };
    }

    it("should fail if no combat is active", () => {
      gm.addPlayer("p1", "Alice");
      const result = gm.processCombatAction("p1", { type: "wait" });
      expect(result.success).toBe(false);
      expect(result.message).toBe("No active combat");
    });

    it("should fail if it's not the player's turn", () => {
      const { zone } = setupCombat();
      const notCurrent = zone.turnOrder.find((id) => id !== zone.currentTurn)!;
      const result = gm.processCombatAction(notCurrent, { type: "wait" });
      expect(result.success).toBe(false);
      expect(result.message).toBe("Not your turn");
    });

    describe("combat movement (preview-then-confirm via processCombatMove)", () => {
      it("should move the current-turn combatant via processCombatMove", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const posBefore = { ...player.position };
        player.velocity = { speed: 0, heading: 0 };

        const result = gm.processCombatMove(currentId, { targetSpeed: 5, steeringAngle: 0 }, 50);

        expect(result.success).toBe(true);
        expect(result.path).toBeDefined();
        expect(result.path!.length).toBeGreaterThan(0);
        expect(player.position.x).not.toBeCloseTo(posBefore.x, 0);
        expect(player.combatMovementUsed).toBeGreaterThan(0);
      });

      it("should apply steeringAngle in combat move", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        player.velocity = { speed: 0, heading: 0 };

        const result = gm.processCombatMove(currentId, { targetSpeed: 5, steeringAngle: 45 }, 10);

        expect(result.success).toBe(true);
        // Heading should have changed due to steering
        expect(player.velocity.heading).not.toBe(0);
        expect(player.velocity.heading).toBeCloseTo(10 * PHYSICS.MAX_TURN_RATE);
      });

      it("should not move a combatant who is not the current turn", () => {
        const { zone } = setupCombat();
        const notCurrentId = zone.turnOrder.find((id) => id !== zone.currentTurn)!;

        const result = gm.processCombatMove(notCurrentId, { targetSpeed: 5, steeringAngle: 0 }, 50);

        expect(result.success).toBe(false);
        expect(result.message).toBe("Not your turn");
      });

      it("should fail when budget is exhausted", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        player.combatMovementBudget = 1;
        player.combatMovementUsed = 1;

        const result = gm.processCombatMove(currentId, { targetSpeed: 5, steeringAngle: 0 }, 50);

        expect(result.success).toBe(false);
        expect(result.message).toBe("Movement budget exhausted");
      });

      it("should reset budget on turn advance", () => {
        const { zone } = setupCombat();
        gm.advanceTurn();
        const nextId = zone.currentTurn;
        const nextPlayer = gm.state.players.get(nextId)!;
        expect(nextPlayer.combatMovementUsed).toBe(0);
        expect(nextPlayer.combatMovementBudget).toBe(30);
      });

      it("click-to-move combat action returns error", () => {
        const { zone } = setupCombat();
        const result = gm.processCombatAction(zone.currentTurn, {
          type: "move",
          target: { x: 0, y: 0 },
        });
        expect(result.success).toBe(false);
      });

      it("tickPhysics should skip combat players entirely", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const posBefore = { ...player.position };
        player.velocity = { speed: 5, heading: 0 };

        gm.setDriveState(currentId, { targetSpeed: 5, steeringAngle: 0 });
        gm.tickPhysics();

        expect(player.position).toEqual(posBefore);
      });
    });

    describe("attack action", () => {
      it("should deal damage to the target", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;
        const [attacker, target] =
          currentId === "p1" ? [p1, p2] : [p2, p1];

        // Place them close enough for weapon range
        attacker.position = { x: 500, y: 500 };
        target.position = { x: 550, y: 500 };

        const weapon = attacker.car.parts.find((p) => p.stats.damage);
        const hpBefore = target.car.baseHealth;

        const result = gm.processCombatAction(currentId, {
          type: "attack",
          targetId: target.id,
          weaponPartId: weapon!.id,
        });

        expect(result.success).toBe(true);
        // Laser damage(8) - armor parts on target (armor=2 from Light Plating) = 6
        expect(target.car.baseHealth).toBe(hpBefore - 6);
      });

      it("should fail if target is out of range", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;
        const [attacker, target] =
          currentId === "p1" ? [p1, p2] : [p2, p1];

        attacker.position = { x: 0, y: 0 };
        target.position = { x: 9999, y: 0 };

        const weapon = attacker.car.parts.find((p) => p.stats.damage);
        const result = gm.processCombatAction(currentId, {
          type: "attack",
          targetId: target.id,
          weaponPartId: weapon!.id,
        });
        expect(result.success).toBe(false);
        expect(result.message).toBe("Target out of range");
      });

      it("should fail if weapon not found", () => {
        const { zone } = setupCombat();
        const result = gm.processCombatAction(zone.currentTurn, {
          type: "attack",
          targetId: zone.turnOrder.find((id) => id !== zone.currentTurn)!,
          weaponPartId: "nonexistent",
        });
        expect(result.success).toBe(false);
        expect(result.message).toBe("Weapon not found");
      });

      it("should fail if target player doesn't exist", () => {
        const { zone } = setupCombat();
        const weapon = gm.state.players
          .get(zone.currentTurn)!
          .car.parts.find((p) => p.stats.damage)!;
        const result = gm.processCombatAction(zone.currentTurn, {
          type: "attack",
          targetId: "ghost",
          weaponPartId: weapon.id,
        });
        expect(result.success).toBe(false);
        expect(result.message).toBe("Target not found");
      });
    });

    describe("wait action", () => {
      it("should succeed", () => {
        const { zone } = setupCombat();
        const result = gm.processCombatAction(zone.currentTurn, {
          type: "wait",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("fireLaser action", () => {
      it("should auto-target and fire (hit or miss)", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;

        const result = gm.processCombatAction(currentId, { type: "fireLaser" });
        expect(result.success).toBe(true);
        expect(result.animation).toBeDefined();
        expect(result.animation!.kind).toBe("laser");
        expect(result.roll).toBeDefined();
        expect(result.chance).toBeDefined();
      });

      it("should consume energy", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const laser = player.car.parts.find(
          (p) => p.stats.weaponKind === "Laser"
        )!;
        const energyBefore = laser.stats.energy!;

        gm.processCombatAction(currentId, { type: "fireLaser" });
        expect(laser.stats.energy).toBe(energyBefore - 1);
      });

      it("should deal damage on hit with high gunnery", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;
        const attacker = gm.state.players.get(currentId)!;
        const target = currentId === "p1" ? p2 : p1;
        attacker.skills.gunnery = 10; // 70 + 50 = 120, capped at 95%

        // Try multiple times - with 95% chance, very likely to hit at least once
        let hitOnce = false;
        for (let i = 0; i < 20; i++) {
          const hpBefore = target.car.baseHealth;
          const laser = attacker.car.parts.find(p => p.stats.weaponKind === "Laser")!;
          laser.stats.energy = 10;
          laser.stats.cooldown = 0;
          zone.currentTurn = currentId;
          const result = gm.processCombatAction(currentId, { type: "fireLaser" });
          if (result.animation?.hit) {
            hitOnce = true;
            expect(target.car.baseHealth).toBeLessThan(hpBefore);
            break;
          }
        }
        expect(hitOnce).toBe(true);
      });

      it("should fail when out of energy", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const laser = player.car.parts.find(
          (p) => p.stats.weaponKind === "Laser"
        )!;
        laser.stats.energy = 0;

        const result = gm.processCombatAction(currentId, { type: "fireLaser" });
        expect(result.success).toBe(false);
        expect(result.message).toBe("Out of energy");
      });

      it("should fail when no targets in range", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;
        const attacker = gm.state.players.get(currentId)!;
        const target = currentId === "p1" ? p2 : p1;
        // Move target far away
        target.position = { x: 9999, y: 9999 };

        const result = gm.processCombatAction(currentId, { type: "fireLaser" });
        expect(result.success).toBe(false);
        expect(result.message).toBe("No targets in range");
      });
    });

    describe("fireProjectile action", () => {
      it("should auto-target and fire (hit or miss)", () => {
        const { p1, p2, zone } = setupCombat();
        const currentId = zone.currentTurn;

        const result = gm.processCombatAction(currentId, {
          type: "fireProjectile",
        });
        expect(result.success).toBe(true);
        expect(result.animation).toBeDefined();
        expect(result.animation!.kind).toBe("projectile");
        expect(result.roll).toBeDefined();
        expect(result.chance).toBeDefined();
      });

      it("should consume ammo", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const gun = player.car.parts.find(
          (p) => p.stats.weaponKind === "Projectile"
        )!;
        const ammoBefore = gun.stats.ammo!;

        gm.processCombatAction(currentId, { type: "fireProjectile" });
        expect(gun.stats.ammo).toBe(ammoBefore - 1);
      });

      it("should fail when out of ammo", () => {
        const { zone } = setupCombat();
        const currentId = zone.currentTurn;
        const player = gm.state.players.get(currentId)!;
        const gun = player.car.parts.find(
          (p) => p.stats.weaponKind === "Projectile"
        )!;
        gun.stats.ammo = 0;

        const result = gm.processCombatAction(currentId, {
          type: "fireProjectile",
        });
        expect(result.success).toBe(false);
        expect(result.message).toBe("Out of ammo");
      });
    });

    describe("useItem action", () => {
      it("should fail (not implemented)", () => {
        const { zone } = setupCombat();
        const result = gm.processCombatAction(zone.currentTurn, {
          type: "useItem",
          itemId: "potion",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  // ── Turn management ──

  describe("advanceTurn", () => {
    it("should cycle through the turn order", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      const zone = gm.state.combatZone!;
      const first = zone.currentTurn;
      const second = zone.turnOrder.find((id) => id !== first)!;

      expect(gm.advanceTurn()).toBe(second);
      expect(zone.currentTurn).toBe(second);

      expect(gm.advanceTurn()).toBe(first);
      expect(zone.currentTurn).toBe(first);
    });

    it("should return null if no combat zone", () => {
      expect(gm.advanceTurn()).toBeNull();
    });

    it("should keep legacy fields in sync", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      const next = gm.advanceTurn()!;
      expect(gm.state.currentTurn).toBe(next);
    });
  });

  // ── Remove player during combat ──

  describe("removePlayer during combat", () => {
    it("should remove combatant from turn order", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 520, y: 500 };

      gm.startCombat("p1");
      gm.removePlayer("p3");

      const zone = gm.state.combatZone!;
      expect(zone.combatantIds).not.toContain("p3");
      expect(zone.turnOrder).not.toContain("p3");
    });

    it("should end combat if fewer than 2 combatants remain", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      gm.removePlayer("p2");

      expect(gm.state.combatZone).toBeUndefined();
      expect(gm.state.phase).toBe(GamePhase.Exploring);
    });

    it("should advance turn if the removed player had the current turn", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 520, y: 500 };

      gm.startCombat("p1");
      const zone = gm.state.combatZone!;
      const currentId = zone.currentTurn;

      gm.removePlayer(currentId);

      // Should still have a combat zone with the remaining 2 players
      expect(gm.state.combatZone).toBeDefined();
      // Current turn should have advanced to someone else
      expect(gm.state.combatZone!.currentTurn).not.toBe(currentId);
    });

    it("should not affect combat when removing a non-combatant", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 };

      gm.startCombat("p1");
      const zoneBefore = { ...gm.state.combatZone! };
      gm.removePlayer("p3");

      expect(gm.state.combatZone).toBeDefined();
      expect(gm.state.combatZone!.combatantIds).toEqual(zoneBefore.combatantIds);
    });
  });

  // ── isInCombat ──

  describe("isInCombat", () => {
    it("should return false when no combat is active", () => {
      gm.addPlayer("p1", "Alice");
      expect(gm.isInCombat("p1")).toBe(false);
    });

    it("should return true for combatants", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };

      gm.startCombat("p1");
      expect(gm.isInCombat("p1")).toBe(true);
      expect(gm.isInCombat("p2")).toBe(true);
    });

    it("should return false for non-combatants", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 1500, y: 1500 };

      gm.startCombat("p1");
      expect(gm.isInCombat("p3")).toBe(false);
    });
  });

  // ── Skills ──

  describe("skills", () => {
    it("should assign default skills to new players", () => {
      const player = gm.addPlayer("p1", "Alice");
      expect(player.skills).toEqual({ driving: 1, gunnery: 1, luck: 1 });
    });
  });

  // ── Distance-based escape ──

  describe("checkDistanceEscape", () => {
    it("should not escape when close to other combatants", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      gm.startCombat("p1");

      const result = gm.checkDistanceEscape("p1");
      expect(result.escaped).toBe(false);
    });

    it("should escape when 1000+ px from all combatants", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      gm.startCombat("p1");

      // Move p1 far away
      p1.position = { x: 2000, y: 500 };
      const result = gm.checkDistanceEscape("p1");
      expect(result.escaped).toBe(true);
      expect(result.playerName).toBe("Alice");
    });

    it("should remove escapee from combat zone", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 520, y: 500 };
      gm.startCombat("p1");
      const zone = gm.state.combatZone!;

      // Move p1 far away
      p1.position = { x: 2000, y: 2000 };
      gm.checkDistanceEscape("p1");

      expect(zone.combatantIds).not.toContain("p1");
      expect(zone.turnOrder).not.toContain("p1");
    });

    it("should end combat if fewer than 2 combatants remain", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      gm.startCombat("p1");

      p1.position = { x: 2000, y: 2000 };
      gm.checkDistanceEscape("p1");

      expect(gm.state.combatZone).toBeUndefined();
      expect(gm.state.phase).toBe(GamePhase.Exploring);
    });

    it("should not escape if close to any one combatant", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      const p3 = gm.addPlayer("p3", "Charlie");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      p3.position = { x: 520, y: 500 };
      gm.startCombat("p1");

      // Far from p2 and p3, but p3 moved close
      p1.position = { x: 2000, y: 2000 };
      p3.position = { x: 2100, y: 2000 }; // only 100px away

      const result = gm.checkDistanceEscape("p1");
      expect(result.escaped).toBe(false);
    });

    it("should return false for non-combatant", () => {
      const p1 = gm.addPlayer("p1", "Alice");
      const p2 = gm.addPlayer("p2", "Bob");
      p1.position = { x: 500, y: 500 };
      p2.position = { x: 510, y: 500 };
      gm.startCombat("p1");

      const outsider = gm.addPlayer("p3", "Charlie");
      outsider.position = { x: 9999, y: 9999 };
      expect(gm.checkDistanceEscape("p3").escaped).toBe(false);
    });
  });

  // ── NPC ──

  describe("NPC", () => {
    describe("addNPC", () => {
      it("should create an NPC player with isNPC flag", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        expect(npc.isNPC).toBe(true);
        expect(npc.name).toBe("Target Dummy");
        expect(gm.state.players.get("npc1")).toBe(npc);
      });

      it("should set initial velocity for circling", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        expect(npc.velocity.speed).toBe(3);
      });

      it("should set initial drive state with steeringAngle", () => {
        gm.addNPC("npc1", "Target Dummy");
        const ds = gm.playerDriveStates.get("npc1");
        expect(ds).toBeDefined();
        expect(ds!.targetSpeed).toBe(3);
        expect(ds!.steeringAngle).toBe(0);
      });
    });

    describe("tickNPCInput", () => {
      it("should update NPC drive state to maintain circle", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        gm.tickNPCInput();
        const ds = gm.playerDriveStates.get("npc1");
        expect(ds).toBeDefined();
        expect(typeof ds!.steeringAngle).toBe("number");
      });

      it("should not update NPC when in combat", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        const p1 = gm.addPlayer("p1", "Alice");
        // Place both near each other
        npc.position = { x: 500, y: 500 };
        p1.position = { x: 510, y: 500 };
        gm.startCombat("p1");
        expect(gm.isInCombat("npc1")).toBe(true);

        const dsBefore = gm.playerDriveStates.get("npc1");
        const steeringBefore = dsBefore?.steeringAngle;
        gm.tickNPCInput();

        // Should not have been changed since NPC is in combat
        const dsAfter = gm.playerDriveStates.get("npc1");
        expect(dsAfter?.steeringAngle).toBe(steeringBefore);
      });
    });

    describe("processNPCTurn", () => {
      it("should return null when no combat is active", () => {
        gm.addNPC("npc1", "Target Dummy");
        expect(gm.processNPCTurn()).toBeNull();
      });

      it("should return null when it is not the NPC's turn", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        const p1 = gm.addPlayer("p1", "Alice");
        npc.position = { x: 500, y: 500 };
        p1.position = { x: 510, y: 500 };
        gm.startCombat("p1");
        const zone = gm.state.combatZone!;

        // If it's p1's turn, NPC should return null
        if (zone.currentTurn !== "npc1") {
          expect(gm.processNPCTurn()).toBeNull();
        }
      });

      it("should move and take a combat action when it is the NPC's turn", () => {
        const npc = gm.addNPC("npc1", "Target Dummy");
        const p1 = gm.addPlayer("p1", "Alice");
        npc.position = { x: 500, y: 500 };
        p1.position = { x: 510, y: 500 };
        gm.startCombat("p1");
        const zone = gm.state.combatZone!;

        // Advance to NPC turn if needed
        if (zone.currentTurn !== "npc1") {
          gm.advanceTurn();
        }
        expect(zone.currentTurn).toBe("npc1");

        const posBefore = { ...npc.position };
        const result = gm.processNPCTurn();
        expect(result).not.toBeNull();
        expect(result!.combatResult.success).toBe(true);
        expect(["fireLaser", "fireProjectile", "wait"]).toContain(result!.combatAction);

        // NPC should have moved
        expect(result!.moveResult).toBeDefined();
        expect(result!.moveResult!.path.length).toBeGreaterThan(1);
        expect(npc.position.x).not.toBeCloseTo(posBefore.x, 0);
      });

      it("should fire approximately 25% of the time over many turns", () => {
        let fireCount = 0;
        const iterations = 200;

        for (let i = 0; i < iterations; i++) {
          const gm2 = new GameStateManager();
          const npc = gm2.addNPC("npc1", "Target Dummy");
          const p1 = gm2.addPlayer("p1", "Alice");
          npc.position = { x: 500, y: 500 };
          p1.position = { x: 510, y: 500 };
          gm2.startCombat("p1");
          const zone = gm2.state.combatZone!;
          if (zone.currentTurn !== "npc1") gm2.advanceTurn();

          const result = gm2.processNPCTurn();
          if (result?.combatAction !== "wait") fireCount++;
        }

        // With 25% chance, expect roughly 50/200. Allow wide margin for randomness.
        expect(fireCount).toBeGreaterThan(15);
        expect(fireCount).toBeLessThan(90);
      });
    });

  });
});
