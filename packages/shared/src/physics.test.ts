import { describe, it, expect } from "vitest";
import { simulatePhysics } from "./physics.js";
import { PHYSICS } from "./types.js";

describe("simulatePhysics", () => {
  it("should move forward at set speed (instant, no acceleration curve)", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 5, heading: 0, steeringAngle: 0 },
      8,
      1000,
      10
    );

    expect(result.final.speed).toBe(5);
    expect(result.final.position.x).toBeCloseTo(50); // 5 * 10 ticks
    expect(result.final.position.y).toBeCloseTo(0);
    expect(result.distanceUsed).toBeCloseTo(50);
    expect(result.ticksUsed).toBe(10);
  });

  it("should not move when speed is 0", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 0, heading: 0, steeringAngle: 0 },
      8,
      1000,
      10
    );

    expect(result.final.speed).toBe(0);
    expect(result.final.position.x).toBe(0);
    expect(result.final.position.y).toBe(0);
    expect(result.distanceUsed).toBe(0);
    expect(result.ticksUsed).toBe(1); // stops immediately
  });

  it("should maintain constant heading with steeringAngle=0", () => {
    const heading = Math.PI / 4;
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading, steeringAngle: 0 },
      8,
      1000,
      10
    );

    expect(result.final.heading).toBe(heading);
  });

  it("should turn with positive steeringAngle", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 45 },
      8,
      1000,
      10
    );

    // Turn rate = (45/45) * 0.06 = 0.06 rad/tick, over 10 ticks = 0.6 rad
    expect(result.final.heading).toBeCloseTo(0.6);
  });

  it("should turn with negative steeringAngle", () => {
    const result = simulatePhysics(
      { position: { x: 1000, y: 1000 }, speed: 3, heading: 0, steeringAngle: -45 },
      8,
      1000,
      10
    );

    expect(result.final.heading).toBeCloseTo(-0.6);
  });

  it("should not steer below MIN_SPEED_FOR_TURN", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 0.1, heading: 0, steeringAngle: 45 },
      8,
      1000,
      10
    );

    // Speed 0.1 < MIN_SPEED_FOR_TURN (0.3), so heading should not change
    expect(result.final.heading).toBe(0);
  });

  it("should have proportional turn rate based on steering angle", () => {
    const result1 = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 15 },
      8,
      1000,
      10
    );
    const result2 = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 45 },
      8,
      1000,
      10
    );

    // 15/45 = 1/3, so heading change should be 1/3 of full
    expect(result1.final.heading).toBeCloseTo(result2.final.heading / 3, 5);
  });

  it("should persist steering angle (no auto-centering)", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 20 },
      8,
      1000,
      10
    );

    // steeringAngle should remain 20 in the final snapshot
    expect(result.final.steeringAngle).toBe(20);
  });

  it("should move diagonally with angled heading", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: Math.PI / 4, steeringAngle: 0 },
      8,
      1000,
      10
    );

    // cos(pi/4) = sin(pi/4) ~ 0.707
    const expected = 3 * 10 * Math.cos(Math.PI / 4);
    expect(result.final.position.x).toBeCloseTo(expected);
    expect(result.final.position.y).toBeCloseTo(expected);
  });

  it("should cap distance used at budget remaining", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 5, heading: 0, steeringAngle: 0 },
      8,
      10,
      200
    );

    expect(result.distanceUsed).toBe(10);
    expect(result.ticksUsed).toBeLessThan(200);
  });

  it("should cap speed at maxSpeed", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 10, heading: 0, steeringAngle: 0 },
      8,
      10000,
      10
    );

    expect(result.final.speed).toBe(8);
    // Should move at clamped speed
    expect(result.final.position.x).toBeCloseTo(80);
  });

  it("should return path samples at regular intervals", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 0 },
      8,
      1000,
      20
    );

    // 20 ticks / 4 sample interval = 5 samples + start + possibly final
    expect(result.path.length).toBeGreaterThanOrEqual(5);
  });

  it("should always include the final position in path", () => {
    const result = simulatePhysics(
      { position: { x: 0, y: 0 }, speed: 3, heading: 0, steeringAngle: 0 },
      8,
      1000,
      7 // Not a multiple of 4
    );

    const lastPoint = result.path[result.path.length - 1];
    expect(lastPoint.x).toBeCloseTo(result.final.position.x);
    expect(lastPoint.y).toBeCloseTo(result.final.position.y);
  });

  it("should include start position in path", () => {
    const result = simulatePhysics(
      { position: { x: 100, y: 200 }, speed: 3, heading: 0, steeringAngle: 0 },
      8,
      1000,
      5
    );

    expect(result.path[0]).toEqual({ x: 100, y: 200 });
  });

  it("should be deterministic (same inputs produce same outputs)", () => {
    const snapshot = { position: { x: 100, y: 200 }, speed: 3, heading: 0.5, steeringAngle: 10 };

    const result1 = simulatePhysics(snapshot, 8, 100, 50);
    const result2 = simulatePhysics(snapshot, 8, 100, 50);

    expect(result1.final).toEqual(result2.final);
    expect(result1.distanceUsed).toBe(result2.distanceUsed);
    expect(result1.ticksUsed).toBe(result2.ticksUsed);
    expect(result1.path).toEqual(result2.path);
  });

  it("should not modify the input snapshot", () => {
    const snapshot = { position: { x: 100, y: 200 }, speed: 3, heading: 0, steeringAngle: 15 };
    const snapshotCopy = { position: { ...snapshot.position }, speed: snapshot.speed, heading: snapshot.heading, steeringAngle: snapshot.steeringAngle };

    simulatePhysics(snapshot, 8, 1000, 10);

    expect(snapshot).toEqual(snapshotCopy);
  });
});
