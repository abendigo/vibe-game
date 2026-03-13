import { PHYSICS, type Vec2 } from "./types.js";

export interface PhysicsSnapshot {
  position: Vec2;
  speed: number;
  heading: number;
  steeringAngle: number;  // degrees, -MAX_STEERING_ANGLE..MAX_STEERING_ANGLE
}

export interface SimulationResult {
  path: Vec2[];
  final: PhysicsSnapshot;
  distanceUsed: number;
  ticksUsed: number;
}

const PATH_SAMPLE_INTERVAL = 4;
const DEFAULT_MAX_TICKS = 200;

/**
 * Pure deterministic physics simulation. Both client (preview) and server (confirm) use this.
 * Runs forward from a snapshot until budget exhausted, max ticks reached, or speed is 0.
 *
 * Steering angle is persistent: turn rate per tick = (angle / MAX_STEERING_ANGLE) * MAX_TURN_RATE.
 * No auto-centering — the steering angle remains constant throughout the simulation.
 */
export function simulatePhysics(
  snapshot: PhysicsSnapshot,
  maxSpeed: number,
  budgetRemaining: number,
  maxTicks: number = DEFAULT_MAX_TICKS
): SimulationResult {
  let { speed, heading, steeringAngle } = snapshot;
  let x = snapshot.position.x;
  let y = snapshot.position.y;
  let distanceUsed = 0;
  const path: Vec2[] = [{ x, y }]; // Start with current position
  let ticksUsed = 0;

  // Clamp speed
  speed = Math.max(0, Math.min(speed, maxSpeed));

  for (let tick = 0; tick < maxTicks; tick++) {
    // Apply steering: turn rate proportional to steering angle
    if (speed >= PHYSICS.MIN_SPEED_FOR_TURN && steeringAngle !== 0) {
      const turnRate = (steeringAngle / PHYSICS.MAX_STEERING_ANGLE) * PHYSICS.MAX_TURN_RATE;
      heading += turnRate;
    }

    // Update position
    if (speed > 0) {
      x += Math.cos(heading) * speed;
      y += Math.sin(heading) * speed;
      distanceUsed += speed;

      // Clamp to map bounds — stop at edges
      const clamped = x !== Math.max(0, Math.min(x, PHYSICS.MAP_SIZE)) ||
                      y !== Math.max(0, Math.min(y, PHYSICS.MAP_SIZE));
      x = Math.max(0, Math.min(x, PHYSICS.MAP_SIZE));
      y = Math.max(0, Math.min(y, PHYSICS.MAP_SIZE));
      if (clamped) {
        speed = 0;
      }
    }

    ticksUsed = tick + 1;

    // Sample path every N ticks
    if (ticksUsed % PATH_SAMPLE_INTERVAL === 0) {
      path.push({ x, y });
    }

    // Stop conditions
    if (distanceUsed >= budgetRemaining) {
      distanceUsed = budgetRemaining;
      break;
    }

    if (speed === 0) {
      break;
    }
  }

  // Always include the final position
  const lastSample = path[path.length - 1];
  if (!lastSample || lastSample.x !== x || lastSample.y !== y) {
    path.push({ x, y });
  }

  return {
    path,
    final: { position: { x, y }, speed, heading, steeringAngle },
    distanceUsed,
    ticksUsed,
  };
}
