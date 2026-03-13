# Vehicular RPG

A top-down 2D multiplayer vehicular RPG. Drive customizable cars, explore a tile-based town in real-time, and engage in turn-based tactical combat.

## Play the Game

**Coming Soon**

## Features

- Real-time exploration with persistent steering physics
- Turn-based tactical combat with movement budgets and weapon systems
- Tile-based town map with roads, buildings, and NPC traffic
- Car customization with parts (engine, wheels, armor, weapons)
- Multiplayer via WebSocket with auto-reconnect
- Ghost car trajectory preview for all vehicles

## Tech Stack

- **Frontend**: TypeScript + Pixi.js v8
- **Backend**: Node.js + WebSocket (ws)
- **Shared**: Common physics and types package
- **Deployment**: Docker, GitHub Actions, GHCR

## Development

```bash
npm install
npm run dev
```

This starts both the client (port 5173) and server (port 3001).

### Other commands

```bash
npm test              # run unit tests
npm run test:e2e      # run Playwright E2E tests
npm run build         # build all packages
```

## Deployment

```bash
docker compose up --build
```

Single container serves both the client and WebSocket server on port 3001.
