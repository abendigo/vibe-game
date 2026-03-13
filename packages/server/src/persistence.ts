import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Player, PlayerSkills, Velocity } from "@game/shared";
import { GamePhase, CarPartType, WeaponKind } from "@game/shared";
import type { GameStateManager } from "./gameState.js";
import type { StoredCredentials } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const SAVE_FILE = join(DATA_DIR, "gamestate.json");

const AUTO_SAVE_INTERVAL = 30_000; // 30 seconds

export interface SaveData {
  /** Player data keyed by name for reconnection */
  players: Record<string, SavedPlayer>;
  /** Credentials keyed by player name */
  credentials: Record<string, StoredCredentials>;
  savedAt: string;
}

interface SavedPlayer {
  name: string;
  position: { x: number; y: number };
  rotation: number;
  car: Player["car"];
  skills?: PlayerSkills;
  velocity?: Velocity;
}

function playerToSaved(player: Player): SavedPlayer {
  return {
    name: player.name,
    position: { ...player.position },
    rotation: player.rotation,
    car: structuredClone(player.car),
    skills: { ...player.skills },
    velocity: { ...player.velocity },
  };
}

export async function save(
  gameState: GameStateManager,
  credentials?: Record<string, StoredCredentials>
): Promise<void> {
  const players: Record<string, SavedPlayer> = {};
  for (const player of gameState.state.players.values()) {
    players[player.name] = playerToSaved(player);
  }

  // Merge with existing save to preserve credentials and offline player data
  const existing = await load();

  const data: SaveData = {
    players: { ...(existing?.players ?? {}), ...players },
    credentials: { ...(existing?.credentials ?? {}), ...(credentials ?? {}) },
    savedAt: new Date().toISOString(),
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SAVE_FILE, JSON.stringify(data, null, 2));
  console.log(`Game saved (${Object.keys(players).length} players)`);
}

export async function load(): Promise<SaveData | null> {
  try {
    const raw = await readFile(SAVE_FILE, "utf-8");
    const data = JSON.parse(raw) as SaveData;
    console.log(
      `Loaded save from ${data.savedAt} (${Object.keys(data.players).length} players)`
    );
    return data;
  } catch {
    console.log("No save file found, starting fresh");
    return null;
  }
}

/**
 * Restore a returning player's saved data onto their Player object.
 * Called when a player joins with a name that exists in the save.
 */
export function restorePlayer(
  player: Player,
  saved: SavedPlayer
): void {
  player.position = { ...saved.position };
  player.rotation = saved.rotation;
  player.velocity = saved.velocity ? { ...saved.velocity } : { speed: 0, heading: 0 };
  player.car = structuredClone(saved.car);
  if (saved.skills) {
    player.skills = { ...saved.skills };
  }

  // Migrate old cars: ensure both weapon types exist
  migrateWeapons(player);
}

function migrateWeapons(player: Player): void {
  const hasLaser = player.car.parts.some(
    (p) => p.type === CarPartType.Weapon && p.stats.weaponKind === WeaponKind.Laser
  );
  const hasProjectile = player.car.parts.some(
    (p) => p.type === CarPartType.Weapon && p.stats.weaponKind === WeaponKind.Projectile
  );

  // Remove old-style weapons without weaponKind
  player.car.parts = player.car.parts.filter(
    (p) => p.type !== CarPartType.Weapon || p.stats.weaponKind !== undefined
  );

  if (!hasLaser) {
    player.car.parts.push({
      id: crypto.randomUUID(),
      name: "Laser Emitter",
      type: CarPartType.Weapon,
      stats: {
        weaponKind: WeaponKind.Laser,
        damage: 8,
        range: 200,
        energy: 10,
        maxEnergy: 10,
      },
    });
  }

  if (!hasProjectile) {
    player.car.parts.push({
      id: crypto.randomUUID(),
      name: "Machine Gun",
      type: CarPartType.Weapon,
      stats: {
        weaponKind: WeaponKind.Projectile,
        damage: 4,
        range: 150,
        ammo: 20,
        maxAmmo: 20,
      },
    });
  }
}

/**
 * Start auto-save interval and register shutdown hooks.
 * Returns a cleanup function.
 */
export function startAutoSave(
  gameState: GameStateManager,
  getCredentials?: () => Record<string, StoredCredentials>
): () => void {
  const timer = setInterval(() => {
    save(gameState, getCredentials?.()).catch((err) =>
      console.error("Auto-save failed:", err)
    );
  }, AUTO_SAVE_INTERVAL);

  const shutdown = () => {
    clearInterval(timer);
    save(gameState, getCredentials?.())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return () => {
    clearInterval(timer);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  };
}
