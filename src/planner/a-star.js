/**
 * A* over the existing matrix format or a flat list of cell records.
 * Flat records use { row, col, traversable, risk, lon/lat bounds } and default
 * to the risk objective. Their time objective uses physical distance and a
 * constant rover speed. Matrix grids keep the existing cost objectives.
 */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (a[p].priority <= value.priority) break;
      a[i] = a[p]; i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items;
    if (!a.length) return undefined;
    const first = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const left = 2 * i + 1;
        const right = left + 1;
        if (left >= a.length) break;
        const child = right < a.length && a[right].priority < a[left].priority ? right : left;
        if (a[child].priority >= last.priority) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

const keyOf = ({ row, col }) => `${row},${col}`;
const same = (a, b) => a.row === b.row && a.col === b.col;
const inside = (grid, p) => p.row >= 0 && p.row < grid.rows && p.col >= 0 && p.col < grid.cols;

function cellCost(grid, objective, p) {
  return grid[objective][p.row][p.col];
}

function neighbors(grid, p) {
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const next = { row: p.row + dr, col: p.col + dc };
      if (!inside(grid, next) || grid.blocked[next.row][next.col]) continue;

      const diagonal = dr !== 0 && dc !== 0;
      // Prevent squeezing diagonally between two blocked or missing cells.
      if (diagonal && (grid.blocked[p.row][next.col] || grid.blocked[next.row][p.col])) continue;
      result.push(next);
    }
  }
  return result;
}

/** Returns { path, objectiveCost } or null when no route exists. */
export function findPath({ grid: sourceGrid, start, goal, objective, roverSpeedMps, unknownRiskPenalty = 0 }) {
  const isCellList = Array.isArray(sourceGrid);
  objective ??= isCellList ? 'risk' : 'timeSeconds';
  const grid = isCellList ? cellsToMatrix(sourceGrid, unknownRiskPenalty, objective) : sourceGrid;
  if (!['risk', 'timeSeconds'].includes(objective)) throw new Error(`Unknown objective: ${objective}`);
  if (isCellList && objective === 'timeSeconds' && (!Number.isFinite(roverSpeedMps) || roverSpeedMps <= 0)) {
    throw new Error('roverSpeedMps must be a positive finite number to calculate travel time');
  }
  if (!grid || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols)
      || (!isCellList || objective !== 'timeSeconds') && !Array.isArray(grid[objective])) {
    throw new Error(`Grid does not provide a valid ${objective} cost matrix`);
  }

  for (const [name, point] of [['start', start], ['goal', goal]]) {
    if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.col) || !inside(grid, point)) {
      throw new Error(`${name} must identify a cell inside the grid`);
    }
    if (grid.blocked[point.row][point.col]) throw new Error(`${name} is in a blocked cell`);
  }
  if (same(start, goal)) return { path: [start], objectiveCost: 0 };

  let minCost = Infinity;
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      if (grid.blocked[r][c]) continue;
      const cost = isCellList && objective === 'timeSeconds'
        ? 1 / roverSpeedMps
        : cellCost(grid, objective, { row: r, col: c });
      minCost = Math.min(minCost, cost);
    }
  }

  const distance = new Map([[keyOf(start), 0]]);
  const previous = new Map();
  const open = new MinHeap();
  const heuristic = (p) => {
    if (isCellList) {
      const straightDistance = distanceBetween(grid, p, goal);
      return objective === 'timeSeconds' ? straightDistance / roverSpeedMps : straightDistance * minCost;
    }
    const dx = Math.abs(p.col - goal.col);
    const dy = Math.abs(p.row - goal.row);
    // Octile distance is admissible for 8-direction movement.
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * minCost;
  };
  open.push({ point: start, priority: heuristic(start) });

  while (open.size) {
    const current = open.pop().point;
    const currentKey = keyOf(current);
    if (same(current, goal)) {
      const path = [current];
      let key = currentKey;
      while (previous.has(key)) {
        const parent = previous.get(key);
        path.push(parent);
        key = keyOf(parent);
      }
      path.reverse();
      return { path, objectiveCost: distance.get(currentKey) };
    }

    for (const next of neighbors(grid, current)) {
      const nextKey = keyOf(next);
      const edgeDistance = distanceBetween(grid, current, next);
      const edgeCost = isCellList && objective === 'timeSeconds'
        ? edgeDistance / roverSpeedMps
        : ((cellCost(grid, objective, current) + cellCost(grid, objective, next)) / 2) * edgeDistance;
      const candidate = distance.get(currentKey) + edgeCost;
      if (candidate >= (distance.get(nextKey) ?? Infinity)) continue;
      previous.set(nextKey, current);
      distance.set(nextKey, candidate);
      open.push({ point: next, priority: candidate + heuristic(next) });
    }
  }
  return null;
}

function cellsToMatrix(cells, unknownRiskPenalty) {
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('Grid must contain a non-empty cell array');
  if (!Number.isFinite(unknownRiskPenalty) || unknownRiskPenalty < 0) {
    throw new Error('unknownRiskPenalty must be a finite, non-negative number');
  }

  let rows = 0;
  let cols = 0;
  for (const cell of cells) {
    if (!cell || !Number.isInteger(cell.row) || cell.row < 0 || !Number.isInteger(cell.col) || cell.col < 0) {
      throw new Error('Every cell must have non-negative integer row and col values');
    }
    if (typeof cell.traversable !== 'boolean') throw new Error('Every cell must have a boolean traversable value');
    rows = Math.max(rows, cell.row + 1);
    cols = Math.max(cols, cell.col + 1);
  }

  const blocked = Array.from({ length: rows }, () => Array(cols).fill(true));
  const risk = Array.from({ length: rows }, () => Array(cols).fill(null));
  const cellCenters = new Map();
  const seen = new Set();

  for (const cell of cells) {
    const key = keyOf(cell);
    if (seen.has(key)) throw new Error(`Duplicate grid position (${key})`);
    seen.add(key);
    if (!cell.traversable) continue;
    if (cell.risk !== null && cell.risk !== undefined && (!Number.isFinite(cell.risk) || cell.risk < 0)) {
      throw new Error(`Risk at (${key}) must be a non-negative number or null`);
    }
    blocked[cell.row][cell.col] = false;
    risk[cell.row][cell.col] = cell.risk == null ? unknownRiskPenalty : cell.risk;
    if (['lon_min', 'lon_max', 'lat_min', 'lat_max'].every((key) => Number.isFinite(cell[key]))) {
      cellCenters.set(key, {
        lat: (cell.lat_min + cell.lat_max) / 2,
        lon: (cell.lon_min + cell.lon_max) / 2,
      });
    }
  }

  return { rows, cols, risk, blocked, cellCenters };
}

function distanceBetween(grid, a, b) {
  const centerA = grid.cellCenters?.get(keyOf(a));
  const centerB = grid.cellCenters?.get(keyOf(b));
  if (centerA && centerB) return marsSurfaceDistance(centerA, centerB);

  return Math.hypot(b.col - a.col, b.row - a.row);
}

function marsSurfaceDistance(a, b) {
  const radiusMeters = 3_389_500;
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * radians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
