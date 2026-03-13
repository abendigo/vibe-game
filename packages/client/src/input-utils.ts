import type { Vec2, CombatZone, DriveState } from "@game/shared";

export function isPlayerInCombat(
  localPlayerId: string | null,
  combatZone: CombatZone | null | undefined
): boolean {
  if (!localPlayerId || !combatZone) return false;
  return combatZone.combatantIds.includes(localPlayerId);
}

export function findNearestPlayer(
  clickPos: Vec2,
  players: Map<string, { id: string; position: Vec2 }>,
  localPlayerId: string | null,
  maxDistance: number
): string | null {
  let nearestId: string | null = null;
  let nearestDist = Infinity;

  for (const [id, p] of players) {
    if (id === localPlayerId) continue;
    const dx = p.position.x - clickPos.x;
    const dy = p.position.y - clickPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist && dist < maxDistance) {
      nearestDist = dist;
      nearestId = id;
    }
  }

  return nearestId;
}

export function driveStateChanged(
  prev: DriveState | null,
  current: DriveState
): boolean {
  if (!prev) return true;
  return prev.targetSpeed !== current.targetSpeed || prev.steeringAngle !== current.steeringAngle;
}

export function shouldSendDriveState(
  isConnected: boolean,
  prev: DriveState | null,
  current: DriveState
): boolean {
  if (!isConnected) return false;
  return driveStateChanged(prev, current);
}
