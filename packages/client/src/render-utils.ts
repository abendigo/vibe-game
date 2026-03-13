import type { Vec2, CombatZone, Player, PlayerSkills } from "@game/shared";
import { WeaponKind } from "@game/shared";

// ── Constants ──

export const GRID_SIZE = 100;
export const GRID_CELLS = 40;
export const WORLD_SIZE = GRID_SIZE * GRID_CELLS; // 4000
export const MINIMAP_SIZE = 150;
export const MINIMAP_PADDING = 10;
export const MINIMAP_SCALE = MINIMAP_SIZE / WORLD_SIZE;
export const CAR_WIDTH = 30;
export const CAR_HEIGHT = 20;
export const PLAYER_COLORS = [0x4fc3f7, 0xef5350, 0x66bb6a, 0xffa726, 0xab47bc, 0xffee58];

// ── Pure functions ──

export function screenToWorld(
  screenX: number,
  screenY: number,
  worldOffsetX: number,
  worldOffsetY: number
): Vec2 {
  return {
    x: screenX - worldOffsetX,
    y: screenY - worldOffsetY,
  };
}

export function computeCameraPosition(
  canvasWidth: number,
  canvasHeight: number,
  playerPosition: Vec2
): Vec2 {
  return {
    x: canvasWidth / 2 - playerPosition.x,
    y: canvasHeight / 2 - playerPosition.y,
  };
}

export function assignPlayerColor(
  playerId: string,
  colorMap: Map<string, number>,
  colorIndex: number
): { color: number; newIndex: number } {
  if (colorMap.has(playerId)) {
    return { color: colorMap.get(playerId)!, newIndex: colorIndex };
  }
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  colorMap.set(playerId, color);
  return { color, newIndex: colorIndex + 1 };
}

export function worldToMinimap(worldPos: Vec2): Vec2 {
  return {
    x: worldPos.x * MINIMAP_SCALE,
    y: worldPos.y * MINIMAP_SCALE,
  };
}

export function computeMinimapViewport(
  worldOffsetX: number,
  worldOffsetY: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: -worldOffsetX * MINIMAP_SCALE,
    y: -worldOffsetY * MINIMAP_SCALE,
    width: canvasWidth * MINIMAP_SCALE,
    height: canvasHeight * MINIMAP_SCALE,
  };
}

export function computeMinimapCombatZone(
  zone: CombatZone
): { cx: number; cy: number; cr: number } {
  return {
    cx: zone.center.x * MINIMAP_SCALE,
    cy: zone.center.y * MINIMAP_SCALE,
    cr: zone.radius * MINIMAP_SCALE,
  };
}

export function hpBarColor(hpRatio: number): number {
  if (hpRatio > 0.5) return 0x66bb6a;  // green
  if (hpRatio > 0.25) return 0xffa726;  // orange
  return 0xef5350;                       // red
}

export function rotationToCompass(radians: number): string {
  // Normalize to [0, 2π)
  const r = ((radians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const index = Math.round(r / (Math.PI / 4)) % 8;
  return directions[index];
}

export interface PlayerStats {
  name: string;
  hp: number;
  maxHp: number;
  speed: number;
  currentSpeed: number;
  maxSpeed: number;
  armor: number;
  damage: number;
  weaponRange: number;
  laserDamage: number;
  laserEnergy: number;
  maxLaserEnergy: number;
  laserRange: number;
  projectileDamage: number;
  projectileAmmo: number;
  maxProjectileAmmo: number;
  projectileRange: number;
  direction: string;
  position: Vec2;
  inCombat: boolean;
  partCount: number;
  skills: PlayerSkills;
  combatMovementRemaining: number;
}

export function computePlayerStats(
  player: Player,
  combatZone: CombatZone | undefined | null
): PlayerStats {
  const speedBonus = player.car.parts
    .filter((p) => p.stats.speed)
    .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);

  const armorBonus = player.car.parts
    .filter((p) => p.stats.armor)
    .reduce((sum, p) => sum + (p.stats.armor ?? 0), 0);

  const weapon = player.car.parts.find((p) => p.stats.damage);

  const laser = player.car.parts.find(
    (p) => p.stats.weaponKind === WeaponKind.Laser
  );
  const projectile = player.car.parts.find(
    (p) => p.stats.weaponKind === WeaponKind.Projectile
  );

  const effectiveSpeed = player.car.baseSpeed + speedBonus;
  const budget = player.combatMovementBudget ?? 30;
  const used = player.combatMovementUsed ?? 0;

  return {
    name: player.name,
    hp: player.car.baseHealth,
    maxHp: 100,
    speed: effectiveSpeed,
    currentSpeed: player.velocity.speed,
    maxSpeed: effectiveSpeed,
    armor: player.car.baseArmor + armorBonus,
    damage: weapon?.stats.damage ?? 0,
    weaponRange: weapon?.stats.range ?? 0,
    laserDamage: laser?.stats.damage ?? 0,
    laserEnergy: laser?.stats.energy ?? 0,
    maxLaserEnergy: laser?.stats.maxEnergy ?? 0,
    laserRange: laser?.stats.range ?? 0,
    projectileDamage: projectile?.stats.damage ?? 0,
    projectileAmmo: projectile?.stats.ammo ?? 0,
    maxProjectileAmmo: projectile?.stats.maxAmmo ?? 0,
    projectileRange: projectile?.stats.range ?? 0,
    direction: rotationToCompass(player.rotation),
    position: { x: Math.round(player.position.x), y: Math.round(player.position.y) },
    inCombat: combatZone?.combatantIds.includes(player.id) ?? false,
    partCount: player.car.parts.length,
    skills: player.skills,
    combatMovementRemaining: Math.max(0, budget - used),
  };
}
