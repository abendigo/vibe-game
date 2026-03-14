import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  type ClientMessage,
  type ServerMessage,
  type Player,
  serializeGameState,
  PHYSICS,
  WORLD_MAP,
} from "@game/shared";
import { GameStateManager } from "./gameState.js";
import { load, save, restorePlayer, startAutoSave } from "./persistence.js";
import type { SaveData } from "./persistence.js";
import type { StoredCredentials } from "./auth.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionPlayer,
} from "./auth.js";

const PORT = 3001;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

const gameState = new GameStateManager();

// Loaded save data for restoring returning players
let savedPlayerData: Record<string, { name: string; position: { x: number; y: number }; rotation: number; car: import("@game/shared").Player["car"]; velocity?: { speed: number; heading: number } }> = {};

// Stored credentials keyed by player name
let credentials: Record<string, StoredCredentials> = {};

// Map WebSocket -> player ID
const clients = new Map<WebSocket, string>();

// Cached JSON for tiles endpoint (static data, computed once)
let cachedTilesJson: string | null = null;

// ── Helpers ──

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: ServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function broadcastGameState(): void {
  const state = gameState.state;
  const combatantIds = state.combatZone?.combatantIds ?? [];

  for (const [ws, playerId] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    const viewer = state.players.get(playerId);
    if (!viewer) continue;

    const viewerInCombat = combatantIds.includes(playerId);

    // Filter players by visibility radius
    const filteredPlayers = new Map<string, Player>();
    for (const [id, player] of state.players) {
      // Always include self
      if (id === playerId) {
        filteredPlayers.set(id, player);
        continue;
      }
      // Always include all combatants if viewer is in combat
      if (viewerInCombat && combatantIds.includes(id)) {
        filteredPlayers.set(id, player);
        continue;
      }
      // Range check
      const dx = player.position.x - viewer.position.x;
      const dy = player.position.y - viewer.position.y;
      if (dx * dx + dy * dy <= PHYSICS.VISIBILITY_RADIUS * PHYSICS.VISIBILITY_RADIUS) {
        filteredPlayers.set(id, player);
      }
    }

    const filteredState = {
      ...state,
      players: filteredPlayers,
    };

    ws.send(JSON.stringify({
      type: "gameState",
      state: serializeGameState(filteredState),
    }));
  }
}

// ── HTTP server (static files + health check) ──

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIST = join(__dirname, "..", "..", "client", "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const httpServer = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // Health check endpoint
  if (url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      players: gameState.state.players.size,
      phase: gameState.state.phase,
    }));
    return;
  }

  // Admin tiles endpoint — serves static tile + building data for map rendering
  if (url === "/api/admin/tiles") {
    // Cache tiles forever — they never change at runtime
    if (!cachedTilesJson) {
      cachedTilesJson = JSON.stringify({
        tiles: WORLD_MAP.tiles,
        buildings: WORLD_MAP.buildings,
      });
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(cachedTilesJson);
    return;
  }

  // Admin state endpoint — returns all players unfiltered
  if (url === "/api/admin/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const state = gameState.state;
    const players: Array<{
      id: string;
      name: string;
      position: { x: number; y: number };
      rotation: number;
      speed: number;
      heading: number;
      hp: number;
      maxHp: number;
      isNPC: boolean;
      inCombat: boolean;
    }> = [];
    for (const [id, p] of state.players) {
      players.push({
        id,
        name: p.name,
        position: p.position,
        rotation: p.rotation,
        speed: p.velocity.speed,
        heading: p.velocity.heading,
        hp: p.car.baseHealth,
        maxHp: 100,
        isNPC: p.isNPC ?? false,
        inCombat: state.combatZone?.combatantIds.includes(id) ?? false,
      });
    }
    res.end(JSON.stringify({
      players,
      phase: state.phase,
      combatZone: state.combatZone ?? null,
      connectedClients: clients.size,
    }));
    return;
  }

  // Serve static client files
  let filePath = join(CLIENT_DIST, url === "/" ? "index.html" : url);
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for unmatched routes
    try {
      const data = await readFile(join(CLIENT_DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

// ── WebSocket server ──

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    const playerId = clients.get(ws);
    if (playerId) {
      // Save player data before removing so they can reconnect later
      const player = gameState.state.players.get(playerId);
      if (player) {
        savedPlayerData[player.name] = {
          name: player.name,
          position: { ...player.position },
          rotation: player.rotation,
          car: structuredClone(player.car),
          velocity: { ...player.velocity },
        };
      }

      console.log(`Player ${playerId} disconnected`);
      gameState.removePlayer(playerId);
      clients.delete(ws);
      broadcast({ type: "playerLeft", id: playerId });
      save(gameState, credentials).catch((err) => console.error("Save on disconnect failed:", err));
    }
  });
});

// ── Message handler ──

async function handleMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "join": {
      // Check if this socket already has a player
      if (clients.has(ws)) {
        send(ws, { type: "error", message: "Already joined" });
        return;
      }

      const { name, password } = msg;

      if (!password || password.length < 1) {
        send(ws, { type: "error", message: "Password is required" });
        return;
      }

      // Check if player name is already registered
      if (credentials[name]) {
        // Verify password
        const valid = await verifyPassword(password, credentials[name].passwordHash);
        if (!valid) {
          send(ws, { type: "error", message: "Wrong password" });
          return;
        }

        // Check if this player is already connected
        for (const [existingWs, existingId] of clients) {
          const existingPlayer = gameState.state.players.get(existingId);
          if (existingPlayer?.name === name) {
            send(ws, { type: "error", message: "Player already connected" });
            return;
          }
        }
      } else {
        // Register new player
        const passwordHash = await hashPassword(password);
        credentials[name] = { passwordHash };
        console.log(`New player "${name}" registered`);
      }

      const id = crypto.randomUUID();
      const player = gameState.addPlayer(id, name);

      // Restore saved data if this player name was previously saved
      if (savedPlayerData[name]) {
        restorePlayer(player, savedPlayerData[name]);
        console.log(`Player "${name}" restored from save`);
      }

      clients.set(ws, id);
      const token = createSession(name);
      console.log(`Player "${name}" joined as ${id}`);

      // Send auth confirmation with session token
      send(ws, { type: "authenticated", playerId: id, token });

      // Send current state to the new player
      send(ws, {
        type: "gameState",
        state: serializeGameState(gameState.state),
      });

      // Broadcast to everyone that a new player joined
      broadcast({ type: "playerJoined", player });
      break;
    }

    case "reconnect": {
      if (clients.has(ws)) {
        send(ws, { type: "error", message: "Already joined" });
        return;
      }

      const playerName = getSessionPlayer(msg.token);
      if (!playerName) {
        send(ws, { type: "error", message: "Invalid or expired session" });
        return;
      }

      // Check if already connected
      for (const [, existingId] of clients) {
        const existingPlayer = gameState.state.players.get(existingId);
        if (existingPlayer?.name === playerName) {
          send(ws, { type: "error", message: "Player already connected" });
          return;
        }
      }

      const id = crypto.randomUUID();
      const player = gameState.addPlayer(id, playerName);

      if (savedPlayerData[playerName]) {
        restorePlayer(player, savedPlayerData[playerName]);
        console.log(`Player "${playerName}" reconnected from token`);
      }

      clients.set(ws, id);
      const newToken = createSession(playerName);

      send(ws, { type: "authenticated", playerId: id, token: newToken });
      send(ws, {
        type: "gameState",
        state: serializeGameState(gameState.state),
      });
      broadcast({ type: "playerJoined", player });
      break;
    }

    case "driveState": {
      const playerId = clients.get(ws);
      if (!playerId) {
        send(ws, { type: "error", message: "Not joined" });
        return;
      }
      gameState.setDriveState(playerId, {
        targetSpeed: msg.targetSpeed,
        steeringAngle: msg.steeringAngle,
      });
      break;
    }

    case "fireWeapon": {
      const playerId = clients.get(ws);
      if (!playerId) return;

      if (gameState.isInCombat(playerId)) {
        // In combat: process as combat action (must be their turn)
        const action = msg.weaponKind === "Laser"
          ? { type: "fireLaser" as const, targetId: msg.targetId }
          : { type: "fireProjectile" as const, targetId: msg.targetId };
        const result = gameState.processCombatAction(playerId, action);
        broadcast({ type: "combatUpdate", action, result });
        if (result.success) {
          const nextPlayer = gameState.advanceTurn();
          if (nextPlayer) {
            broadcast({ type: "turnChange", playerId: nextPlayer });
          }
          scheduleNPCTurn();
        }
        broadcastGameState();
      } else {
        // Exploration: fire weapon, potentially starting combat
        const { shotResult, combatZone } = gameState.fireWeaponExploration(
          playerId, msg.weaponKind, msg.targetId
        );

        if (!shotResult.success) {
          send(ws, { type: "error", message: shotResult.message });
          break;
        }

        // Broadcast the shot animation to everyone
        const shotAction = msg.weaponKind === "Laser"
          ? { type: "fireLaser" as const, targetId: msg.targetId }
          : { type: "fireProjectile" as const, targetId: msg.targetId };
        broadcast({ type: "combatUpdate", action: shotAction, result: shotResult });

        if (combatZone) {
          // Combat started — broadcast zone and advance past shooter's free action
          broadcast({ type: "combatStart", combatZone });
          const nextPlayer = gameState.advanceTurn();
          if (nextPlayer) {
            broadcast({ type: "turnChange", playerId: nextPlayer });
          }
          scheduleNPCTurn();
        }

        broadcastGameState();
      }
      break;
    }

    case "combatAction": {
      const playerId = clients.get(ws);
      if (!playerId) return;

      const result = gameState.processCombatAction(playerId, msg.action);
      broadcast({ type: "combatUpdate", action: msg.action, result });

      if (result.success && msg.action.type !== "move") {
        // Auto-advance turn after a successful non-escape, non-move action
        // (move uses budget and doesn't end turn)
        const nextPlayer = gameState.advanceTurn();
        if (nextPlayer) {
          broadcast({ type: "turnChange", playerId: nextPlayer });
        }
        scheduleNPCTurn();
      }
      broadcastGameState();
      break;
    }

    case "combatMoveConfirm": {
      const playerId = clients.get(ws);
      if (!playerId) return;

      const moveResult = gameState.processCombatMove(playerId, msg.driveState, msg.ticks);
      if (moveResult.success) {
        broadcast({
          type: "combatMoveResult",
          playerId,
          path: moveResult.path!,
          finalPosition: moveResult.finalPosition!,
          finalHeading: moveResult.finalHeading!,
          distanceUsed: moveResult.distanceUsed!,
        });

        // Check if this player escaped by distance
        const escapeCheck = gameState.checkDistanceEscape(playerId);
        if (escapeCheck.escaped) {
          broadcast({
            type: "combatEscape",
            playerId,
            playerName: escapeCheck.playerName ?? "",
          });
        }

        broadcastGameState();
      } else {
        send(ws, { type: "error", message: moveResult.message });
      }
      break;
    }

    case "endTurn": {
      const playerId = clients.get(ws);
      if (!playerId) return;

      const zone = gameState.state.combatZone;
      if (!zone || zone.currentTurn !== playerId) {
        send(ws, { type: "error", message: "Not your turn" });
        return;
      }

      const nextPlayer = gameState.advanceTurn();
      if (nextPlayer) {
        broadcast({ type: "turnChange", playerId: nextPlayer });
      }
      scheduleNPCTurn();
      broadcastGameState();
      break;
    }

    case "respawn": {
      const playerId = clients.get(ws);
      if (!playerId) return;

      if (gameState.isInCombat(playerId)) {
        send(ws, { type: "error", message: "Cannot respawn during combat" });
        return;
      }

      const player = gameState.state.players.get(playerId);
      if (player) {
        const spawn = WORLD_MAP.towns[0].spawnPoint;
        player.position = { x: spawn.x, y: spawn.y };
        player.velocity = { speed: 0, heading: player.velocity.heading };
        gameState.setDriveState(playerId, { targetSpeed: 0, steeringAngle: 0 });
      }
      broadcastGameState();
      break;
    }
  }
}

// ── NPC turn handling ──

const NPC_TURN_DELAY_MS = 1000; // Delay before NPC takes its turn (feels more natural)
let npcTurnTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNPCTurn(): void {
  if (npcTurnTimer) return; // Already scheduled

  const zone = gameState.state.combatZone;
  if (!zone) return;

  const currentPlayer = gameState.state.players.get(zone.currentTurn);
  if (!currentPlayer?.isNPC) return;

  npcTurnTimer = setTimeout(() => {
    npcTurnTimer = null;
    processNPCTurnNow();
  }, NPC_TURN_DELAY_MS);
}

function processNPCTurnNow(): void {
  const zone = gameState.state.combatZone;
  if (!zone) return;

  const npcId = zone.currentTurn;
  const currentPlayer = gameState.state.players.get(npcId);
  if (!currentPlayer?.isNPC) return;

  const turnResult = gameState.processNPCTurn();
  if (!turnResult) return;

  // Broadcast movement if the NPC moved
  if (turnResult.moveResult) {
    broadcast({
      type: "combatMoveResult",
      playerId: npcId,
      path: turnResult.moveResult.path,
      finalPosition: turnResult.moveResult.finalPosition,
      finalHeading: turnResult.moveResult.finalHeading,
      distanceUsed: turnResult.moveResult.distanceUsed,
    });

    // Check if NPC escaped by distance
    const escapeCheck = gameState.checkDistanceEscape(npcId);
    if (escapeCheck.escaped) {
      broadcast({
        type: "combatEscape",
        playerId: npcId,
        playerName: escapeCheck.playerName ?? "",
      });
    }
  }

  // Broadcast the combat action (fire or wait)
  broadcast({
    type: "combatUpdate",
    action: { type: turnResult.combatAction } as any,
    result: turnResult.combatResult,
  });

  // Auto-advance turn after NPC action
  const nextPlayer = gameState.advanceTurn();
  if (nextPlayer) {
    broadcast({ type: "turnChange", playerId: nextPlayer });
  }
  broadcastGameState();

  // If next turn is also NPC, schedule again
  scheduleNPCTurn();
}

// ── Game loop: broadcast state at tick rate during exploration ──

setInterval(() => {
  // NPC input updates run regardless of client count (NPC is always active)
  gameState.tickNPCInput();

  if (clients.size > 0) {
    // Run physics for all non-combat players (includes NPCs)
    const joinedCombat = gameState.tickPhysics();
    for (const playerId of joinedCombat) {
      if (gameState.state.combatZone) {
        broadcast({ type: "combatJoin", playerId, combatZone: gameState.state.combatZone });
      }
    }

    // Check if it's an NPC's combat turn
    scheduleNPCTurn();

    broadcastGameState();
  }
}, TICK_INTERVAL);

// ── Start ──

async function start(): Promise<void> {
  // Load saved state
  const saveData = await load();
  if (saveData) {
    savedPlayerData = saveData.players;
    credentials = saveData.credentials ?? {};
  }

  // Spawn one NPC per town (patrols that town's road loop)
  const towns = WORLD_MAP.towns;
  const townNPCNames = ["Dusty", "Ironclad", "Mirage"];
  for (let i = 0; i < towns.length; i++) {
    const npc = gameState.addNPC(`npc-town-${i}`, townNPCNames[i], towns[i].npcWaypoints);
    console.log(`NPC "${npc.name}" spawned in ${towns[i].name} at (${Math.round(npc.position.x)}, ${Math.round(npc.position.y)})`);
  }

  // Spawn circuit NPC that visits all towns
  const courier = gameState.addNPC("npc-courier", "Courier", WORLD_MAP.circuitWaypoints);
  console.log(`NPC "${courier.name}" spawned at (${Math.round(courier.position.x)}, ${Math.round(courier.position.y)})`);

  // Start auto-save (every 30s + on shutdown)
  startAutoSave(gameState, () => credentials);

  httpServer.listen(PORT, () => {
    console.log(`Game server running on http://localhost:${PORT}`);
  });
}

start();
