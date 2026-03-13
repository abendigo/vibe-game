import { TileType, type BuildingDef, type TownMapData, type Vec2, PHYSICS } from "./types.js";

const T = PHYSICS.MAP_TILES;
const S = PHYSICS.TILE_SIZE;

// ── Buildings ──

const buildings: BuildingDef[] = [
  // NW quadrant (inside the loop, top-left block)
  { x: 14, y: 14, width: 3, height: 2, color: 0x8b4513, name: "Warehouse" },
  { x: 18, y: 14, width: 1, height: 2, color: 0x696969, name: "Shed" },
  { x: 14, y: 17, width: 2, height: 1, color: 0xa0522d, name: "Workshop" },

  // NE quadrant (inside the loop, top-right block)
  { x: 21, y: 14, width: 2, height: 3, color: 0x556b2f, name: "General Store" },
  { x: 24, y: 15, width: 2, height: 1, color: 0x708090, name: "Office" },
  { x: 24, y: 17, width: 1, height: 1, color: 0x8b8682, name: "Kiosk" },

  // SW quadrant (inside the loop, bottom-left block)
  { x: 14, y: 21, width: 3, height: 2, color: 0x4682b4, name: "Garage" },
  { x: 15, y: 24, width: 1, height: 2, color: 0x8b0000, name: "Tower" },
  { x: 17, y: 24, width: 2, height: 1, color: 0x6b5b3a, name: "Barn" },

  // SE quadrant (inside the loop, bottom-right block)
  { x: 22, y: 22, width: 3, height: 3, color: 0x2f4f4f, name: "Town Hall" },
  { x: 21, y: 21, width: 1, height: 1, color: 0xdaa520, name: "Well" },
  { x: 21, y: 25, width: 2, height: 1, color: 0x704214, name: "Saloon" },
];

// ── Tile grid construction ──

function buildTileGrid(): TileType[][] {
  // Start with all grass
  const tiles: TileType[][] = Array.from({ length: T }, () =>
    Array(T).fill(TileType.Grass)
  );

  // Helper to paint a rectangle of tiles
  function paintRect(col: number, row: number, w: number, h: number, type: TileType): void {
    for (let r = row; r < row + h && r < T; r++) {
      for (let c = col; c < col + w && c < T; c++) {
        tiles[r][c] = type;
      }
    }
  }

  // ── Roads ──

  // Main loop (2 tiles wide)
  // North edge: row 12-13, cols 12-27
  paintRect(12, 12, 16, 2, TileType.Road);
  // South edge: row 26-27, cols 12-27
  paintRect(12, 26, 16, 2, TileType.Road);
  // West edge: col 12-13, rows 12-27
  paintRect(12, 12, 2, 16, TileType.Road);
  // East edge: col 26-27, rows 12-27
  paintRect(26, 12, 2, 16, TileType.Road);

  // Cross streets (2 tiles wide)
  // Vertical: cols 19-20, rows 12-27
  paintRect(19, 12, 2, 16, TileType.Road);
  // Horizontal: rows 19-20, cols 12-27
  paintRect(12, 19, 16, 2, TileType.Road);

  // Entry roads from map edges
  // North entry: cols 19-20, rows 0-12
  paintRect(19, 0, 2, 12, TileType.Road);
  // South entry: cols 19-20, rows 27-39
  paintRect(19, 28, 2, 12, TileType.Road);
  // West entry: cols 0-12, rows 19-20
  paintRect(0, 19, 12, 2, TileType.Road);
  // East entry: cols 27-39, rows 19-20
  paintRect(28, 19, 12, 2, TileType.Road);

  // ── Buildings ──
  for (const b of buildings) {
    paintRect(b.x, b.y, b.width, b.height, TileType.Building);
  }

  return tiles;
}

// ── NPC waypoints (world coords, clockwise around main loop, on road center) ──

const npcWaypoints: Vec2[] = [
  // Top-left corner
  { x: 13 * S + S / 2, y: 13 * S + S / 2 },
  // Top-center (cross street)
  { x: 20 * S, y: 13 * S + S / 2 },
  // Top-right corner
  { x: 27 * S - S / 2, y: 13 * S + S / 2 },
  // Right-center (cross street)
  { x: 27 * S - S / 2, y: 20 * S },
  // Bottom-right corner
  { x: 27 * S - S / 2, y: 27 * S - S / 2 },
  // Bottom-center (cross street)
  { x: 20 * S, y: 27 * S - S / 2 },
  // Bottom-left corner
  { x: 13 * S + S / 2, y: 27 * S - S / 2 },
  // Left-center (cross street)
  { x: 13 * S + S / 2, y: 20 * S },
];

// ── Precomputed building color lookup by tile coordinate ──

const buildingColorMap = new Map<string, number>();
for (const b of buildings) {
  for (let r = b.y; r < b.y + b.height; r++) {
    for (let c = b.x; c < b.x + b.width; c++) {
      buildingColorMap.set(`${r},${c}`, b.color);
    }
  }
}

export function getBuildingColor(row: number, col: number): number | undefined {
  return buildingColorMap.get(`${row},${col}`);
}

// ── Export ──

export const TOWN_MAP: TownMapData = {
  tiles: buildTileGrid(),
  buildings,
  npcWaypoints,
};
