// ── Core types ──

export interface Vec2 {
  x: number;
  y: number;
}

export interface Velocity {
  speed: number;
  heading: number;
}

// ── Physics constants ──

export const PHYSICS = {
  MAX_TURN_RATE: 0.06,         // radians per tick at full steering angle
  MIN_SPEED_FOR_TURN: 0.3,     // minimum speed to allow steering
  STEERING_STEP: 5,            // degrees per discrete steering tap
  MAX_STEERING_ANGLE: 45,      // degrees, max absolute steering angle
  MAP_SIZE: 4000,              // world is 0..MAP_SIZE on both axes
  TILE_SIZE: 100,              // pixels per tile
  MAP_TILES: 40,               // MAP_SIZE / TILE_SIZE
} as const;

export enum TileType {
  Grass = 0,
  Road = 1,
  Building = 2,
}

export interface BuildingDef {
  x: number;       // tile column
  y: number;       // tile row
  width: number;   // tiles wide
  height: number;  // tiles tall
  color: number;   // hex color for rendering
  name?: string;
}

export interface TownMapData {
  tiles: TileType[][];
  buildings: BuildingDef[];
  npcWaypoints: Vec2[];  // world coordinates
}

export enum CarPartType {
  Engine = "Engine",
  Wheels = "Wheels",
  Armor = "Armor",
  Weapon = "Weapon",
  Accessory = "Accessory",
}

export enum WeaponKind {
  Laser = "Laser",
  Projectile = "Projectile",
}

export interface PartStats {
  speed?: number;
  armor?: number;
  damage?: number;
  health?: number;
  range?: number;
  weaponKind?: WeaponKind;
  energy?: number;
  maxEnergy?: number;
  ammo?: number;
  maxAmmo?: number;
  cooldown?: number;
  maxCooldown?: number;
}

export interface CarPart {
  id: string;
  name: string;
  type: CarPartType;
  stats: PartStats;
}

export interface Car {
  id: string;
  parts: CarPart[];
  baseSpeed: number;
  baseArmor: number;
  baseHealth: number;
}

export interface PlayerSkills {
  driving: number;
  gunnery: number;
  luck: number;
}

export interface Player {
  id: string;
  name: string;
  position: Vec2;
  rotation: number;
  velocity: Velocity;
  steeringAngle: number;  // degrees, current steering angle for ghost preview
  car: Car;
  skills: PlayerSkills;
  combatMovementBudget?: number;
  combatMovementUsed?: number;
  isNPC?: boolean;
}

export enum GamePhase {
  Lobby = "Lobby",
  Exploring = "Exploring",
  Combat = "Combat",
  Shopping = "Shopping",
}

export interface CombatZone {
  center: Vec2;
  radius: number;
  combatantIds: string[];
  turnOrder: string[];
  currentTurn: string;
}

export interface GameState {
  players: Map<string, Player>;
  phase: GamePhase;
  combatZone?: CombatZone;
  /** @deprecated Use combatZone.turnOrder instead */
  turnOrder?: string[];
  /** @deprecated Use combatZone.currentTurn instead */
  currentTurn?: string;
}

// ── Serializable version of GameState for network transfer ──

export interface SerializedGameState {
  players: [string, Player][];
  phase: GamePhase;
  combatZone?: CombatZone;
  turnOrder?: string[];
  currentTurn?: string;
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    players: Array.from(state.players.entries()),
    phase: state.phase,
    combatZone: state.combatZone,
    turnOrder: state.turnOrder,
    currentTurn: state.currentTurn,
  };
}

export function deserializeGameState(data: SerializedGameState): GameState {
  return {
    players: new Map(data.players),
    phase: data.phase,
    combatZone: data.combatZone,
    turnOrder: data.turnOrder,
    currentTurn: data.currentTurn,
  };
}

// ── Combat actions ──

export interface WeaponAnimationData {
  kind: "laser" | "projectile";
  from: Vec2;
  to: Vec2;
  hit: boolean;
}

export interface CombatResult {
  success: boolean;
  message: string;
  animation?: WeaponAnimationData;
  /** Roll details for game log display */
  roll?: number;
  chance?: number;
}

export type CombatAction =
  | { type: "move"; target: Vec2 }
  | { type: "attack"; targetId: string; weaponPartId: string }
  | { type: "fireLaser" }
  | { type: "fireProjectile" }
  | { type: "useItem"; itemId: string }
  | { type: "wait" };

// ── WebSocket messages ──

export interface DriveState {
  targetSpeed: number;    // integer 0..maxSpeed
  steeringAngle: number;  // degrees, -MAX_STEERING_ANGLE..MAX_STEERING_ANGLE
}

export type ClientMessage =
  | { type: "join"; name: string; password: string }
  | { type: "reconnect"; token: string }
  | { type: "driveState"; targetSpeed: number; steeringAngle: number }
  | { type: "startCombat" }
  | { type: "combatAction"; action: CombatAction }
  | { type: "combatMoveConfirm"; driveState: DriveState; ticks: number }
  | { type: "endTurn" }
  | { type: "respawn" };

export type ServerMessage =
  | { type: "authenticated"; playerId: string; token: string }
  | { type: "gameState"; state: SerializedGameState }
  | { type: "playerJoined"; player: Player }
  | { type: "playerLeft"; id: string }
  | { type: "combatStart"; combatZone: CombatZone }
  | {
      type: "combatUpdate";
      action: CombatAction;
      result: CombatResult;
    }
  | { type: "combatJoin"; playerId: string; combatZone: CombatZone }
  | { type: "combatEscape"; playerId: string; playerName: string }
  | { type: "combatMoveResult"; playerId: string; path: Vec2[]; finalPosition: Vec2; finalHeading: number; distanceUsed: number }
  | { type: "turnChange"; playerId: string }
  | { type: "error"; message: string };
