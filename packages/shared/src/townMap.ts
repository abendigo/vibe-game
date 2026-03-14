import { TileType, type BuildingDef, type TownMapData, type TownDef, type WorldMapData, type Vec2, PHYSICS } from "./types.js";

const S = PHYSICS.TILE_SIZE;
const TOWN_TILES = 40;  // each town is 40×40 tiles
const WORLD_TILES = PHYSICS.MAP_TILES; // 200

// ── Town template (local 40×40 coordinates) ──

const templateBuildings: BuildingDef[] = [
  // NW quadrant
  { x: 14, y: 14, width: 3, height: 2, color: 0x8b4513, name: "Warehouse" },
  { x: 18, y: 14, width: 1, height: 2, color: 0x696969, name: "Shed" },
  { x: 14, y: 17, width: 2, height: 1, color: 0xa0522d, name: "Workshop" },
  // NE quadrant
  { x: 21, y: 14, width: 2, height: 3, color: 0x556b2f, name: "General Store" },
  { x: 24, y: 15, width: 2, height: 1, color: 0x708090, name: "Office" },
  { x: 24, y: 17, width: 1, height: 1, color: 0x8b8682, name: "Kiosk" },
  // SW quadrant
  { x: 14, y: 21, width: 3, height: 2, color: 0x4682b4, name: "Garage" },
  { x: 15, y: 24, width: 1, height: 2, color: 0x8b0000, name: "Tower" },
  { x: 17, y: 24, width: 2, height: 1, color: 0x6b5b3a, name: "Barn" },
  // SE quadrant
  { x: 22, y: 22, width: 3, height: 3, color: 0x2f4f4f, name: "Town Hall" },
  { x: 21, y: 21, width: 1, height: 1, color: 0xdaa520, name: "Well" },
  { x: 21, y: 25, width: 2, height: 1, color: 0x704214, name: "Saloon" },
  // Depot — adjacent to cross-street intersection (just north of horizontal road)
  { x: 17, y: 18, width: 2, height: 1, color: 0x2a9d8f, name: "Depot" },
];

// NPC waypoints in local tile coordinates (clockwise around main loop, on road center)
const templateNPCWaypoints: Vec2[] = [
  { x: 13 * S + S / 2, y: 13 * S + S / 2 },
  { x: 20 * S, y: 13 * S + S / 2 },
  { x: 27 * S - S / 2, y: 13 * S + S / 2 },
  { x: 27 * S - S / 2, y: 20 * S },
  { x: 27 * S - S / 2, y: 27 * S - S / 2 },
  { x: 20 * S, y: 27 * S - S / 2 },
  { x: 13 * S + S / 2, y: 27 * S - S / 2 },
  { x: 13 * S + S / 2, y: 20 * S },
];

// ── Helper to paint tiles ──

function paintRect(tiles: TileType[][], col: number, row: number, w: number, h: number, type: TileType): void {
  const maxR = tiles.length;
  const maxC = tiles[0].length;
  for (let r = row; r < row + h && r < maxR; r++) {
    for (let c = col; c < col + w && c < maxC; c++) {
      tiles[r][c] = type;
    }
  }
}

// ── Create the 40×40 town template tile grid ──

function createTownTemplate(): TileType[][] {
  const T = TOWN_TILES;
  const tiles: TileType[][] = Array.from({ length: T }, () =>
    Array(T).fill(TileType.Grass)
  );

  // Main loop (2 tiles wide)
  paintRect(tiles, 12, 12, 16, 2, TileType.Road); // North
  paintRect(tiles, 12, 26, 16, 2, TileType.Road); // South
  paintRect(tiles, 12, 12, 2, 16, TileType.Road); // West
  paintRect(tiles, 26, 12, 2, 16, TileType.Road); // East

  // Cross streets (2 tiles wide)
  paintRect(tiles, 19, 12, 2, 16, TileType.Road); // Vertical
  paintRect(tiles, 12, 19, 16, 2, TileType.Road); // Horizontal

  // Entry roads from town edges
  paintRect(tiles, 19, 0, 2, 12, TileType.Road);  // North entry
  paintRect(tiles, 19, 28, 2, 12, TileType.Road); // South entry
  paintRect(tiles, 0, 19, 12, 2, TileType.Road);  // West entry
  paintRect(tiles, 28, 19, 12, 2, TileType.Road); // East entry

  // Buildings
  for (const b of templateBuildings) {
    paintRect(tiles, b.x, b.y, b.width, b.height, TileType.Building);
  }

  return tiles;
}

// ── Stamp a town template onto the world grid ──

function stampTown(worldTiles: TileType[][], template: TileType[][], originCol: number, originRow: number): void {
  for (let r = 0; r < TOWN_TILES; r++) {
    for (let c = 0; c < TOWN_TILES; c++) {
      const wr = originRow + r;
      const wc = originCol + c;
      if (wr < WORLD_TILES && wc < WORLD_TILES) {
        worldTiles[wr][wc] = template[r][c];
      }
    }
  }
}

// ── Convert template buildings to world coordinates ──

function worldBuildings(origin: Vec2): BuildingDef[] {
  return templateBuildings.map((b) => ({
    ...b,
    x: b.x + origin.x,
    y: b.y + origin.y,
  }));
}

// ── Convert template waypoints to world pixel coordinates ──

function worldWaypoints(origin: Vec2): Vec2[] {
  return templateNPCWaypoints.map((wp) => ({
    x: wp.x + origin.x * S,
    y: wp.y + origin.y * S,
  }));
}

// ── Connect two towns with an L-shaped 2-tile-wide road ──

function connectTowns(tiles: TileType[][], townA: TownDef, townB: TownDef): void {
  // Find the best exit points and draw an L-shaped road between them
  const aCenterCol = townA.tileOrigin.x + TOWN_TILES / 2;
  const aCenterRow = townA.tileOrigin.y + TOWN_TILES / 2;
  const bCenterCol = townB.tileOrigin.x + TOWN_TILES / 2;
  const bCenterRow = townB.tileOrigin.y + TOWN_TILES / 2;

  // Determine exit points based on relative positions
  // Town entry roads are at tiles 19-20 on each edge
  let startCol: number, startRow: number;
  let endCol: number, endRow: number;

  // Determine horizontal and vertical relationships
  const dx = bCenterCol - aCenterCol;
  const dy = bCenterRow - aCenterRow;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Primarily horizontal connection
    if (dx > 0) {
      // B is to the right of A — use A's east exit, B's west exit
      startCol = townA.tileOrigin.x + TOWN_TILES; // right edge of A
      startRow = townA.tileOrigin.y + 19;          // horizontal road row
      endCol = townB.tileOrigin.x;                  // left edge of B
      endRow = townB.tileOrigin.y + 19;
    } else {
      // B is to the left of A
      startCol = townA.tileOrigin.x;
      startRow = townA.tileOrigin.y + 19;
      endCol = townB.tileOrigin.x + TOWN_TILES;
      endRow = townB.tileOrigin.y + 19;
    }
  } else {
    // Primarily vertical connection
    if (dy > 0) {
      // B is below A — use A's south exit, B's north exit
      startCol = townA.tileOrigin.x + 19;
      startRow = townA.tileOrigin.y + TOWN_TILES; // bottom edge of A
      endCol = townB.tileOrigin.x + 19;
      endRow = townB.tileOrigin.y;                  // top edge of B
    } else {
      // B is above A
      startCol = townA.tileOrigin.x + 19;
      startRow = townA.tileOrigin.y;
      endCol = townB.tileOrigin.x + 19;
      endRow = townB.tileOrigin.y + TOWN_TILES;
    }
  }

  // Draw L-shaped road: horizontal segment first, then vertical
  // From startCol to endCol at startRow (2 tiles wide)
  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);

  // Horizontal segment at startRow
  paintRect(tiles, minCol, startRow, maxCol - minCol + 2, 2, TileType.Road);
  // Vertical segment at endCol
  paintRect(tiles, endCol, minRow, 2, maxRow - minRow + 2, TileType.Road);
}

// ── Town definitions ──

const dusthavenOrigin: Vec2 = { x: 80, y: 10 };
const ironworksOrigin: Vec2 = { x: 20, y: 120 };
const oasisOrigin: Vec2 = { x: 140, y: 120 };

const townTemplate = createTownTemplate();

const dusthaven: TownDef = {
  name: "Dusthaven",
  tileOrigin: dusthavenOrigin,
  buildings: worldBuildings(dusthavenOrigin),
  npcWaypoints: worldWaypoints(dusthavenOrigin),
  spawnPoint: {
    x: (dusthavenOrigin.x + 19.5) * S,
    y: (dusthavenOrigin.y + 34) * S,
  },
};

const ironworks: TownDef = {
  name: "Ironworks",
  tileOrigin: ironworksOrigin,
  buildings: worldBuildings(ironworksOrigin),
  npcWaypoints: worldWaypoints(ironworksOrigin),
  spawnPoint: {
    x: (ironworksOrigin.x + 19.5) * S,
    y: (ironworksOrigin.y + 34) * S,
  },
};

const oasis: TownDef = {
  name: "Oasis",
  tileOrigin: oasisOrigin,
  buildings: worldBuildings(oasisOrigin),
  npcWaypoints: worldWaypoints(oasisOrigin),
  spawnPoint: {
    x: (oasisOrigin.x + 19.5) * S,
    y: (oasisOrigin.y + 34) * S,
  },
};

// ── Build the full 200×200 world grid ──

function buildWorldGrid(): TileType[][] {
  const tiles: TileType[][] = Array.from({ length: WORLD_TILES }, () =>
    Array(WORLD_TILES).fill(TileType.Grass)
  );

  // Stamp all 3 towns
  stampTown(tiles, townTemplate, dusthavenOrigin.x, dusthavenOrigin.y);
  stampTown(tiles, townTemplate, ironworksOrigin.x, ironworksOrigin.y);
  stampTown(tiles, townTemplate, oasisOrigin.x, oasisOrigin.y);

  // Connect towns with roads
  connectTowns(tiles, dusthaven, ironworks);
  connectTowns(tiles, dusthaven, oasis);
  connectTowns(tiles, ironworks, oasis);

  // ── Truckstop on the Ironworks→Oasis road ──
  // Road runs at rows 139-140, cols 60-142. Truckstop at midpoint.
  // Parking lot: cols 96-107, rows 135-140 (connects to road)
  paintRect(tiles, 96, 135, 12, 6, TileType.Road);
  // Main building: cols 98-105, rows 132-134
  paintRect(tiles, 98, 132, 8, 3, TileType.Building);
  // Garage bay: cols 100-103, rows 135-136 (distinct color, interaction zone)
  paintRect(tiles, 100, 135, 4, 2, TileType.Building);
  // Depot: cols 108-109, rows 138-139 (east of parking lot, adjacent to road)
  paintRect(tiles, 108, 138, 2, 2, TileType.Building);

  return tiles;
}

const worldTiles = buildWorldGrid();

// ── Truckstop buildings ──

const truckstopBuildings: BuildingDef[] = [
  { x: 98, y: 132, width: 8, height: 3, color: 0xb05030, name: "Truckstop" },
  { x: 100, y: 135, width: 4, height: 2, color: 0xe8c840, name: "Garage" },
  { x: 108, y: 138, width: 2, height: 2, color: 0x2a9d8f, name: "Depot" },
];

// ── Precomputed building color lookup by tile coordinate ──

const allBuildings = [
  ...dusthaven.buildings,
  ...ironworks.buildings,
  ...oasis.buildings,
  ...truckstopBuildings,
];

const buildingColorMap = new Map<string, number>();
for (const b of allBuildings) {
  for (let r = b.y; r < b.y + b.height; r++) {
    for (let c = b.x; c < b.x + b.width; c++) {
      buildingColorMap.set(`${r},${c}`, b.color);
    }
  }
}

export function getBuildingColor(row: number, col: number): number | undefined {
  return buildingColorMap.get(`${row},${col}`);
}

// ── Inter-town circuit waypoints ──
// Dense waypoints that trace the actual road tiles so the courier never cuts
// across grass. Route: Dusthaven → Ironworks → Oasis → Dusthaven (loop).
//
// Road geometry (all 2-tile-wide):
//   Town entry roads at local cols/rows 19-20, cross streets at 19-20.
//   D→I road: horizontal at rows 50-51 (cols 39-100), vertical at cols 39-40 (rows 50-121)
//   D→O road: horizontal at rows 50-51 (cols 99-160), vertical at cols 159-160 (rows 50-121)
//   I→O road: horizontal at rows 139-140 (cols 60-141)
// Road center = +1 tile from the starting edge of the 2-tile span.

// Helper: center pixel of a 2-tile-wide road at given tile col/row
function roadCenter(col: number, row: number): Vec2 {
  return { x: (col + 1) * S, y: (row + 1) * S };
}

// Town cross-street intersection centers (tile origin + 19/20 in each axis)
const dusthavenCenter: Vec2 = { x: (dusthavenOrigin.x + 20) * S, y: (dusthavenOrigin.y + 20) * S };
const ironworksCenter: Vec2 = { x: (ironworksOrigin.x + 20) * S, y: (ironworksOrigin.y + 20) * S };
const oasisCenter: Vec2     = { x: (oasisOrigin.x + 20) * S, y: (oasisOrigin.y + 20) * S };

const circuitWaypoints: Vec2[] = [
  // ── Dusthaven (depot stop) ──
  dusthavenCenter,                                        // [0] cross-street center — DEPOT

  // ── Dusthaven → Ironworks (south exit, horizontal west, vertical south) ──
  { x: dusthavenCenter.x, y: (dusthavenOrigin.y + TOWN_TILES) * S },  // [1] south exit of town
  roadCenter(ironworksOrigin.x + 19, dusthavenOrigin.y + TOWN_TILES),  // [2] L-bend
  { x: (ironworksOrigin.x + 20) * S, y: ironworksOrigin.y * S },       // [3] Ironworks north entry

  // ── Ironworks (depot stop) ──
  ironworksCenter,                                        // [4] cross-street center — DEPOT

  // ── Ironworks → Oasis (east exit, past truckstop depot, to Oasis) ──
  { x: (ironworksOrigin.x + TOWN_TILES) * S, y: ironworksCenter.y },   // [5] east exit of town
  { x: 109 * S, y: ironworksCenter.y },                                 // [6] truckstop depot — DEPOT
  { x: oasisOrigin.x * S, y: oasisCenter.y },                           // [7] Oasis west entry

  // ── Oasis (depot stop) ──
  oasisCenter,                                            // [8] cross-street center — DEPOT

  // ── Oasis → Dusthaven (north exit, vertical north, horizontal east to Dusthaven south) ──
  { x: oasisCenter.x, y: oasisOrigin.y * S },                           // [9] north exit of town
  roadCenter(oasisOrigin.x + 19, dusthavenOrigin.y + TOWN_TILES),       // [10] L-bend
  { x: dusthavenCenter.x, y: (dusthavenOrigin.y + TOWN_TILES) * S },    // [11] Dusthaven south entry
];

/** Indices into circuitWaypoints where the courier stops for 60s (depot locations). */
export const CIRCUIT_DEPOT_STOPS: number[] = [0, 4, 6, 8];

// ── Exports ──

export const WORLD_MAP: WorldMapData = {
  tiles: worldTiles,
  towns: [dusthaven, ironworks, oasis],
  buildings: allBuildings,
  circuitWaypoints,
  garageZone: {
    x: 100 * S,   // tile col 100 → 10000px
    y: 135 * S,   // tile row 135 → 13500px
    width: 4 * S,  // 4 tiles wide → 400px
    height: 2 * S, // 2 tiles tall → 200px
  },
};

// Backward-compatible export — uses the first town (Dusthaven) data
// with world coordinates for waypoints/buildings
export const TOWN_MAP: TownMapData = {
  tiles: worldTiles,
  buildings: allBuildings,
  npcWaypoints: dusthaven.npcWaypoints,
};
