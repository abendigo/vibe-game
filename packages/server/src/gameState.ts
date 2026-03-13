import {
  type GameState,
  type CombatZone,
  type PlayerSkills,
  type CombatResult,
  type DriveState,
  GamePhase,
  type Player,
  type Car,
  type Vec2,
  type CombatAction,
  CarPartType,
  WeaponKind,
  PHYSICS,
  simulatePhysics,
  TOWN_MAP,
} from "@game/shared";

const COMBAT_RADIUS = 300;
const NPC_FIRE_CHANCE = 0.25;
const NPC_WAYPOINT_THRESHOLD = 80; // px — distance to advance to next waypoint
const ESCAPE_DISTANCE = 1000;
const COMBAT_TICKS_PER_TURN = 30;

function defaultSkills(): PlayerSkills {
  return { driving: 1, gunnery: 1, luck: 1 };
}

function createDefaultCar(): Car {
  return {
    id: crypto.randomUUID(),
    parts: [
      {
        id: crypto.randomUUID(),
        name: "Basic Engine",
        type: CarPartType.Engine,
        stats: { speed: 3 },
      },
      {
        id: crypto.randomUUID(),
        name: "Standard Wheels",
        type: CarPartType.Wheels,
        stats: { speed: 1 },
      },
      {
        id: crypto.randomUUID(),
        name: "Light Plating",
        type: CarPartType.Armor,
        stats: { armor: 2 },
      },
      {
        id: crypto.randomUUID(),
        name: "Laser Emitter",
        type: CarPartType.Weapon,
        stats: {
          weaponKind: WeaponKind.Laser,
          damage: 8,
          range: 200,
          energy: 10,
          maxEnergy: 10,
          cooldown: 0,
          maxCooldown: 3,
        },
      },
      {
        id: crypto.randomUUID(),
        name: "Machine Gun",
        type: CarPartType.Weapon,
        stats: {
          weaponKind: WeaponKind.Projectile,
          damage: 4,
          range: 150,
          ammo: 20,
          maxAmmo: 20,
          cooldown: 0,
          maxCooldown: 2,
        },
      },
    ],
    baseSpeed: 4,
    baseArmor: 2,
    baseHealth: 100,
  };
}

export class GameStateManager {
  state: GameState;
  playerDriveStates: Map<string, DriveState> = new Map();
  private npcWaypointIndex: Map<string, number> = new Map();

  constructor() {
    this.state = {
      players: new Map(),
      phase: GamePhase.Exploring,
    };
  }

  addPlayer(id: string, name: string): Player {
    const player: Player = {
      id,
      name,
      position: {
        x: 1950 + Math.random() * 100,
        y: 3400 + Math.random() * 200,
      },
      rotation: 0,
      velocity: { speed: 0, heading: 0 },
      steeringAngle: 0,
      car: createDefaultCar(),
      skills: defaultSkills(),
    };
    this.state.players.set(id, player);
    return player;
  }

  addNPC(id: string, name: string): Player {
    const player: Player = {
      id,
      name,
      position: { ...TOWN_MAP.npcWaypoints[0] },
      rotation: 0,
      velocity: { speed: 3, heading: 0 },  // will orient toward waypoint 1 on first tick
      steeringAngle: 0,
      car: createDefaultCar(),
      skills: defaultSkills(),
      isNPC: true,
    };
    this.state.players.set(id, player);
    this.npcWaypointIndex.set(id, 0);
    this.playerDriveStates.set(id, { targetSpeed: 3, steeringAngle: 0 });
    return player;
  }

  /** NPC steers toward next waypoint on the road loop. */
  private computeNPCDriveState(player: Player): DriveState {
    const waypoints = TOWN_MAP.npcWaypoints;
    let wpIndex = this.npcWaypointIndex.get(player.id) ?? 0;
    const target = waypoints[wpIndex];

    const dx = target.x - player.position.x;
    const dy = target.y - player.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Advance to next waypoint if close enough
    if (dist < NPC_WAYPOINT_THRESHOLD) {
      wpIndex = (wpIndex + 1) % waypoints.length;
      this.npcWaypointIndex.set(player.id, wpIndex);
      return this.computeNPCDriveState(player);
    }

    // Steer toward waypoint
    const desiredHeading = Math.atan2(dy, dx);
    let headingError = desiredHeading - player.velocity.heading;
    headingError = Math.atan2(Math.sin(headingError), Math.cos(headingError));

    // Convert to discrete steering angle in 5° steps, clamped to ±45°
    const steeringDeg = Math.round((headingError * 180 / Math.PI) / PHYSICS.STEERING_STEP) * PHYSICS.STEERING_STEP;
    const steeringAngle = Math.max(-PHYSICS.MAX_STEERING_ANGLE, Math.min(PHYSICS.MAX_STEERING_ANGLE, steeringDeg));

    return { targetSpeed: 3, steeringAngle };
  }

  /** Update NPC drive state to maintain a wide circle around NPC_CIRCLE_CENTER. */
  tickNPCInput(): void {
    for (const [id, player] of this.state.players) {
      if (!player.isNPC) continue;
      if (this.isInCombat(id)) continue;
      const driveState = this.computeNPCDriveState(player);
      this.playerDriveStates.set(id, driveState);
    }
  }

  /**
   * Process an NPC's combat turn. Moves first (using full budget to continue circling),
   * then 25% chance to fire back. Returns null if not NPC's turn.
   */
  processNPCTurn(): {
    moveResult?: { path: Vec2[]; finalPosition: Vec2; finalHeading: number; distanceUsed: number };
    combatResult: CombatResult;
    combatAction: string;
  } | null {
    const zone = this.state.combatZone;
    if (!zone) return null;

    const player = this.state.players.get(zone.currentTurn);
    if (!player?.isNPC) return null;

    // Step 1: Move — compute drive state for circling, then move
    const budget = player.combatMovementBudget ?? COMBAT_TICKS_PER_TURN;
    const used = player.combatMovementUsed ?? 0;
    const remaining = budget - used;

    let moveResult: { path: Vec2[]; finalPosition: Vec2; finalHeading: number; distanceUsed: number } | undefined;
    if (remaining > 0) {
      const driveState = this.computeNPCDriveState(player);
      const move = this.processCombatMove(zone.currentTurn, driveState, 200);
      if (move.success && move.path) {
        moveResult = {
          path: move.path,
          finalPosition: move.finalPosition!,
          finalHeading: move.finalHeading!,
          distanceUsed: move.distanceUsed!,
        };
      }
    }

    // Step 2: Maybe fire (25% chance)
    if (Math.random() < NPC_FIRE_CHANCE) {
      const laser = player.car.parts.find(
        (p) => p.stats.weaponKind === WeaponKind.Laser && (p.stats.energy ?? 0) > 0 && (p.stats.cooldown ?? 0) <= 0
      );
      const projectile = player.car.parts.find(
        (p) => p.stats.weaponKind === WeaponKind.Projectile && (p.stats.ammo ?? 0) > 0 && (p.stats.cooldown ?? 0) <= 0
      );

      if (laser) {
        const result = this.processCombatAction(zone.currentTurn, { type: "fireLaser" });
        if (result.success) return { moveResult, combatResult: result, combatAction: "fireLaser" };
      }
      if (projectile) {
        const result = this.processCombatAction(zone.currentTurn, { type: "fireProjectile" });
        if (result.success) return { moveResult, combatResult: result, combatAction: "fireProjectile" };
      }
    }

    // Default: wait
    const result = this.processCombatAction(zone.currentTurn, { type: "wait" });
    return { moveResult, combatResult: result, combatAction: "wait" };
  }

  removePlayer(id: string): void {
    this.state.players.delete(id);

    // If player was in combat, clean up combat zone
    const zone = this.state.combatZone;
    if (zone && zone.combatantIds.includes(id)) {
      zone.combatantIds = zone.combatantIds.filter((pid) => pid !== id);
      zone.turnOrder = zone.turnOrder.filter((pid) => pid !== id);
      if (zone.currentTurn === id) {
        this.advanceTurn();
      }
      // End combat if fewer than 2 combatants remain
      if (zone.combatantIds.length < 2) {
        this.endCombat();
      }
    }
  }

  isInCombat(playerId: string): boolean {
    return this.state.combatZone?.combatantIds.includes(playerId) ?? false;
  }

  setDriveState(playerId: string, driveState: DriveState): void {
    this.playerDriveStates.set(playerId, driveState);
  }

  getEffectiveSpeed(player: Player): number {
    const speedBonus = player.car.parts
      .filter((p) => p.stats.speed)
      .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);
    return player.car.baseSpeed + speedBonus;
  }

  /** Apply physics for a single player. Returns distance moved. */
  private applyPhysics(player: Player): number {
    const maxSpeed = this.getEffectiveSpeed(player);
    const driveState = this.playerDriveStates.get(player.id);

    // Set speed from drive state (instant, no acceleration curve)
    if (driveState) {
      player.velocity.speed = Math.max(0, Math.min(driveState.targetSpeed, maxSpeed));
      player.steeringAngle = driveState.steeringAngle;
    }

    // Clamp speed
    player.velocity.speed = Math.max(0, Math.min(player.velocity.speed, maxSpeed));

    // Apply steering: turn rate proportional to steering angle
    if (driveState && player.velocity.speed >= PHYSICS.MIN_SPEED_FOR_TURN && driveState.steeringAngle !== 0) {
      const turnRate = (driveState.steeringAngle / PHYSICS.MAX_STEERING_ANGLE) * PHYSICS.MAX_TURN_RATE;
      player.velocity.heading += turnRate;
    }

    // Update position from velocity
    let distMoved = 0;
    if (player.velocity.speed > 0) {
      player.position.x += Math.cos(player.velocity.heading) * player.velocity.speed;
      player.position.y += Math.sin(player.velocity.heading) * player.velocity.speed;

      // Clamp to map bounds — stop at edges
      const clampedX = Math.max(0, Math.min(player.position.x, PHYSICS.MAP_SIZE));
      const clampedY = Math.max(0, Math.min(player.position.y, PHYSICS.MAP_SIZE));
      if (clampedX !== player.position.x || clampedY !== player.position.y) {
        player.position.x = clampedX;
        player.position.y = clampedY;
        player.velocity.speed = 0;
      }

      player.rotation = player.velocity.heading;
      distMoved = player.velocity.speed;
    }

    return distMoved;
  }

  /** Called once per server tick to update all players' physics. Returns IDs of players that entered combat. */
  tickPhysics(): string[] {
    const joinedCombat: string[] = [];
    const zone = this.state.combatZone;

    for (const [id, player] of this.state.players) {
      // Combat players don't move via tick loop — they use preview-then-confirm
      if (this.isInCombat(id)) continue;

      // Non-combat player: free movement
      this.applyPhysics(player);

      // Check if player entered an active combat zone
      if (zone && !zone.combatantIds.includes(id)) {
        const dx = player.position.x - zone.center.x;
        const dy = player.position.y - zone.center.y;
        if (Math.sqrt(dx * dx + dy * dy) <= zone.radius) {
          this.addToCombat(id);
          joinedCombat.push(id);
        }
      }
    }

    return joinedCombat;
  }

  addToCombat(playerId: string): boolean {
    const zone = this.state.combatZone;
    if (!zone || zone.combatantIds.includes(playerId)) return false;

    zone.combatantIds.push(playerId);

    // Insert into turn order after the current turn
    const currentIndex = zone.turnOrder.indexOf(zone.currentTurn);
    zone.turnOrder.splice(currentIndex + 1, 0, playerId);

    // Keep legacy fields in sync
    this.state.turnOrder = zone.turnOrder;
    return true;
  }

  startCombat(initiatorId: string): CombatZone | null {
    // Can't start combat if one is already active
    if (this.state.combatZone) return null;

    const initiator = this.state.players.get(initiatorId);
    if (!initiator) return null;

    const center = { ...initiator.position };

    // Find all players within the combat radius
    const combatantIds: string[] = [];
    for (const [id, player] of this.state.players) {
      const dx = player.position.x - center.x;
      const dy = player.position.y - center.y;
      if (Math.sqrt(dx * dx + dy * dy) <= COMBAT_RADIUS) {
        combatantIds.push(id);
      }
    }

    if (combatantIds.length < 2) return null;

    // Shuffle for turn order
    const turnOrder = [...combatantIds];
    for (let i = turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
    }

    const zone: CombatZone = {
      center,
      radius: COMBAT_RADIUS,
      combatantIds,
      turnOrder,
      currentTurn: turnOrder[0],
    };

    this.state.combatZone = zone;
    this.state.phase = GamePhase.Combat;
    this.state.turnOrder = zone.turnOrder;
    this.state.currentTurn = zone.currentTurn;

    // Set initial movement budget for the first player's turn
    const firstPlayer = this.state.players.get(zone.currentTurn);
    if (firstPlayer) {
      firstPlayer.combatMovementUsed = 0;
      firstPlayer.combatMovementBudget = COMBAT_TICKS_PER_TURN;
    }

    return zone;
  }

  endCombat(): void {
    this.state.combatZone = undefined;
    this.state.phase = GamePhase.Exploring;
    this.state.turnOrder = undefined;
    this.state.currentTurn = undefined;
  }

  processCombatMove(
    playerId: string,
    driveState: DriveState,
    ticks: number
  ): { success: boolean; message: string; path?: Vec2[]; finalPosition?: Vec2; finalHeading?: number; distanceUsed?: number } {
    const zone = this.state.combatZone;
    if (!zone) return { success: false, message: "No active combat" };
    if (zone.currentTurn !== playerId) return { success: false, message: "Not your turn" };

    const player = this.state.players.get(playerId);
    if (!player) return { success: false, message: "Player not found" };

    const maxSpeed = this.getEffectiveSpeed(player);
    const budget = player.combatMovementBudget ?? COMBAT_TICKS_PER_TURN;
    const usedTicks = player.combatMovementUsed ?? 0;
    const remainingTicks = budget - usedTicks;

    if (remainingTicks <= 0) return { success: false, message: "Movement budget exhausted" };

    // Tick-based budget: use remaining ticks as maxTicks, large distance budget
    const maxTicks = Math.min(ticks, remainingTicks);
    const result = simulatePhysics(
      {
        position: { ...player.position },
        speed: Math.max(0, Math.min(driveState.targetSpeed, maxSpeed)),
        heading: player.velocity.heading,
        steeringAngle: driveState.steeringAngle,
      },
      maxSpeed,
      Infinity,
      maxTicks
    );

    // Apply result to player
    player.position = { ...result.final.position };
    player.velocity.speed = result.final.speed;
    player.velocity.heading = result.final.heading;
    player.rotation = result.final.heading;
    player.steeringAngle = driveState.steeringAngle;
    player.combatMovementUsed = usedTicks + result.ticksUsed;

    return {
      success: true,
      message: `${player.name} moved`,
      path: result.path,
      finalPosition: result.final.position,
      finalHeading: result.final.heading,
      distanceUsed: result.distanceUsed,
    };
  }

  processCombatAction(
    playerId: string,
    action: CombatAction
  ): CombatResult {
    const zone = this.state.combatZone;
    if (!zone) {
      return { success: false, message: "No active combat" };
    }
    if (zone.currentTurn !== playerId) {
      return { success: false, message: "Not your turn" };
    }

    const player = this.state.players.get(playerId);
    if (!player) {
      return { success: false, message: "Player not found" };
    }

    switch (action.type) {
      case "move": {
        // Movement in combat is now handled by WASD physics + budget in tickPhysics
        return { success: false, message: "Use WASD to move in combat" };
      }

      case "attack": {
        const target = this.state.players.get(action.targetId);
        if (!target) {
          return { success: false, message: "Target not found" };
        }

        const weapon = player.car.parts.find(
          (p) => p.id === action.weaponPartId && p.type === CarPartType.Weapon
        );
        if (!weapon) {
          return { success: false, message: "Weapon not found" };
        }

        const dx = target.position.x - player.position.x;
        const dy = target.position.y - player.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > (weapon.stats.range ?? 100)) {
          return { success: false, message: "Target out of range" };
        }

        const damage = weapon.stats.damage ?? 0;
        const armor = target.car.parts
          .filter((p) => p.stats.armor)
          .reduce((sum, p) => sum + (p.stats.armor ?? 0), 0);
        const actualDamage = Math.max(1, damage - armor);
        target.car.baseHealth -= actualDamage;

        return {
          success: true,
          message: `${player.name} hit ${target.name} for ${actualDamage} damage`,
        };
      }

      case "fireLaser":
        return this.fireWeapon(player, zone, WeaponKind.Laser);

      case "fireProjectile":
        return this.fireWeapon(player, zone, WeaponKind.Projectile);

      case "useItem": {
        return { success: false, message: "Items not implemented yet" };
      }

      case "wait": {
        return { success: true, message: `${player.name} waits` };
      }
    }
  }

  private fireWeapon(
    player: Player,
    zone: CombatZone,
    kind: WeaponKind
  ): CombatResult {
    const weapon = player.car.parts.find(
      (p) =>
        p.type === CarPartType.Weapon && p.stats.weaponKind === kind
    );
    if (!weapon) {
      return { success: false, message: `No ${kind} weapon equipped` };
    }

    // Check cooldown
    if ((weapon.stats.cooldown ?? 0) > 0) {
      return { success: false, message: `${kind} on cooldown (${weapon.stats.cooldown} turns)` };
    }

    // Check ammo/energy
    if (kind === WeaponKind.Laser) {
      if ((weapon.stats.energy ?? 0) <= 0) {
        return { success: false, message: "Out of energy" };
      }
    } else {
      if ((weapon.stats.ammo ?? 0) <= 0) {
        return { success: false, message: "Out of ammo" };
      }
    }

    // Find targets in range
    const range = weapon.stats.range ?? 100;
    const targetsInRange: Player[] = [];
    for (const id of zone.combatantIds) {
      if (id === player.id) continue;
      const target = this.state.players.get(id);
      if (!target) continue;
      const dx = target.position.x - player.position.x;
      const dy = target.position.y - player.position.y;
      if (Math.sqrt(dx * dx + dy * dy) <= range) {
        targetsInRange.push(target);
      }
    }

    if (targetsInRange.length === 0) {
      return { success: false, message: "No targets in range" };
    }

    // Random target selection
    const target =
      targetsInRange[Math.floor(Math.random() * targetsInRange.length)];

    // Consume resource and start cooldown
    if (kind === WeaponKind.Laser) {
      weapon.stats.energy = (weapon.stats.energy ?? 1) - 1;
    } else {
      weapon.stats.ammo = (weapon.stats.ammo ?? 1) - 1;
    }
    weapon.stats.cooldown = weapon.stats.maxCooldown ?? 0;

    const dx = target.position.x - player.position.x;
    const dy = target.position.y - player.position.y;

    const kindLabel = kind === WeaponKind.Laser ? "laser" : "projectile";

    // Hit chance: base 70% + gunnery*5%, clamped 30-95%
    const hitChance = Math.max(30, Math.min(95, 70 + player.skills.gunnery * 5));
    const hitRoll = Math.round(Math.random() * 100);
    const isHit = hitRoll <= hitChance;

    if (!isHit) {
      return {
        success: true,
        message: `${player.name} missed ${target.name} with ${kindLabel}`,
        roll: hitRoll,
        chance: hitChance,
        animation: {
          kind: kindLabel,
          from: { ...player.position },
          // Offset the "to" slightly to show a miss
          to: {
            x: target.position.x + (Math.random() - 0.5) * 60,
            y: target.position.y + (Math.random() - 0.5) * 60,
          },
          hit: false,
        },
      };
    }

    // Calculate damage
    const baseDamage = weapon.stats.damage ?? 0;
    const armor = target.car.parts
      .filter((p) => p.stats.armor)
      .reduce((sum, p) => sum + (p.stats.armor ?? 0), 0);
    const actualDamage = Math.max(1, baseDamage - armor);
    target.car.baseHealth -= actualDamage;

    return {
      success: true,
      message: `${player.name} hit ${target.name} with ${kindLabel} for ${actualDamage} damage`,
      roll: hitRoll,
      chance: hitChance,
      animation: {
        kind: kindLabel,
        from: { ...player.position },
        to: { ...target.position },
        hit: true,
      },
    };
  }

  /**
   * Check if a player has moved far enough from all other combatants to escape.
   * Returns the player ID if they escaped, null otherwise.
   */
  checkDistanceEscape(playerId: string): { escaped: boolean; playerName?: string } {
    const zone = this.state.combatZone;
    if (!zone || !zone.combatantIds.includes(playerId)) return { escaped: false };

    const player = this.state.players.get(playerId);
    if (!player) return { escaped: false };

    // Check distance to all other combatants
    for (const otherId of zone.combatantIds) {
      if (otherId === playerId) continue;
      const other = this.state.players.get(otherId);
      if (!other) continue;
      const dx = player.position.x - other.position.x;
      const dy = player.position.y - other.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ESCAPE_DISTANCE) return { escaped: false };
    }

    // Player is far enough — remove from combat
    zone.combatantIds = zone.combatantIds.filter((id) => id !== playerId);
    zone.turnOrder = zone.turnOrder.filter((id) => id !== playerId);
    this.state.turnOrder = zone.turnOrder;

    if (zone.currentTurn === playerId) {
      this.advanceTurn();
    }

    // End combat if fewer than 2 remain
    if (zone.combatantIds.length < 2) {
      this.endCombat();
    }

    return { escaped: true, playerName: player.name };
  }

  advanceTurn(): string | null {
    const zone = this.state.combatZone;
    if (!zone || zone.turnOrder.length === 0) return null;

    const currentIndex = zone.turnOrder.indexOf(zone.currentTurn);
    const nextIndex = (currentIndex + 1) % zone.turnOrder.length;
    zone.currentTurn = zone.turnOrder[nextIndex];

    // Reset movement budget and tick cooldowns for the next player
    const nextPlayer = this.state.players.get(zone.currentTurn);
    if (nextPlayer) {
      nextPlayer.combatMovementUsed = 0;
      nextPlayer.combatMovementBudget = COMBAT_TICKS_PER_TURN;

      // Tick weapon cooldowns down by 1
      for (const part of nextPlayer.car.parts) {
        if (part.type === CarPartType.Weapon && (part.stats.cooldown ?? 0) > 0) {
          part.stats.cooldown = (part.stats.cooldown ?? 0) - 1;
        }
      }
    }

    // Keep legacy fields in sync
    this.state.currentTurn = zone.currentTurn;
    return zone.currentTurn;
  }
}
