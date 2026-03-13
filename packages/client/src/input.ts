import type { Vec2, GamePhase, CombatZone, DriveState, Player } from "@game/shared";
import { PHYSICS, simulatePhysics } from "@game/shared";
import type { Network } from "./network.js";
import type { Renderer } from "./renderer.js";
import {
  isPlayerInCombat,
  shouldSendDriveState,
} from "./input-utils.js";

interface CombatPreview {
  driveState: DriveState;
  ticks: number;
  path: Vec2[];
  finalHeading: number;
}

export class InputHandler {
  private network: Network;
  private renderer: Renderer;
  private prevDriveState: DriveState | null = null;
  private combatPreview: CombatPreview | null = null;
  private isAnimating = false;

  /** Combat input history -- opposing inputs undo instead of consuming budget */
  private combatSpeedInputs: Array<"up" | "down"> = [];
  private combatSteeringInputs: Array<"left" | "right"> = [];
  /** Snapshot of driveState at start of turn, for Escape to restore */
  private combatTurnStartDriveState: DriveState = { targetSpeed: 0, steeringAngle: 0 };

  private static readonly COMBAT_MAX_SPEED_STEPS = 1;
  private static readonly COMBAT_MAX_STEERING_STEPS = 3;

  driveState: DriveState = { targetSpeed: 0, steeringAngle: 0 };
  maxSpeed: number = 8;

  /** Externally updated so input knows the current phase and players */
  currentPhase: GamePhase = "Exploring" as GamePhase;
  currentTurn: string | null = null;
  localPlayerId: string | null = null;
  combatZone: CombatZone | null = null;
  players: Map<string, Player> = new Map();

  constructor(network: Network, renderer: Renderer) {
    this.network = network;
    this.renderer = renderer;
    this.setupKeyboard();
    this.setupMouse();
    this.setupCombatButtons();
  }

  private setupKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      // Ignore key repeats -- one press = one step
      if (e.repeat) return;

      const key = e.key.toLowerCase();
      const inCombatTurn = this.isInCombat && this.isMyTurn;

      // Speed controls
      if (key === "w" || key === "arrowup") {
        if (inCombatTurn) {
          this.combatSpeedInput("up");
        } else {
          this.driveState.targetSpeed = Math.min(this.driveState.targetSpeed + 1, this.maxSpeed);
          this.sendDriveState();
        }
      }
      if (key === "s" || key === "arrowdown") {
        if (inCombatTurn) {
          this.combatSpeedInput("down");
        } else {
          this.driveState.targetSpeed = Math.max(this.driveState.targetSpeed - 1, 0);
          this.sendDriveState();
        }
      }

      // Steering controls -- persistent steering angle
      if (key === "a" || key === "arrowleft") {
        if (inCombatTurn) {
          this.combatSteeringInput("left");
        } else {
          this.driveState.steeringAngle = Math.max(
            this.driveState.steeringAngle - PHYSICS.STEERING_STEP,
            -PHYSICS.MAX_STEERING_ANGLE
          );
          this.sendDriveState();
        }
      }
      if (key === "d" || key === "arrowright") {
        if (inCombatTurn) {
          this.combatSteeringInput("right");
        } else {
          this.driveState.steeringAngle = Math.min(
            this.driveState.steeringAngle + PHYSICS.STEERING_STEP,
            PHYSICS.MAX_STEERING_ANGLE
          );
          this.sendDriveState();
        }
      }

      // Q: center steering to 0
      if (key === "q") {
        this.driveState.steeringAngle = 0;
        if (!inCombatTurn) {
          this.sendDriveState();
        }
      }

      // Space: end turn (commit movement + advance), or start combat
      if (e.key === " ") {
        if (this.isInCombat && this.isMyTurn) {
          this.commitMovementThen(() => {
            this.network.send({ type: "endTurn" });
          });
        } else if (!this.combatZone) {
          this.network.send({ type: "startCombat" });
        }
      }

      // Escape: undo movement planning — restore driveState to start-of-turn values
      if (e.key === "Escape" && this.isInCombat && this.isMyTurn) {
        this.driveState = { ...this.combatTurnStartDriveState };
        this.combatSpeedInputs = [];
        this.combatSteeringInputs = [];
        this.combatPreview = null;
        this.renderer.updateMovementPreview(null, 0);
      }
    });

    // No keyup handler needed -- discrete taps, no held-key tracking
  }

  private setupMouse(): void {
    // Mouse clicks reserved for future targeting UI
  }

  private setupCombatButtons(): void {
    document.getElementById("btn-fire-laser")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.commitMovementThen(() => {
        this.network.send({
          type: "combatAction",
          action: { type: "fireLaser" },
        });
      });
    });

    document.getElementById("btn-fire-projectile")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.commitMovementThen(() => {
        this.network.send({
          type: "combatAction",
          action: { type: "fireProjectile" },
        });
      });
    });

    document.getElementById("btn-end-turn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.commitMovementThen(() => {
        this.network.send({ type: "endTurn" });
      });
    });

    document.getElementById("btn-respawn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.driveState = { targetSpeed: 0, steeringAngle: 0 };
      this.network.send({ type: "respawn" });
    });
  }

  private get isInCombat(): boolean {
    return isPlayerInCombat(this.localPlayerId, this.combatZone);
  }

  private get isMyTurn(): boolean {
    return this.combatZone?.currentTurn === this.localPlayerId;
  }

  /** Send drive state to server (exploration mode) */
  private sendDriveState(): void {
    if (shouldSendDriveState(this.network.connected, this.prevDriveState, this.driveState)) {
      this.prevDriveState = { ...this.driveState };
      this.network.send({ type: "driveState", ...this.driveState });
    }
  }

  /** Combat speed input: opposing direction undoes last input instead of consuming budget */
  private combatSpeedInput(dir: "up" | "down"): void {
    const opposite = dir === "up" ? "down" : "up";
    const last = this.combatSpeedInputs[this.combatSpeedInputs.length - 1];
    if (last === opposite) {
      // Undo: pop the last input and reverse its effect
      this.combatSpeedInputs.pop();
      this.driveState.targetSpeed += opposite === "up" ? -1 : 1;
    } else if (this.combatSpeedInputs.length < InputHandler.COMBAT_MAX_SPEED_STEPS) {
      this.combatSpeedInputs.push(dir);
      this.driveState.targetSpeed = dir === "up"
        ? Math.min(this.driveState.targetSpeed + 1, this.maxSpeed)
        : Math.max(this.driveState.targetSpeed - 1, 0);
    }
  }

  /** Combat steering input: opposing direction undoes last input instead of consuming budget */
  private combatSteeringInput(dir: "left" | "right"): void {
    const opposite = dir === "left" ? "right" : "left";
    const last = this.combatSteeringInputs[this.combatSteeringInputs.length - 1];
    if (last === opposite) {
      // Undo: pop the last input and reverse its effect
      this.combatSteeringInputs.pop();
      this.driveState.steeringAngle += opposite === "left"
        ? PHYSICS.STEERING_STEP   // undo a left → add back
        : -PHYSICS.STEERING_STEP; // undo a right → subtract back
    } else if (this.combatSteeringInputs.length < InputHandler.COMBAT_MAX_STEERING_STEPS) {
      this.combatSteeringInputs.push(dir);
      this.driveState.steeringAngle = dir === "left"
        ? Math.max(this.driveState.steeringAngle - PHYSICS.STEERING_STEP, -PHYSICS.MAX_STEERING_ANGLE)
        : Math.min(this.driveState.steeringAngle + PHYSICS.STEERING_STEP, PHYSICS.MAX_STEERING_ANGLE);
    }
  }

  /** Commit the current movement preview, then execute a follow-up action.
   *  If no preview exists but the car has speed, compute a coast preview first. */
  private commitMovementThen(action: () => void): void {
    // If no preview yet, compute coast trajectory on the fly
    if (!this.combatPreview && this.localPlayerId) {
      const player = this.players.get(this.localPlayerId);
      if (player && player.velocity.speed > 0) {
        const maxSpeed = this.getEffectiveSpeed(player);
        const budget = player.combatMovementBudget ?? 30;
        const usedTicks = player.combatMovementUsed ?? 0;
        const remainingTicks = budget - usedTicks;
        if (remainingTicks > 0) {
          const coastDriveState: DriveState = {
            targetSpeed: player.velocity.speed,
            steeringAngle: 0,
          };
          const result = simulatePhysics(
            {
              position: { ...player.position },
              speed: player.velocity.speed,
              heading: player.velocity.heading,
              steeringAngle: 0,
            },
            maxSpeed,
            Infinity,
            remainingTicks
          );
          if (result.distanceUsed > 0) {
            this.combatPreview = {
              driveState: coastDriveState,
              ticks: result.ticksUsed,
              path: result.path,
              finalHeading: result.final.heading,
            };
          }
        }
      }
    }

    if (this.combatPreview) {
      this.network.send({
        type: "combatMoveConfirm",
        driveState: { ...this.combatPreview.driveState },
        ticks: this.combatPreview.ticks,
      });
      this.combatPreview = null;
      this.renderer.updateMovementPreview(null, 0);
    }
    action();
  }

  /** Reset combat input limits for a new turn */
  resetCombatTurn(): void {
    this.combatSpeedInputs = [];
    this.combatSteeringInputs = [];
    this.combatTurnStartDriveState = { ...this.driveState };
    this.combatPreview = null;
    this.renderer.updateMovementPreview(null, 0);
  }

  cancelPreview(): void {
    this.combatPreview = null;
    this.renderer.updateMovementPreview(null, 0);
  }

  /** Called when a combat move animation starts */
  setAnimating(animating: boolean): void {
    this.isAnimating = animating;
    if (animating) {
      this.cancelPreview();
    }
  }

  /** Call this every frame to send input state changes */
  tick(): void {
    if (this.isInCombat && this.isMyTurn) {
      // Combat preview mode -- don't send input to server
      if (this.isAnimating) return;
      if (!this.localPlayerId) return;

      const player = this.players.get(this.localPlayerId);
      if (!player) return;

      const maxSpeed = this.getEffectiveSpeed(player);
      const budget = player.combatMovementBudget ?? 30;
      const usedTicks = player.combatMovementUsed ?? 0;
      const remainingTicks = budget - usedTicks;

      const speed = Math.max(0, Math.min(this.driveState.targetSpeed, maxSpeed));
      const effectiveSpeed = speed > 0 ? speed : player.velocity.speed;

      if (remainingTicks > 0 && effectiveSpeed > 0) {
        const previewDriveState: DriveState = {
          targetSpeed: effectiveSpeed,
          steeringAngle: this.driveState.steeringAngle,
        };
        const result = simulatePhysics(
          {
            position: { ...player.position },
            speed: effectiveSpeed,
            heading: player.velocity.heading,
            steeringAngle: this.driveState.steeringAngle,
          },
          maxSpeed,
          Infinity,
          remainingTicks
        );

        // Only show preview if the car actually moves somewhere
        if (result.distanceUsed > 0) {
          this.combatPreview = {
            driveState: previewDriveState,
            ticks: result.ticksUsed,
            path: result.path,
            finalHeading: result.final.heading,
          };

          this.renderer.updateMovementPreview(result.path, result.final.heading);
        }
      }

        return;
    }

    // Exploration mode: send drive state to server when changed
    this.sendDriveState();
  }

  private getEffectiveSpeed(player: Player): number {
    const speedBonus = player.car.parts
      .filter((p) => p.stats.speed)
      .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);
    return player.car.baseSpeed + speedBonus;
  }
}
