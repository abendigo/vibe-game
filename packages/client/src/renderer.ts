import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Player, GamePhase, CombatZone, WeaponAnimationData, Vec2, DriveState } from "@game/shared";
import { PHYSICS, WeaponKind, simulatePhysics, TileType, TOWN_MAP, getBuildingColor } from "@game/shared";
import {
  GRID_SIZE,
  GRID_CELLS,
  CAR_WIDTH,
  CAR_HEIGHT,
  MINIMAP_SIZE,
  MINIMAP_PADDING,
  MINIMAP_SCALE,
  PLAYER_COLORS,
  screenToWorld as screenToWorldUtil,
  computeCameraPosition,
  assignPlayerColor,
  worldToMinimap,
  computeMinimapViewport,
  computeMinimapCombatZone,
  hpBarColor,
  computePlayerStats,
} from "./render-utils.js";

// ── Animation types ──

interface ActiveAnimation {
  graphics: Graphics;
  elapsed: number;
  duration: number;
  update(elapsed: number, duration: number): boolean; // returns true when done
}

const LASER_DURATION = 200;       // ms
const PROJECTILE_DURATION = 400;  // ms
const PROJECTILE_RADIUS = 4;

export class Renderer {
  app: Application;
  private world: Container;
  private gridGraphics: Graphics;
  private playerGraphics: Map<string, Container> = new Map();
  private playerColorMap: Map<string, number> = new Map();
  private colorIndex = 0;

  private turnOrderContainer: Container;
  private phaseText: Text;

  private minimapContainer: Container;
  private minimapBgGraphics: Graphics;
  private minimapGraphics: Graphics;
  private combatZoneGraphics: Graphics;

  private animations: ActiveAnimation[] = [];
  private previewGraphics: Graphics;
  private ghostPreviewGraphics: Graphics;

  private static readonly DEFAULT_ZOOM = 1;
  private static readonly MIN_ZOOM = 0.25;
  private static readonly MAX_ZOOM = 3;
  private static readonly ZOOM_STEP = 0.25;
  private zoom = Renderer.DEFAULT_ZOOM;

  localPlayerId: string | null = null;

  constructor() {
    this.app = new Application();
    this.world = new Container();
    this.gridGraphics = new Graphics();
    this.turnOrderContainer = new Container();
    this.phaseText = new Text({ text: "", style: new TextStyle({ fill: "#ffffff", fontSize: 12 }) });
    this.minimapContainer = new Container();
    this.minimapBgGraphics = new Graphics();
    this.minimapGraphics = new Graphics();
    this.combatZoneGraphics = new Graphics();
    this.previewGraphics = new Graphics();
    this.ghostPreviewGraphics = new Graphics();
  }

  async init(canvas?: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      width: 800,
      height: 600,
      backgroundColor: 0x1a1a2e,
      canvas: canvas ?? undefined,
      antialias: true,
    });

    // World container (camera moves this)
    this.app.stage.addChild(this.world);

    // Draw grid
    this.drawGrid();
    this.world.addChild(this.gridGraphics);

    // Combat zone circle (rendered in world space, above grid, below players)
    this.world.addChild(this.combatZoneGraphics);

    // Movement preview (above combat zone, below player graphics)
    this.world.addChild(this.previewGraphics);

    // Ghost car trajectory preview (exploration + combat)
    this.world.addChild(this.ghostPreviewGraphics);

    // UI layer (fixed to screen, not world)
    this.turnOrderContainer.position.set(650, 10);
    this.app.stage.addChild(this.turnOrderContainer);

    // Minimap (top-right corner)
    this.minimapContainer.position.set(
      this.app.canvas.width - MINIMAP_SIZE - MINIMAP_PADDING,
      MINIMAP_PADDING
    );
    this.drawMinimapBackground();
    this.minimapContainer.addChild(this.minimapBgGraphics);
    this.minimapContainer.addChild(this.minimapGraphics);
    this.app.stage.addChild(this.minimapContainer);

    // Scroll wheel zoom
    this.app.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.deltaY < 0) this.zoomIn();
      else this.zoomOut();
    }, { passive: false });

    // Zoom buttons
    document.getElementById("btn-zoom-in")?.addEventListener("click", () => this.zoomIn());
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => this.zoomOut());
    document.getElementById("btn-zoom-reset")?.addEventListener("click", () => this.zoomReset());
  }

  zoomIn(): void {
    this.zoom = Math.min(Renderer.MAX_ZOOM, this.zoom + Renderer.ZOOM_STEP);
    this.updateZoomDisplay();
  }

  zoomOut(): void {
    this.zoom = Math.max(Renderer.MIN_ZOOM, this.zoom - Renderer.ZOOM_STEP);
    this.updateZoomDisplay();
  }

  zoomReset(): void {
    this.zoom = Renderer.DEFAULT_ZOOM;
    this.updateZoomDisplay();
  }

  private updateZoomDisplay(): void {
    const el = document.getElementById("zoom-value");
    if (el) el.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private drawMinimapBackground(): void {
    const g = this.minimapBgGraphics;
    g.clear();
    const tiles = TOWN_MAP.tiles;
    const mt = PHYSICS.MAP_TILES;
    const tileSize = MINIMAP_SIZE / mt;
    for (let row = 0; row < mt; row++) {
      for (let col = 0; col < mt; col++) {
        const tile = tiles[row][col];
        let color: number;
        switch (tile) {
          case TileType.Road:
            color = 0x555555;
            break;
          case TileType.Building:
            color = getBuildingColor(row, col) ?? 0x6a4a3a;
            break;
          default:
            color = 0x2a4a2e;
        }
        g.rect(col * tileSize, row * tileSize, tileSize, tileSize);
        g.fill({ color, alpha: 0.85 });
      }
    }
    g.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    g.stroke({ width: 1, color: 0x888888, alpha: 0.8 });
  }

  private drawGrid(): void {
    const g = this.gridGraphics;
    g.clear();

    const tiles = TOWN_MAP.tiles;
    const ts = PHYSICS.TILE_SIZE;
    const mt = PHYSICS.MAP_TILES;

    // Draw tiles
    for (let row = 0; row < mt; row++) {
      for (let col = 0; col < mt; col++) {
        const tile = tiles[row][col];
        const x = col * ts;
        const y = row * ts;

        let color: number;
        switch (tile) {
          case TileType.Road:
            color = 0x555555;
            break;
          case TileType.Building:
            color = getBuildingColor(row, col) ?? 0x6a4a3a;
            break;
          default:
            color = 0x2a4a2e;
        }

        g.rect(x, y, ts, ts);
        g.fill(color);
      }
    }

    // Building outlines
    for (const b of TOWN_MAP.buildings) {
      g.rect(b.x * ts, b.y * ts, b.width * ts, b.height * ts);
      g.stroke({ width: 2, color: 0x111111, alpha: 0.6 });
    }

    // Subtle grid lines
    const totalSize = mt * ts;
    for (let i = 0; i <= mt; i++) {
      const pos = i * ts;
      g.moveTo(pos, 0);
      g.lineTo(pos, totalSize);
      g.moveTo(0, pos);
      g.lineTo(totalSize, pos);
    }
    g.stroke({ width: 1, color: 0x3a3a5e, alpha: 0.2 });
  }

  private getPlayerColor(playerId: string): number {
    const { color, newIndex } = assignPlayerColor(
      playerId,
      this.playerColorMap,
      this.colorIndex
    );
    this.colorIndex = newIndex;
    return color;
  }

  // ── Weapon animations ──

  playWeaponAnimation(anim: WeaponAnimationData): void {
    const g = new Graphics();
    this.world.addChild(g);

    if (anim.kind === "laser") {
      const animation: ActiveAnimation = {
        graphics: g,
        elapsed: 0,
        duration: LASER_DURATION,
        update(elapsed, duration) {
          const t = elapsed / duration;
          const alpha = 1 - t; // fade out
          g.clear();
          // Main beam
          g.moveTo(anim.from.x, anim.from.y);
          g.lineTo(anim.to.x, anim.to.y);
          g.stroke({ width: 3, color: 0x00ffff, alpha });
          // Glow
          g.moveTo(anim.from.x, anim.from.y);
          g.lineTo(anim.to.x, anim.to.y);
          g.stroke({ width: 8, color: 0x00ffff, alpha: alpha * 0.3 });
          // Impact flash
          if (t < 0.3) {
            g.circle(anim.to.x, anim.to.y, 12 * (1 - t));
            g.fill({ color: 0xffffff, alpha: alpha * 0.6 });
          }
          return t >= 1;
        },
      };
      this.animations.push(animation);
    } else {
      // Projectile - moving bullet
      const animation: ActiveAnimation = {
        graphics: g,
        elapsed: 0,
        duration: PROJECTILE_DURATION,
        update(elapsed, duration) {
          const t = Math.min(elapsed / duration, 1);
          g.clear();
          // Lerp position
          const x = anim.from.x + (anim.to.x - anim.from.x) * t;
          const y = anim.from.y + (anim.to.y - anim.from.y) * t;
          // Bullet
          g.circle(x, y, PROJECTILE_RADIUS);
          g.fill(0xffaa00);
          // Trail
          const trailLen = 0.1;
          const t0 = Math.max(0, t - trailLen);
          const tx = anim.from.x + (anim.to.x - anim.from.x) * t0;
          const ty = anim.from.y + (anim.to.y - anim.from.y) * t0;
          g.moveTo(tx, ty);
          g.lineTo(x, y);
          g.stroke({ width: 2, color: 0xffaa00, alpha: 0.5 });
          // Impact flash at end
          if (t >= 1) {
            g.circle(anim.to.x, anim.to.y, 10);
            g.fill({ color: 0xff6600, alpha: 0.6 });
          }
          return t >= 1 && elapsed > duration + 50; // linger briefly at impact
        },
      };
      this.animations.push(animation);
    }
  }

  tickAnimations(deltaMs: number): void {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const anim = this.animations[i];
      anim.elapsed += deltaMs;
      const done = anim.update(anim.elapsed, anim.duration);
      if (done) {
        this.world.removeChild(anim.graphics);
        anim.graphics.destroy();
        this.animations.splice(i, 1);
      }
    }
  }

  updatePlayers(
    players: Map<string, Player>,
    phase: GamePhase,
    combatZone?: CombatZone,
    currentTurn?: string
  ): void {
    // Draw combat zone circle
    this.combatZoneGraphics.clear();
    if (combatZone) {
      const { center, radius } = combatZone;
      // Filled area
      this.combatZoneGraphics.circle(center.x, center.y, radius);
      this.combatZoneGraphics.fill({ color: 0xff4444, alpha: 0.08 });
      // Border ring
      this.combatZoneGraphics.circle(center.x, center.y, radius);
      this.combatZoneGraphics.stroke({ width: 2, color: 0xff4444, alpha: 0.6 });
    }

    // Remove graphics for players that left
    for (const [id, container] of this.playerGraphics) {
      if (!players.has(id)) {
        this.world.removeChild(container);
        this.playerGraphics.delete(id);
      }
    }

    // Update or create player graphics
    for (const [id, player] of players) {
      let container = this.playerGraphics.get(id);

      if (!container) {
        container = new Container();
        this.world.addChild(container);
        this.playerGraphics.set(id, container);
      }

      // Clear and redraw
      container.removeChildren();

      const color = this.getPlayerColor(id);
      const isLocal = id === this.localPlayerId;
      const isCurrentTurn = id === currentTurn;
      const isCombatant = combatZone?.combatantIds.includes(id) ?? false;

      const body = new Graphics();

      // Highlight ring for local player
      if (isLocal) {
        body.circle(0, 0, CAR_WIDTH * 0.8);
        body.fill({ color: 0xffffff, alpha: 0.15 });
      }

      // Current turn indicator
      if (isCurrentTurn && isCombatant) {
        body.circle(0, 0, CAR_WIDTH);
        body.stroke({ width: 2, color: 0xffff00, alpha: 0.8 });
      }

      // Weapon range circles and movement budget circle (local player, their turn, in combat)
      if (isLocal && isCurrentTurn && isCombatant) {
        // Laser range circle (cyan)
        const laser = player.car.parts.find(
          (p) => p.stats.weaponKind === WeaponKind.Laser
        );
        if (laser?.stats.range) {
          body.circle(0, 0, laser.stats.range);
          body.stroke({ width: 1, color: 0x00ffff, alpha: 0.3 });
          body.circle(0, 0, laser.stats.range);
          body.fill({ color: 0x00ffff, alpha: 0.03 });
        }

        // Projectile range circle (orange)
        const projectile = player.car.parts.find(
          (p) => p.stats.weaponKind === WeaponKind.Projectile
        );
        if (projectile?.stats.range) {
          body.circle(0, 0, projectile.stats.range);
          body.stroke({ width: 1, color: 0xffaa00, alpha: 0.3 });
          body.circle(0, 0, projectile.stats.range);
          body.fill({ color: 0xffaa00, alpha: 0.03 });
        }

      }

      // Car body (rectangle)
      body.rect(
        -CAR_WIDTH / 2,
        -CAR_HEIGHT / 2,
        CAR_WIDTH,
        CAR_HEIGHT
      );
      body.fill(color);

      if (isLocal) {
        body.rect(
          -CAR_WIDTH / 2,
          -CAR_HEIGHT / 2,
          CAR_WIDTH,
          CAR_HEIGHT
        );
        body.stroke({ width: 2, color: 0xffffff });
      }

      // Direction indicator (front of car)
      body.moveTo(CAR_WIDTH / 2, 0);
      body.lineTo(CAR_WIDTH / 2 + 8, 0);
      body.stroke({ width: 3, color: 0xffffff });

      container.addChild(body);

      // Name label
      const isNPC = player.isNPC ?? false;
      const nameStyle = new TextStyle({
        fill: isNPC ? "#ffa726" : "#ffffff",
        fontSize: 11,
        fontFamily: "monospace",
      });
      const displayName = isNPC ? `[NPC] ${player.name}` : player.name;
      const nameText = new Text({ text: displayName, style: nameStyle });
      nameText.anchor.set(0.5, 0);
      nameText.position.set(0, -CAR_HEIGHT / 2 - 16);
      container.addChild(nameText);

      // Health bar for combatants
      if (isCombatant) {
        const barWidth = 30;
        const hpRatio = Math.max(0, player.car.baseHealth / 100);
        const hpBar = new Graphics();
        // Background
        hpBar.rect(-barWidth / 2, -CAR_HEIGHT / 2 - 6, barWidth, 4);
        hpBar.fill(0x333333);
        // Fill
        hpBar.rect(-barWidth / 2, -CAR_HEIGHT / 2 - 6, barWidth * hpRatio, 4);
        hpBar.fill(hpBarColor(hpRatio));
        container.addChild(hpBar);
      }

      // Position and rotation
      container.position.set(player.position.x, player.position.y);
      container.rotation = player.rotation;
    }

    // Update camera to follow local player (with zoom)
    this.world.scale.set(this.zoom, this.zoom);
    if (this.localPlayerId) {
      const localPlayer = players.get(this.localPlayerId);
      if (localPlayer) {
        const cam = computeCameraPosition(
          this.app.canvas.width / this.zoom,
          this.app.canvas.height / this.zoom,
          localPlayer.position
        );
        this.world.position.set(cam.x * this.zoom, cam.y * this.zoom);
      }
    }

    // Update HUD
    const phaseEl = document.getElementById("phase-display");
    if (phaseEl) phaseEl.textContent = `Phase: ${phase}`;

    const countEl = document.getElementById("player-count");
    if (countEl) countEl.textContent = `Players: ${players.size}`;

    const localInCombat = combatZone?.combatantIds.includes(this.localPlayerId ?? "") ?? false;

    const turnEl = document.getElementById("turn-display");
    if (turnEl) {
      if (combatZone && localInCombat) {
        const turnPlayer = players.get(combatZone.currentTurn);
        const isMyTurn = combatZone.currentTurn === this.localPlayerId;
        turnEl.textContent = isMyTurn
          ? "YOUR TURN"
          : `Turn: ${turnPlayer?.name ?? "???"}`;
        turnEl.style.color = isMyTurn ? "#ffff00" : "#ffffff";
      } else {
        turnEl.textContent = "";
      }
    }

    // Show/hide combat UI and update weapon buttons
    const combatUi = document.getElementById("combat-ui");
    if (combatUi) {
      const isMyTurn = localInCombat && combatZone?.currentTurn === this.localPlayerId;
      combatUi.style.display = isMyTurn ? "block" : "none";

      if (isMyTurn && this.localPlayerId) {
        const localPlayer = players.get(this.localPlayerId);
        if (localPlayer) {
          this.updateWeaponButtons(localPlayer);
        }
      }
    }

    // Update info panel
    this.updateInfoPanel(players, combatZone);

    // Update minimap
    this.updateMinimap(players, combatZone);
  }

  private updateWeaponButtons(player: Player): void {
    const laserBtn = document.getElementById("btn-fire-laser") as HTMLButtonElement | null;
    const projBtn = document.getElementById("btn-fire-projectile") as HTMLButtonElement | null;

    const laser = player.car.parts.find(
      (p) => p.stats.weaponKind === WeaponKind.Laser
    );
    const projectile = player.car.parts.find(
      (p) => p.stats.weaponKind === WeaponKind.Projectile
    );

    if (laserBtn) {
      const energy = laser?.stats.energy ?? 0;
      const laserCd = laser?.stats.cooldown ?? 0;
      if (laserCd > 0) {
        laserBtn.textContent = `Laser [CD:${laserCd}]`;
        laserBtn.disabled = true;
      } else {
        laserBtn.textContent = `Laser [${energy}]`;
        laserBtn.disabled = energy <= 0;
      }
    }

    if (projBtn) {
      const ammo = projectile?.stats.ammo ?? 0;
      const projCd = projectile?.stats.cooldown ?? 0;
      if (projCd > 0) {
        projBtn.textContent = `Gun [CD:${projCd}]`;
        projBtn.disabled = true;
      } else {
        projBtn.textContent = `Gun [${ammo}]`;
        projBtn.disabled = ammo <= 0;
      }
    }
  }

  private updateInfoPanel(
    players: Map<string, Player>,
    combatZone?: CombatZone
  ): void {
    const panel = document.getElementById("info-panel");
    if (!panel) return;

    if (!this.localPlayerId) {
      panel.innerHTML = "";
      return;
    }

    const player = players.get(this.localPlayerId);
    if (!player) {
      panel.innerHTML = "";
      return;
    }

    const s = computePlayerStats(player, combatZone);
    const hpClass =
      s.hp / s.maxHp > 0.5
        ? "hp-green"
        : s.hp / s.maxHp > 0.25
          ? "hp-orange"
          : "hp-red";

    panel.innerHTML =
      `<span class="label">Name:</span> <span class="value">${s.name}</span><br>` +
      `<span class="label">HP:</span> <span class="${hpClass}">${s.hp}/${s.maxHp}</span><br>` +
      `<span class="label">Pos:</span> <span class="value">${s.position.x}, ${s.position.y}</span><br>` +
      `<span class="label">Facing:</span> <span class="value">${s.direction}</span><br>` +
      `<span class="label">Speed:</span> <span class="value">${Math.round(s.currentSpeed)} / ${s.maxSpeed}</span><br>` +
      `<span class="label">Armor:</span> <span class="value">${s.armor}</span><br>` +
      `<span class="label">Laser:</span> <span class="value">${s.laserDamage} dmg (${s.laserEnergy}/${s.maxLaserEnergy} energy)</span><br>` +
      `<span class="label">Gun:</span> <span class="value">${s.projectileDamage} dmg (${s.projectileAmmo}/${s.maxProjectileAmmo} ammo)</span><br>` +
      `<span class="label">Parts:</span> <span class="value">${s.partCount}</span><br>` +
      `<span class="label">Skills:</span> <span class="value">DRV ${s.skills.driving} / GUN ${s.skills.gunnery} / LCK ${s.skills.luck}</span><br>` +
      (s.inCombat
        ? `<span class="combat-status">IN COMBAT</span> (move: ${Math.round(s.combatMovementRemaining)})`
        : `<span class="label">Status:</span> <span class="value">Exploring</span>`);
  }

  private updateMinimap(players: Map<string, Player>, combatZone?: CombatZone): void {
    const g = this.minimapGraphics;
    g.clear();

    // Background tiles are pre-rendered in minimapBgGraphics

    // Combat zone circle
    if (combatZone) {
      const { cx, cy, cr } = computeMinimapCombatZone(combatZone);
      g.circle(cx, cy, cr);
      g.fill({ color: 0xff4444, alpha: 0.15 });
      g.circle(cx, cy, cr);
      g.stroke({ width: 1, color: 0xff4444, alpha: 0.8 });
    }

    // Viewport rectangle
    if (this.localPlayerId) {
      const vp = computeMinimapViewport(
        this.world.position.x / this.zoom,
        this.world.position.y / this.zoom,
        this.app.canvas.width / this.zoom,
        this.app.canvas.height / this.zoom
      );
      g.rect(vp.x, vp.y, vp.width, vp.height);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    }

    // Player dots
    for (const [id, player] of players) {
      const { x: mx, y: my } = worldToMinimap(player.position);
      const color = this.getPlayerColor(id);
      const isLocal = id === this.localPlayerId;

      if (isLocal) {
        g.circle(mx, my, 4);
        g.fill(color);
        g.circle(mx, my, 4);
        g.stroke({ width: 1, color: 0xffffff });
      } else {
        g.circle(mx, my, 3);
        g.fill(color);
      }
    }
  }

  updateMovementPreview(path: Vec2[] | null, finalHeading: number): void {
    this.previewGraphics.clear();

    if (!path || path.length === 0) {
      return;
    }

    // Draw green polyline through path points
    this.previewGraphics.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      this.previewGraphics.lineTo(path[i].x, path[i].y);
    }
    this.previewGraphics.stroke({ width: 2, color: 0x66bb6a, alpha: 0.6 });

    // Draw ghost car at final position (manually rotated rectangle —
    // Pixi.js v8 Graphics doesn't have save/restore/translate/rotate)
    const finalPos = path[path.length - 1];
    const cos = Math.cos(finalHeading);
    const sin = Math.sin(finalHeading);
    const hw = CAR_WIDTH / 2;
    const hh = CAR_HEIGHT / 2;
    // Compute the 4 corners of the rotated rectangle
    const corners = [
      { x: finalPos.x + (-hw * cos - -hh * sin), y: finalPos.y + (-hw * sin + -hh * cos) },
      { x: finalPos.x + ( hw * cos - -hh * sin), y: finalPos.y + ( hw * sin + -hh * cos) },
      { x: finalPos.x + ( hw * cos -  hh * sin), y: finalPos.y + ( hw * sin +  hh * cos) },
      { x: finalPos.x + (-hw * cos -  hh * sin), y: finalPos.y + (-hw * sin +  hh * cos) },
    ];
    // Fill
    this.previewGraphics.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      this.previewGraphics.lineTo(corners[i].x, corners[i].y);
    }
    this.previewGraphics.closePath();
    this.previewGraphics.fill({ color: 0xffffff, alpha: 0.25 });
    // Stroke
    this.previewGraphics.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      this.previewGraphics.lineTo(corners[i].x, corners[i].y);
    }
    this.previewGraphics.closePath();
    this.previewGraphics.stroke({ width: 1, color: 0x66bb6a, alpha: 0.5 });

  }

  animateCombatMove(
    playerId: string,
    path: Vec2[],
    onComplete?: () => void
  ): void {
    if (path.length < 2) {
      onComplete?.();
      return;
    }

    const container = this.playerGraphics.get(playerId);
    if (!container) {
      onComplete?.();
      return;
    }

    const msPerSegment = 20;
    const totalDuration = (path.length - 1) * msPerSegment;
    const g = new Graphics(); // dummy graphics for the animation system
    this.world.addChild(g);

    const animation: ActiveAnimation = {
      graphics: g,
      elapsed: 0,
      duration: totalDuration,
      update(elapsed, duration) {
        const t = Math.min(elapsed / duration, 1);
        const floatIndex = t * (path.length - 1);
        const i = Math.floor(floatIndex);
        const frac = floatIndex - i;

        const a = path[Math.min(i, path.length - 1)];
        const b = path[Math.min(i + 1, path.length - 1)];
        const x = a.x + (b.x - a.x) * frac;
        const y = a.y + (b.y - a.y) * frac;

        container.position.set(x, y);

        if (t >= 1) {
          onComplete?.();
          return true;
        }
        return false;
      },
    };
    this.animations.push(animation);
  }

  updateGhostPreview(
    players: Map<string, Player>,
    driveState: DriveState,
    maxSpeed: number,
    combatZone?: CombatZone
  ): void {
    this.ghostPreviewGraphics.clear();

    const GHOST_TICKS = 60;

    for (const [id, player] of players) {
      const isLocal = id === this.localPlayerId;

      // In combat during local player's own turn, the combat preview handles rendering
      if (isLocal) {
        const localInCombat = combatZone?.combatantIds.includes(id) ?? false;
        const isOurTurn = combatZone?.currentTurn === id;
        if (localInCombat && isOurTurn) continue;
      }

      // For local player, use the input driveState (more responsive, no round-trip delay)
      // For remote players, use the broadcast steeringAngle and velocity
      const steeringAngle = isLocal ? driveState.steeringAngle : (player.steeringAngle ?? 0);
      const speed = isLocal
        ? Math.max(0, Math.min(driveState.targetSpeed, maxSpeed))
        : player.velocity.speed;
      const playerMaxSpeed = isLocal
        ? maxSpeed
        : this.getEffectiveSpeed(player);

      // Only show ghost when moving or steering
      if (speed <= 0 && steeringAngle === 0) continue;
      if (speed <= 0) continue;

      // In combat, cap ghost to remaining movement budget
      const inCombat = combatZone?.combatantIds.includes(id) ?? false;
      let ticks = GHOST_TICKS;
      if (inCombat) {
        const budget = player.combatMovementBudget ?? 0;
        const used = player.combatMovementUsed ?? 0;
        ticks = Math.max(0, budget - used);
        if (ticks <= 0) continue;
      }

      const result = simulatePhysics(
        {
          position: { ...player.position },
          speed,
          heading: player.velocity.heading,
          steeringAngle,
        },
        playerMaxSpeed,
        Infinity,
        ticks
      );

      if (result.path.length < 2) continue;

      // Use player's color for remote, cyan-ish for local
      const color = isLocal ? 0x88ccff : this.getPlayerColor(id);
      const fillAlpha = isLocal ? 0.15 : 0.1;
      const strokeAlpha = isLocal ? 0.4 : 0.25;

      // Draw trajectory curve
      this.ghostPreviewGraphics.moveTo(result.path[0].x, result.path[0].y);
      for (let i = 1; i < result.path.length; i++) {
        this.ghostPreviewGraphics.lineTo(result.path[i].x, result.path[i].y);
      }
      this.ghostPreviewGraphics.stroke({ width: 2, color, alpha: strokeAlpha });

      // Draw ghost car at final position
      const finalPos = result.path[result.path.length - 1];
      const finalHeading = result.final.heading;
      const cos = Math.cos(finalHeading);
      const sin = Math.sin(finalHeading);
      const hw = CAR_WIDTH / 2;
      const hh = CAR_HEIGHT / 2;
      const corners = [
        { x: finalPos.x + (-hw * cos - -hh * sin), y: finalPos.y + (-hw * sin + -hh * cos) },
        { x: finalPos.x + ( hw * cos - -hh * sin), y: finalPos.y + ( hw * sin + -hh * cos) },
        { x: finalPos.x + ( hw * cos -  hh * sin), y: finalPos.y + ( hw * sin +  hh * cos) },
        { x: finalPos.x + (-hw * cos -  hh * sin), y: finalPos.y + (-hw * sin +  hh * cos) },
      ];
      this.ghostPreviewGraphics.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        this.ghostPreviewGraphics.lineTo(corners[i].x, corners[i].y);
      }
      this.ghostPreviewGraphics.closePath();
      this.ghostPreviewGraphics.fill({ color, alpha: fillAlpha });
      this.ghostPreviewGraphics.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        this.ghostPreviewGraphics.lineTo(corners[i].x, corners[i].y);
      }
      this.ghostPreviewGraphics.closePath();
      this.ghostPreviewGraphics.stroke({ width: 1, color, alpha: strokeAlpha * 0.85 });
    }
  }

  private getEffectiveSpeed(player: Player): number {
    const speedBonus = player.car.parts
      .filter((p) => p.stats.speed)
      .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);
    return player.car.baseSpeed + speedBonus;
  }

  updateDriveGauges(driveState: DriveState, maxSpeed: number): void {
    // Speedometer needle rotation: 0° = left (min), 180° = right (max)
    const needleEl = document.getElementById("speedo-needle");
    if (needleEl) {
      const ratio = maxSpeed > 0 ? driveState.targetSpeed / maxSpeed : 0;
      const rotation = -90 + ratio * 180; // -90° is left, 90° is right
      needleEl.style.transform = `rotate(${rotation}deg)`;
    }

    // Speed bar segments
    const barEl = document.getElementById("speed-bar");
    if (barEl) {
      let html = "";
      for (let i = maxSpeed; i >= 1; i--) {
        const active = i <= driveState.targetSpeed;
        html += `<div class="speed-segment ${active ? "active" : ""}"></div>`;
      }
      barEl.innerHTML = html;
    }

    // Speed text
    const speedValEl = document.getElementById("speed-value");
    if (speedValEl) {
      speedValEl.textContent = `${driveState.targetSpeed} / ${maxSpeed}`;
    }

    // Steering indicator -- shows actual steering angle
    const indicatorEl = document.getElementById("steering-indicator");
    if (indicatorEl) {
      const ratio = PHYSICS.MAX_STEERING_ANGLE > 0
        ? driveState.steeringAngle / PHYSICS.MAX_STEERING_ANGLE
        : 0;
      // Map -1..1 to 0%..100%
      const pct = 50 + ratio * 50;
      indicatorEl.style.left = `${pct}%`;
      indicatorEl.style.background = driveState.steeringAngle === 0 ? "#4fc3f7" : "#ffcc00";
    }

    const steerValEl = document.getElementById("steering-value");
    if (steerValEl) {
      steerValEl.textContent = `${driveState.steeringAngle}°`;
    }
  }

  /** Convert screen coordinates to world coordinates */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.world.position.x) / this.zoom,
      y: (screenY - this.world.position.y) / this.zoom,
    };
  }
}
