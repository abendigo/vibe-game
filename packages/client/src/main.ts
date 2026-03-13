import { Application, Ticker } from "pixi.js";
import {
  type GameState,
  type Player,
  GamePhase,
  deserializeGameState,
} from "@game/shared";
import { Network } from "./network.js";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";

// ── Game Log ──

const MAX_LOG_ENTRIES = 50;

function addLogEntry(html: string): void {
  const container = document.getElementById("log-entries");
  if (!container) return;

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">${time}</span> ${html}`;

  container.prepend(entry);

  // Trim old entries
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.removeChild(container.lastChild!);
  }
}

function rollText(roll: number | undefined, chance: number | undefined): string {
  if (roll === undefined || chance === undefined) return "";
  return ` <span class="log-roll">(rolled ${roll} vs ${chance}%)</span>`;
}

// ── Setup ──

const renderer = new Renderer();
// Derive WebSocket URL from current page location (works in dev and production)
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const wsHost = window.location.host;
const wsUrl = import.meta.env.DEV
  ? "ws://localhost:3001"
  : `${wsProtocol}://${wsHost}`;
const network = new Network(wsUrl);

let gameState: GameState = {
  players: new Map(),
  phase: GamePhase.Exploring,
};

let localPlayerId: string | null = null;
let localPlayerName: string | null = null;

const STORAGE_KEY_TOKEN = "game_session_token";
const STORAGE_KEY_NAME = "game_player_name";

async function main(): Promise<void> {
  // Initialize Pixi
  await renderer.init();
  document.body.appendChild(renderer.app.canvas);

  // Set up input handler
  const input = new InputHandler(network, renderer);

  // Login screen elements
  const loginScreen = document.getElementById("login-screen")!;
  const loginForm = document.getElementById("login-form") as HTMLFormElement;
  const loginNameInput = document.getElementById("login-name") as HTMLInputElement;
  const loginPasswordInput = document.getElementById("login-password") as HTMLInputElement;
  const loginError = document.getElementById("login-error")!;
  const loginStatus = document.getElementById("login-status")!;
  const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;

  // Check for existing session
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  const savedName = localStorage.getItem(STORAGE_KEY_NAME);

  let needsLogin = !savedToken;

  // Pre-fill name if we have one
  if (savedName) {
    loginNameInput.value = savedName;
  }

  function showLogin(errorMsg?: string): void {
    if (!loginScreen.parentNode) {
      document.body.appendChild(loginScreen);
    }
    loginScreen.classList.remove("hidden");
    loginError.textContent = errorMsg ?? "";
    loginStatus.textContent = "";
    loginBtn.disabled = false;
    if (loginNameInput.value) {
      loginPasswordInput.focus();
    } else {
      loginNameInput.focus();
    }
  }

  function hideLogin(): void {
    loginScreen.remove();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = loginNameInput.value.trim();
    const password = loginPasswordInput.value;
    if (!name || !password) return;

    loginError.textContent = "";
    loginStatus.textContent = "Connecting...";
    loginBtn.disabled = true;
    localPlayerName = name;
    network.send({ type: "join", name, password });
  });

  // Hide login screen if we have a saved session (will attempt reconnect)
  if (!needsLogin) {
    loginScreen.classList.add("hidden");
    loginStatus.textContent = "";
  }

  // Handle server messages
  network.onMessage = (msg) => {
    switch (msg.type) {
      case "authenticated": {
        localPlayerId = msg.playerId;
        localStorage.setItem(STORAGE_KEY_TOKEN, msg.token);
        if (localPlayerName) {
          localStorage.setItem(STORAGE_KEY_NAME, localPlayerName);
        }
        renderer.localPlayerId = localPlayerId;
        input.localPlayerId = localPlayerId;
        hideLogin();
        console.log(`Authenticated as ${localPlayerId}`);
        break;
      }

      case "gameState": {
        gameState = deserializeGameState(msg.state);

        input.currentPhase = gameState.phase;
        input.currentTurn = gameState.currentTurn ?? null;
        input.combatZone = gameState.combatZone ?? null;
        input.localPlayerId = localPlayerId;
        input.players = gameState.players;

        // Update maxSpeed from effective speed
        if (localPlayerId) {
          const localPlayer = gameState.players.get(localPlayerId);
          if (localPlayer) {
            const speedBonus = localPlayer.car.parts
              .filter((p) => p.stats.speed)
              .reduce((sum, p) => sum + (p.stats.speed ?? 0), 0);
            input.maxSpeed = localPlayer.car.baseSpeed + speedBonus;
          }
        }

        renderer.localPlayerId = localPlayerId;
        renderer.updatePlayers(
          gameState.players,
          gameState.phase,
          gameState.combatZone,
          gameState.currentTurn
        );

        // Expose state for E2E tests
        if (localPlayerId) {
          const localPlayer = gameState.players.get(localPlayerId);
          if (localPlayer) {
            (window as any).__TEST_PLAYER_POSITION__ = { ...localPlayer.position };
          }
        }
        (window as any).__TEST_GAME_STATE__ = {
          phase: gameState.phase,
          playerCount: gameState.players.size,
          combatZone: gameState.combatZone ?? null,
          localPlayerId,
        };
        break;
      }

      case "playerJoined": {
        console.log(`Player joined: ${msg.player.name}`);
        gameState.players.set(msg.player.id, msg.player);
        addLogEntry(`<span class="log-join">${msg.player.name}</span> <span class="log-info">joined the game</span>`);
        break;
      }

      case "playerLeft": {
        const leftPlayer = gameState.players.get(msg.id);
        const leftName = leftPlayer?.name ?? "???";
        console.log(`Player left: ${msg.id}`);
        gameState.players.delete(msg.id);
        addLogEntry(`<span class="log-leave">${leftName}</span> <span class="log-info">left the game</span>`);
        break;
      }

      case "combatStart": {
        console.log("Combat started!", msg.combatZone);
        gameState.phase = GamePhase.Combat;
        gameState.combatZone = msg.combatZone;
        gameState.turnOrder = msg.combatZone.turnOrder;
        input.currentPhase = GamePhase.Combat;
        input.combatZone = msg.combatZone;
        input.resetCombatTurn();
        const combatantNames = msg.combatZone.combatantIds
          .map((id) => gameState.players.get(id)?.name ?? "???")
          .join(", ");
        addLogEntry(`<span class="log-combat">Combat started!</span> <span class="log-info">${combatantNames}</span>`);
        break;
      }

      case "combatJoin": {
        console.log(`Player ${msg.playerId} joined combat`);
        gameState.combatZone = msg.combatZone;
        gameState.turnOrder = msg.combatZone.turnOrder;
        input.combatZone = msg.combatZone;
        const joinedName = gameState.players.get(msg.playerId)?.name ?? "???";
        addLogEntry(`<span class="log-combat">${joinedName}</span> <span class="log-info">entered the combat zone</span>`);
        break;
      }

      case "combatMoveResult": {
        const isLocal = msg.playerId === localPlayerId;
        if (isLocal) {
          input.cancelPreview();
        }
        input.setAnimating(true);
        renderer.animateCombatMove(msg.playerId, msg.path, () => {
          input.setAnimating(false);
        });
        break;
      }

      case "combatUpdate": {
        console.log(
          `Combat: ${msg.result.message} (${msg.result.success ? "success" : "failed"})`
        );
        // Play weapon animation if present
        if (msg.result.animation) {
          renderer.playWeaponAnimation(msg.result.animation);
        }
        // Log combat actions
        if (msg.result.success && msg.result.animation) {
          if (msg.result.animation.hit) {
            addLogEntry(
              `<span class="log-hit">${msg.result.message}</span>${rollText(msg.result.roll, msg.result.chance)}`
            );
          } else {
            addLogEntry(
              `<span class="log-miss">${msg.result.message}</span>${rollText(msg.result.roll, msg.result.chance)}`
            );
          }
        } else if (msg.result.success && msg.action.type === "move") {
          // Don't log moves - too spammy
        } else if (msg.result.success && msg.action.type === "wait") {
          addLogEntry(`<span class="log-info">${msg.result.message}</span>`);
        } else if (!msg.result.success) {
          // Log failures that aren't "not your turn" spam
          if (msg.result.message !== "Not your turn") {
            addLogEntry(`<span class="log-miss">${msg.result.message}</span>`);
          }
        }
        break;
      }

      case "turnChange": {
        console.log(`Turn: ${msg.playerId}`);
        gameState.currentTurn = msg.playerId;
        input.currentTurn = msg.playerId;
        if (msg.playerId === localPlayerId) {
          input.resetCombatTurn();
        }
        break;
      }

      case "combatEscape": {
        console.log(`${msg.playerName} escaped combat by distance!`);
        addLogEntry(`<span class="log-escape-ok">${msg.playerName} escaped combat!</span>`);
        break;
      }

      case "error": {
        console.error(`Server error: ${msg.message}`);
        if (msg.message === "Invalid or expired session") {
          // Reconnect failed — clear session and show login
          localStorage.removeItem(STORAGE_KEY_TOKEN);
          localStorage.removeItem(STORAGE_KEY_NAME);
          needsLogin = true;
          showLogin("Session expired. Please log in again.");
        } else if (
          msg.message.includes("password") ||
          msg.message.includes("Password") ||
          msg.message === "Player already connected" ||
          msg.message === "Already joined"
        ) {
          // Auth error — show on login form
          showLogin(msg.message);
        } else if (!localPlayerId) {
          // Any error before auth completes — show on login form
          showLogin(msg.message);
        }
        break;
      }
    }
  };

  network.onOpen = () => {
    if (!needsLogin && savedToken) {
      // Try to reconnect with saved session
      localPlayerName = savedName;
      network.send({ type: "reconnect", token: savedToken });
    } else {
      showLogin();
    }
  };

  // Connect to server
  network.connect();

  // Set version display
  const versionEl = document.getElementById("version-display");
  if (versionEl) {
    versionEl.textContent = __APP_VERSION__;
  }

  // Game loop: send input, tick animations, update gauges and ghost preview every frame
  renderer.app.ticker.add((ticker) => {
    input.tick();
    renderer.tickAnimations(ticker.deltaMS);
    renderer.updateDriveGauges(input.driveState, input.maxSpeed);
    renderer.updateGhostPreview(
      gameState.players,
      input.driveState,
      input.maxSpeed,
      gameState.combatZone
    );
  });
}

main().catch(console.error);
