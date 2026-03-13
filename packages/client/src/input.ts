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

  /** Combat input limits -- reset each turn */
  private combatSpeedStepsUsed = 0;
  private combatSteeringStepsUsed = 0;
  private combatMovementDone = false;
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
        if (inCombatTurn && (this.combatMovementDone || this.combatSpeedStepsUsed >= InputHandler.COMBAT_MAX_SPEED_STEPS)) {
          // blocked
        } else {
          if (inCombatTurn) this.combatSpeedStepsUsed++;
          this.driveState.targetSpeed = Math.min(this.driveState.targetSpeed + 1, this.maxSpeed);
          if (!inCombatTurn) {
            this.sendDriveState();
          }
        }
      }
      if (key === "s" || key === "arrowdown") {
        if (inCombatTurn && (this.combatMovementDone || this.combatSpeedStepsUsed >= InputHandler.COMBAT_MAX_SPEED_STEPS)) {
          // blocked
        } else {
          if (inCombatTurn) this.combatSpeedStepsUsed++;
          this.driveState.targetSpeed = Math.max(this.driveState.targetSpeed - 1, 0);
          if (!inCombatTurn) {
            this.sendDriveState();
          }
        }
      }

      // Steering controls -- persistent steering angle
      if (key === "a" || key === "arrowleft") {
        if (inCombatTurn && (this.combatMovementDone || this.combatSteeringStepsUsed >= InputHandler.COMBAT_MAX_STEERING_STEPS)) {
          // blocked
        } else {
          if (inCombatTurn) this.combatSteeringStepsUsed++;
          this.driveState.steeringAngle = Math.max(
            this.driveState.steeringAngle - PHYSICS.STEERING_STEP,
            -PHYSICS.MAX_STEERING_ANGLE
          );
          if (!inCombatTurn) {
            this.sendDriveState();
          }
        }
      }
      if (key === "d" || key === "arrowright") {
        if (inCombatTurn && (this.combatMovementDone || this.combatSteeringStepsUsed >= InputHandler.COMBAT_MAX_STEERING_STEPS)) {
          // blocked
        } else {
          if (inCombatTurn) this.combatSteeringStepsUsed++;
          this.driveState.steeringAngle = Math.min(
            this.driveState.steeringAngle + PHYSICS.STEERING_STEP,
            PHYSICS.MAX_STEERING_ANGLE
          );
          if (!inCombatTurn) {
            this.sendDriveState();
          }
        }
      }

      // Q: center steering to 0
      if (key === "q") {
        if (inCombatTurn && this.combatMovementDone) {
          // blocked
        } else {
          this.driveState.steeringAngle = 0;
          if (!inCombatTurn) {
            this.sendDriveState();
          }
        }
      }

      // Space: commit movement segment early (to chain multiple moves), or start combat
      if (e.key === " ") {
        if (this.isInCombat && this.isMyTurn) {
          if (this.combatPreview) {
            this.confirmMove();
          }
        } else if (!this.combatZone) {
          this.network.send({ type: "startCombat" });
        }
      }

      // Escape: undo all movement planning — restore driveState to start-of-turn values
      if (e.key === "Escape" && this.isInCombat && this.isMyTurn && !this.combatMovementDone) {
        this.driveState = { ...this.combatTurnStartDriveState };
        this.combatSpeedStepsUsed = 0;
        this.combatSteeringStepsUsed = 0;
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

    document.getElementById("btn-confirm-move")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.combatPreview) this.confirmMove();
    });

    document.getElementById("btn-cancel-move")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!this.combatMovementDone) {
        this.driveState = { ...this.combatTurnStartDriveState };
        this.combatSpeedStepsUsed = 0;
        this.combatSteeringStepsUsed = 0;
        this.combatPreview = null;
        this.renderer.updateMovementPreview(null, 0);
      }
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

  /** Commit movement segment early (Space or Confirm button) -- doesn't end turn */
  private confirmMove(): void {
    if (!this.combatPreview) return;
    this.network.send({
      type: "combatMoveConfirm",
      driveState: { ...this.combatPreview.driveState },
      ticks: this.combatPreview.ticks,
    });
    this.combatPreview = null;
    this.combatMovementDone = true;
    this.renderer.updateMovementPreview(null, 0);
  }

  /** Send drive state to server (exploration mode) */
  private sendDriveState(): void {
    if (shouldSendDriveState(this.network.connected, this.prevDriveState, this.driveState)) {
      this.prevDriveState = { ...this.driveState };
      this.network.send({ type: "driveState", ...this.driveState });
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
      this.combatMovementDone = true;
      this.renderer.updateMovementPreview(null, 0);
    }
    action();
  }

  /** Reset combat input limits for a new turn */
  resetCombatTurn(): void {
    this.combatSpeedStepsUsed = 0;
    this.combatSteeringStepsUsed = 0;
    this.combatMovementDone = false;
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
