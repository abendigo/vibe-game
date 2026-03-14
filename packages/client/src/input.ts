import type { Vec2, GamePhase, CombatZone, DriveState, Player } from "@game/shared";
import { PHYSICS, WeaponKind, simulatePhysics } from "@game/shared";
import type { Network } from "./network.js";
import type { Renderer } from "./renderer.js";
import {
  isPlayerInCombat,
  shouldSendDriveState,
  findNearestPlayer,
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

  /** When true, all game input is suppressed (garage overlay open, etc.) */
  inputBlocked = false;
  /** Callback for Escape key when input is blocked (e.g. close garage) */
  onBlockedEscape: (() => void) | null = null;

  // ── Auto-targeting ──
  autoTargetEnabled = true;
  /** Manually selected target (overrides auto-nearest). */
  selectedTargetId: string | null = null;
  /** Computed nearest target per vehicle (vehicleId -> targetId). */
  computedTargets: Map<string, string> = new Map();

  constructor(network: Network, renderer: Renderer) {
    this.network = network;
    this.renderer = renderer;
    this.setupKeyboard();
    this.setupMouse();
    this.setupCombatButtons();
    this.setupWeaponBar();
  }

  private setupKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      // Ignore key repeats -- one press = one step
      if (e.repeat) return;

      // When input is blocked (e.g. garage overlay), only allow Escape
      if (this.inputBlocked) {
        if (e.key === "Escape" && this.onBlockedEscape) {
          this.onBlockedEscape();
        }
        return;
      }

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

      // Space: end turn in combat
      if (e.key === " ") {
        if (this.isInCombat && this.isMyTurn) {
          this.commitMovementThen(() => {
            this.network.send({ type: "endTurn" });
          });
        }
      }

      // M: toggle world map overlay
      if (key === "m") {
        this.renderer.toggleWorldMap();
      }

      // Escape: close world map if open, or undo movement planning
      if (e.key === "Escape" && this.renderer.isWorldMapVisible) {
        this.renderer.toggleWorldMap();
        return;
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
    // Click to select a target
    document.addEventListener("click", (e) => {
      if (this.inputBlocked) return;
      // Don't intercept clicks on UI elements
      const target = e.target as HTMLElement;
      if (target.closest("#weapon-bar, #combat-ui, #ui-overlay, #zoom-controls, #bottom-left-stack, #game-log, #world-map-overlay, #garage-overlay, #login-screen")) return;

      const worldPos = this.renderer.screenToWorld(e.clientX, e.clientY);
      const clickedId = findNearestPlayer(worldPos, this.players, this.localPlayerId, 50);
      if (clickedId) {
        this.selectedTargetId = clickedId;
        this.autoTargetEnabled = true;
        this.updateAutoTargetButton();
      }
    });
  }

  private setupWeaponBar(): void {
    document.getElementById("btn-fire-laser")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.fireWeapon("Laser");
    });

    document.getElementById("btn-fire-projectile")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.fireWeapon("Projectile");
    });

    document.getElementById("btn-auto-target")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.autoTargetEnabled = !this.autoTargetEnabled;
      if (!this.autoTargetEnabled) {
        this.selectedTargetId = null;
      }
      this.updateAutoTargetButton();
    });
  }

  private updateAutoTargetButton(): void {
    const btn = document.getElementById("btn-auto-target");
    if (btn) {
      btn.classList.toggle("active", this.autoTargetEnabled);
    }
  }

  private fireWeapon(kind: "Laser" | "Projectile"): void {
    const effectiveTarget = this.getEffectiveTarget();

    if (this.isInCombat && this.isMyTurn) {
      // In combat: commit movement then fire
      this.commitMovementThen(() => {
        this.network.send({
          type: "fireWeapon",
          weaponKind: kind,
          targetId: effectiveTarget,
        });
      });
    } else if (!this.isInCombat) {
      // Exploration: fire weapon (may start combat)
      this.network.send({
        type: "fireWeapon",
        weaponKind: kind,
        targetId: effectiveTarget,
      });
    }
  }

  /** Get the effective target: manual selection > auto-nearest > undefined (fire into void). */
  private getEffectiveTarget(): string | undefined {
    if (this.selectedTargetId) return this.selectedTargetId;
    if (this.autoTargetEnabled && this.localPlayerId) {
      return this.computedTargets.get(this.localPlayerId);
    }
    return undefined;
  }

  private setupCombatButtons(): void {
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
      this.combatSteeringInputs.pop();
      this.driveState.steeringAngle += opposite === "left"
        ? PHYSICS.STEERING_STEP
        : -PHYSICS.STEERING_STEP;
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

  /** Call this every frame to send input state changes and update targeting */
  tick(): void {
    this.updateAutoTargets();
    this.validateSelectedTarget();
    this.updateWeaponButtons();

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

  /** Compute nearest valid target for every vehicle. */
  private updateAutoTargets(): void {
    this.computedTargets.clear();
    for (const [id, player] of this.players) {
      let nearestId: string | null = null;
      let nearestDist = Infinity;
      for (const [otherId, other] of this.players) {
        if (otherId === id) continue;
        const dx = other.position.x - player.position.x;
        const dy = other.position.y - player.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId = otherId;
        }
      }
      if (nearestId) {
        this.computedTargets.set(id, nearestId);
      }
    }
  }

  /** Clear selected target if it's no longer valid. */
  private validateSelectedTarget(): void {
    if (!this.selectedTargetId) return;
    const target = this.players.get(this.selectedTargetId);
    if (!target) { this.selectedTargetId = null; return; }
    if (target.car.baseHealth <= 0) { this.selectedTargetId = null; return; }

    // In combat: check if target left combat
    if (this.combatZone && !this.combatZone.combatantIds.includes(this.selectedTargetId)) {
      this.selectedTargetId = null;
      return;
    }

    // Check weapon range — clear if out of range of all weapons
    if (this.localPlayerId) {
      const local = this.players.get(this.localPlayerId);
      if (local) {
        const dx = target.position.x - local.position.x;
        const dy = target.position.y - local.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxRange = Math.max(
          ...local.car.parts
            .filter((p) => p.stats.weaponKind)
            .map((p) => p.stats.range ?? 0)
        );
        if (dist > maxRange) {
          this.selectedTargetId = null;
        }
      }
    }
  }

  /** Update weapon button enabled/disabled state and labels. */
  private updateWeaponButtons(): void {
    if (!this.localPlayerId) return;
    const player = this.players.get(this.localPlayerId);
    if (!player) return;

    const inCombatNotMyTurn = this.isInCombat && !this.isMyTurn;

    const laser = player.car.parts.find(
      (p) => p.stats.weaponKind === WeaponKind.Laser
    );
    const projectile = player.car.parts.find(
      (p) => p.stats.weaponKind === WeaponKind.Projectile
    );

    const laserBtn = document.getElementById("btn-fire-laser") as HTMLButtonElement | null;
    if (laserBtn) {
      const energy = laser?.stats.energy ?? 0;
      const cd = laser?.stats.cooldown ?? 0;
      if (cd > 0) {
        laserBtn.textContent = `Laser [CD:${cd}]`;
        laserBtn.disabled = true;
      } else {
        laserBtn.textContent = `Laser [${energy}]`;
        laserBtn.disabled = energy <= 0 || inCombatNotMyTurn;
      }
    }

    const projBtn = document.getElementById("btn-fire-projectile") as HTMLButtonElement | null;
    if (projBtn) {
      const ammo = projectile?.stats.ammo ?? 0;
      const cd = projectile?.stats.cooldown ?? 0;
      if (cd > 0) {
        projBtn.textContent = `Gun [CD:${cd}]`;
        projBtn.disabled = true;
      } else {
        projBtn.textContent = `Gun [${ammo}]`;
        projBtn.disabled = ammo <= 0 || inCombatNotMyTurn;
      }
    }

    // Combat UI (End Turn) visibility
    const combatUi = document.getElementById("combat-ui");
    if (combatUi) {
      combatUi.style.display = (this.isInCombat && this.isMyTurn) ? "block" : "none";
    }
  }

  private getEffectiveSpeed(player: Player): number {
    const speedBonus = player.car.parts
      .filter((p) => p.stats.speed)
      .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);
    return player.car.baseSpeed + speedBonus;
  }
}
