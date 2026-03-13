import { describe, it, expect } from "vitest";
import {
  serializeGameState,
  deserializeGameState,
  GamePhase,
  type GameState,
  type CombatZone,
} from "./index.js";

describe("serializeGameState / deserializeGameState", () => {
  it("should round-trip a basic game state", () => {
    const state: GameState = {
      players: new Map([
        [
          "p1",
          {
            id: "p1",
            name: "Alice",
            position: { x: 100, y: 200 },
            rotation: 1.5,
            velocity: { speed: 0, heading: 0 },
            steeringAngle: 0,
            car: {
              id: "c1",
              parts: [],
              baseSpeed: 4,
              baseArmor: 2,
              baseHealth: 100,
            },
            skills: { driving: 1, gunnery: 1, luck: 1 },
          },
        ],
      ]),
      phase: GamePhase.Exploring,
    };

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.players).toBeInstanceOf(Map);
    expect(deserialized.players.size).toBe(1);
    expect(deserialized.players.get("p1")?.name).toBe("Alice");
    expect(deserialized.phase).toBe(GamePhase.Exploring);
  });

  it("should preserve combat zone data", () => {
    const combatZone: CombatZone = {
      center: { x: 500, y: 500 },
      radius: 300,
      combatantIds: ["p1", "p2"],
      turnOrder: ["p2", "p1"],
      currentTurn: "p2",
    };

    const state: GameState = {
      players: new Map(),
      phase: GamePhase.Combat,
      combatZone,
      turnOrder: combatZone.turnOrder,
      currentTurn: combatZone.currentTurn,
    };

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.combatZone).toEqual(combatZone);
    expect(deserialized.turnOrder).toEqual(["p2", "p1"]);
    expect(deserialized.currentTurn).toBe("p2");
  });

  it("should handle empty player map", () => {
    const state: GameState = {
      players: new Map(),
      phase: GamePhase.Lobby,
    };

    const deserialized = deserializeGameState(serializeGameState(state));
    expect(deserialized.players.size).toBe(0);
    expect(deserialized.phase).toBe(GamePhase.Lobby);
  });

  it("should handle multiple players", () => {
    const state: GameState = {
      players: new Map([
        [
          "p1",
          {
            id: "p1",
            name: "Alice",
            position: { x: 0, y: 0 },
            rotation: 0,
            velocity: { speed: 0, heading: 0 },
            steeringAngle: 0,
            car: { id: "c1", parts: [], baseSpeed: 4, baseArmor: 2, baseHealth: 100 },
            skills: { driving: 1, gunnery: 1, luck: 1 },
          },
        ],
        [
          "p2",
          {
            id: "p2",
            name: "Bob",
            position: { x: 100, y: 100 },
            rotation: 0,
            velocity: { speed: 0, heading: 0 },
            steeringAngle: 0,
            car: { id: "c2", parts: [], baseSpeed: 4, baseArmor: 2, baseHealth: 100 },
            skills: { driving: 1, gunnery: 1, luck: 1 },
          },
        ],
      ]),
      phase: GamePhase.Exploring,
    };

    const deserialized = deserializeGameState(serializeGameState(state));
    expect(deserialized.players.size).toBe(2);
    expect(deserialized.players.get("p1")?.name).toBe("Alice");
    expect(deserialized.players.get("p2")?.name).toBe("Bob");
  });
});
