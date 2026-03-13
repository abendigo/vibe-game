# CLAUDE.md

## Project Overview
Top-down 2D multiplayer vehicular RPG. Players drive customizable cars, explore freely in real-time, and engage in turn-based tactical combat (Divinity/Baldur's Gate style).

## Tech Stack
- **Monorepo**: npm workspaces (not pnpm)
- **Frontend**: Vite + TypeScript + Pixi.js v8 (port 5173)
- **Backend**: Node.js + TypeScript + ws WebSockets (port 3001)
- **Shared**: `@game/shared` — common types and logic used by both client and server
- **Dev server runner**: `tsx watch` for server hot reload

## Project Structure
```
packages/
  shared/src/
    types.ts        — Vec2, Player, Car, CarPart, GameState, GamePhase, TileType, BuildingDef, TownMapData, message types
    physics.ts      — shared deterministic physics simulation (simulatePhysics)
    townMap.ts      — tile-based town map data (40x40 grid, buildings, NPC waypoints)
    index.ts        — re-exports
  server/src/
    index.ts        — HTTP + WebSocket server entry point, message routing, 60fps game loop
    gameState.ts    — GameStateManager class (all state mutations)
    persistence.ts  — file-based save/load, auto-save, player restore on reconnect
    auth.ts         — password hashing (scrypt), session token management
  server/data/
    gamestate.json  — save file (gitignored)
  client/src/
    main.ts         — Pixi.js v8 init, WebSocket connection, game bootstrap
    renderer.ts     — Pixi.js rendering (grid, cars, camera follow, combat UI)
    render-utils.ts — pure rendering math (camera, minimap, colors, screen↔world)
    network.ts      — WebSocket client wrapper with auto-reconnect
    input.ts        — tap-to-set DriveState (explore + combat), spacebar combat confirm
    input-utils.ts  — pure input logic (driveStateChanged, nearest player, combat check)
    vite-env.d.ts   — global type declarations (__APP_VERSION__)
```

## Commands
- `npm run dev` — start both client and server concurrently
- `npm run dev:client` — client only (Vite on :5173)
- `npm run dev:server` — server only (tsx watch on :3001)
- `npm -w @game/shared run build` — build shared types (must run before server if types change)
- `npm run build` — build all packages
- `npm test` — run all tests (vitest)
- `npm run test:watch` — run tests in watch mode
- `npm run test:coverage` — run tests with V8 coverage report (output in `coverage/`)
- `npm run test:e2e` — run Playwright E2E tests (auto-starts client + server)
- `npm run test:all` — run unit tests + E2E tests
- `docker compose up --build` — build and run in Docker (single container, port 3001)
- `docker compose up -d` — run in background

## Deployment

- **Single Docker image**: server serves both the API/WebSocket and the static client files on port 3001
- **Multi-stage Dockerfile**: build stage compiles shared + server + client, runtime stage is slim Node 22
- **docker-compose.yml**: maps port 3001, mounts a named volume for `packages/server/data` (save file persistence)
- **WebSocket URL**: client auto-derives from `window.location` in production, uses `ws://localhost:3001` in dev (`import.meta.env.DEV`)
- **Health check**: `GET /api/health` returns JSON with player count and game phase
- **Static files**: server serves `packages/client/dist/` for all non-API HTTP requests, with SPA fallback to `index.html`

## Key Architecture Decisions

- **WebSocket protocol**: discriminated union message types (`ClientMessage` / `ServerMessage` in shared/types.ts). All messages are JSON with a `type` field.

- **Game phases**: Lobby → Exploring → Combat → Shopping (enum `GamePhase`)

- **State management**: `GameStateManager` class on server is the single source of truth. Server broadcasts serialized state to all clients.

- **Serialization**: `GameState.players` is a `Map<string, Player>` — use `serializeGameState`/`deserializeGameState` helpers for network transfer (Map doesn't JSON.stringify natively).

- **Rendering**: Pixi.js v8 (async `Application.init()`). All visuals are placeholder shapes (rectangles for cars, grid for ground). Minimap in top-right corner shows zoomed-out view of full map with player dots and viewport indicator. Info panel in bottom-left shows local player stats. Game log panel on right side (max 50vh height) shows events in real-time. Drive gauges in bottom-right. Zoom controls below ui-overlay (top-left). Version SHA displayed as tiny dim text in bottom-right corner.

- **Version display**: `__APP_VERSION__` injected at build time via Vite `define`. Reads `VITE_APP_VERSION` env var (set in Docker/CI), falls back to `git rev-parse --short HEAD`, then `"dev"`. Displayed in `#version-display` element.

- **Movement model**: Persistent steering angle physics. Client sends `DriveState` (targetSpeed + steeringAngle), server runs `tickPhysics()` each tick. Speed is instant (no acceleration curve), steering angle is persistent (no auto-centering). Turn rate proportional to angle. Physics constants in `PHYSICS` export from shared types.

- **Exploration**: real-time, server runs 60fps tick loop with physics + broadcasting state

- **Combat**: turn-based, server validates turns and broadcasts results. Movement uses a budget system (multiple moves per turn allowed).

- **Persistence**: file-based JSON save to `packages/server/data/gamestate.json`. Player data and credentials keyed by name. Auto-saves every 30s + on SIGINT/SIGTERM. Save also triggers on player disconnect.

- **Authentication**: Name + password auth with scrypt hashing. Server auto-registers new names, verifies password for existing ones. Session tokens (in-memory) allow reconnect without re-entering password. Client stores token in `localStorage`. Duplicate connection prevention per player name.

## Maintenance Rules

- **Keep CLAUDE.md up to date**: After every significant change (new files, new systems, architectural changes, new dependencies, changed commands), update this file to reflect the current state of the project. This includes updating the project structure, architecture decisions, and any other relevant sections.

- **Ask before guessing**: If a request is ambiguous or unclear, ask for clarification before starting work. Don't attempt an implementation based on assumptions — get a clearer understanding first.

- **Git discipline**: Before making any code changes, check `git status` for uncommitted changes. If there are any, stop and tell the user — do not proceed. After completing changes, create a git commit with a descriptive message explaining what was done.

## Conventions
- TypeScript strict mode everywhere
- ES2022 target, NodeNext module resolution
- All packages use `"type": "module"` (ESM)
- Shared types must be built (`npm -w @game/shared run build`) before server can import them — server uses compiled output from `dist/`
- Client imports shared types directly via Vite's workspace resolution
- Tests use vitest (configured at root `vitest.config.ts`), test files live alongside source as `*.test.ts`
- Client pure logic is extracted into `render-utils.ts` and `input-utils.ts` for testability (no Pixi.js dependency)
- E2E tests use Playwright (`playwright.config.ts`), test files in `e2e/`. Client exposes `__TEST_PLAYER_POSITION__` and `__TEST_GAME_STATE__` on window for E2E assertions

## Movement & Physics

- **Input model**: Discrete tap-to-set. Client sends `{ type: "driveState", targetSpeed, steeringAngle }` when state changes. Server stores latest `DriveState` per player in `playerDriveStates` map.

- **Speed**: Integer steps 0 to `maxSpeed` (effective speed from car parts). W/ArrowUp = +1, S/ArrowDown = -1. Speed holds until changed — no decay, no acceleration curve. Instant.

- **Steering**: A/D sets a persistent steering angle in discrete steps of `STEERING_STEP` (5 degrees), clamped to [-MAX_STEERING_ANGLE, MAX_STEERING_ANGLE] ([-45, 45]). Q centers to 0. No auto-centering — angle holds until player changes it. Turn rate per tick = `(angle / MAX_STEERING_ANGLE) * MAX_TURN_RATE`. Only steers when speed >= MIN_SPEED_FOR_TURN.

- **Input handling**: Discrete taps only (`e.repeat` ignored). No hold-to-repeat. No keyup tracking.

- **Physics constants** (exported from `@game/shared`): `MAX_TURN_RATE: 0.06 rad/tick`, `MIN_SPEED_FOR_TURN: 0.3`, `STEERING_STEP: 5°`, `MAX_STEERING_ANGLE: 45°`

- **DriveState**: `{ targetSpeed: number; steeringAngle: number }` — replaces old speed-only model

- **PhysicsSnapshot**: `{ position, speed, heading, steeringAngle }` — includes steering angle for simulation

- **Player velocity**: `Player.velocity: { speed: number; heading: number }` — speed is scalar (integer), heading is angle in radians

- **Ghost car preview**: Every frame, client runs `simulatePhysics()` forward ~60 ticks from the player's current state and draws a curved trajectory line + ghost car (faded rectangle) at the final projected position/rotation. Visible in both exploration and combat. In combat during the player's turn, the combat preview replaces the ghost preview. Rendered via `renderer.updateGhostPreview()`.

- **Combat movement**: Single "End Turn" model. Client runs shared `simulatePhysics()` to show a green trajectory preview of remaining movement budget. Player adjusts speed/steering, then presses Space or "End Turn" button to commit movement and advance the turn. `commitMovementThen()` sends `combatMoveConfirm` with the full remaining budget, then executes the follow-up action (end turn, fire weapon, etc.). Escape resets drive state to start-of-turn values. `combatMovementBudget = COMBAT_TICKS_PER_TURN (30)`. Budget resets on `advanceTurn()`.

- **Combat input limits**: During a turn, speed can be adjusted by 1 step (up or down), steering by up to 3 steps. Limits reset on turn change.

- **HUD gauges**: Bottom-right area shows speedometer (semicircular gauge with needle + vertical speed bar) and horizontal steering angle meter. Steering indicator shows actual steeringAngle position. Updated every frame via `renderer.updateDriveGauges()`. HTML/CSS elements in `index.html`.

- **Weapon range visualization**: In combat, local player's turn shows translucent range circles — cyan for laser, orange for projectile. Movement is visualized via the trajectory preview line (no budget circle).

- **Weapon firing**: Does NOT rotate the car to face the target. Car keeps its heading when firing.

## Car Customization Model
- `Car` has base stats (speed, armor, health) and a `parts: CarPart[]` array
- `CarPart` has a `type` (Engine, Wheels, Armor, Weapon, Accessory) and `stats` (speed, armor, damage, health, range)
- Effective stats = base stats + sum of part bonuses

## Combat System

- Turn-based, initiated by a player (spacebar). Creates a `CombatZone` with a center (initiator's position) and radius (300px).

- Only players within the combat radius become combatants and enter turn-based mode. Players outside continue real-time exploration. If a non-combatant moves into the combat zone, they automatically join the combat (inserted into turn order after the current turn). Server broadcasts `combatJoin` message when this happens.

- `CombatZone` in `GameState` holds: `center`, `radius`, `combatantIds`, `turnOrder`, `currentTurn`

- Actions: `move` (to Vec2), `attack` (manual target + weapon), `fireLaser`, `fireProjectile`, `useItem`, `wait`

- Server validates it's the acting player's turn before processing

- Damage = weapon damage - target armor

- Combat circle is rendered in the world (red tinted area + border) and on the minimap

## Weapon System

- Each car has two weapon types: **Laser Emitter** (instant hitscan) and **Machine Gun** (projectile)

- `WeaponKind` enum: `Laser` | `Projectile` — stored in `PartStats.weaponKind`

- **Laser**: 8 damage, 200 range, 10 energy (tracked in `PartStats.energy`/`maxEnergy`)

- **Projectile**: 4 damage, 150 range, 20 ammo (tracked in `PartStats.ammo`/`maxAmmo`)

- **Auto-targeting**: `fireLaser`/`fireProjectile` actions require no target — server finds all enemy combatants in range and picks one randomly

- **Hit/miss system**: Hit chance = base 70% + gunnery×5%, clamped 30-95%. Roll and chance are returned in `CombatResult` for game log display. Misses still consume ammo/energy but deal no damage; miss animation offsets the target position

- **Animations**: Server returns `WeaponAnimationData` (kind, from, to, hit) in `CombatResult`. Client renders:
  - Laser: cyan beam line that fades out over 200ms with impact flash
  - Projectile: orange bullet that travels from shooter to target over 400ms with trail and impact

- Combat UI shows "Laser [N]", "Gun [N]", and "End Turn [Space]" buttons; ammo/energy buttons disable at 0

- Persistence migration: old saves with single "Bumper Cannon" weapon are auto-migrated to dual weapons on restore

## Player Skills
- `PlayerSkills` — `driving`, `gunnery`, `luck` (default 1 each for new players)
- Skills are saved/restored via persistence
- Skills are displayed in the info panel

## Escape Mechanic

- **Distance-based**: A combatant escapes combat automatically by moving 1000+ px away from all other combatants (`ESCAPE_DISTANCE = 1000`)

- `checkDistanceEscape(playerId)` checks after every combat move (player or NPC)

- On escape: player is removed from combat; if <2 combatants remain, combat ends

- Server broadcasts `combatEscape` message to notify all clients

- No UI button needed — escape happens organically through movement

## Map System

- **Tile-based**: 40x40 grid of 100px tiles, 4000x4000 world

- **Tile types**: `TileType.Grass` (0), `TileType.Road` (1), `TileType.Building` (2)

- **Town layout**: Main 2-tile-wide road loop (tiles 12-27), cross streets bisecting N-S and E-W, entry roads from all 4 map edges

- **Buildings**: Visual-only rectangles with distinct colors, placed in 4 quadrants inside the loop. `BuildingDef` has position, size, color, optional name

- **Map data**: `TOWN_MAP` exported from `shared/townMap.ts` — contains tile grid, building defs, NPC waypoints

- **`getBuildingColor(row, col)`**: Precomputed lookup for per-tile building colors during rendering

- **Rendering**: `drawGrid()` in renderer paints each tile by type/color, draws building outlines, then subtle grid lines

- **Player spawn**: South entry road area (~2000, 3400-3600)

- **Zoom**: Scroll wheel or +/-/Reset buttons (25%-300%, default 100%). Camera, minimap viewport, and screen-to-world all zoom-aware

## NPC System

- **Practice NPC**: "Target Dummy" — follows a waypoint circuit along the main road loop

- `Player.isNPC?: boolean` flag distinguishes NPCs from human players

- `addNPC()` creates an NPC at the first waypoint with initial velocity

- **Exploration**: `tickNPCInput()` runs each server tick. `computeNPCDriveState()` steers toward the next waypoint (discrete 5° steps). Advances to next waypoint when within 80px threshold. Waypoints defined in `TOWN_MAP.npcWaypoints` (8 points, clockwise around the main loop)

- **Combat AI**: When it's the NPC's turn, `processNPCTurn()` fires back 25% of the time (prefers laser, falls back to projectile), otherwise waits. 1-second delay before acting for natural feel

- **Turn scheduling**: `scheduleNPCTurn()` is called after every turn change; uses a timer to auto-process NPC turns

- NPCs are rendered with orange `[NPC]` name tag on the client

- NPC is spawned on server start with id `"npc-target"`
