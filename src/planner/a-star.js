/**
 * A* over a rectangular grid. `objective` selects the per-cell cost matrix:
 * `risk` minimizes accumulated terrain risk; `timeSeconds` minimizes travel time.
 * Blocked cells are excluded by the shared `blocked` mask.
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
  return [
    { row: p.row - 1, col: p.col }, { row: p.row + 1, col: p.col },
    { row: p.row, col: p.col - 1 }, { row: p.row, col: p.col + 1 },
  ].filter((next) => inside(grid, next) && !grid.blocked[next.row][next.col]);
}

/** Returns { path, objectiveCost } or null when no route exists. */
export function findPath({ grid, start, goal, objective = 'timeSeconds' }) {
  if (!['risk', 'timeSeconds'].includes(objective)) throw new Error(`Unknown objective: ${objective}`);
  for (const [name, point] of [['start', start], ['goal', goal]]) {
    if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.col) || !inside(grid, point)) {
      throw new Error(`${name} must identify a cell inside the grid`);
    }
    if (grid.blocked[point.row][point.col]) throw new Error(`${name} is in a blocked cell`);
  }

  let minCost = Infinity;
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      if (!grid.blocked[r][c]) minCost = Math.min(minCost, cellCost(grid, objective, { row: r, col: c }));
    }
  }

  const distance = new Map([[keyOf(start), 0]]);
  const previous = new Map();
  const open = new MinHeap();
  const heuristic = (p) => (Math.abs(p.row - goal.row) + Math.abs(p.col - goal.col)) * minCost;
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
      const edgeCost = (cellCost(grid, objective, current) + cellCost(grid, objective, next)) / 2;
      const candidate = distance.get(currentKey) + edgeCost;
      if (candidate >= (distance.get(nextKey) ?? Infinity)) continue;
      previous.set(nextKey, current);
      distance.set(nextKey, candidate);
      open.push({ point: next, priority: candidate + heuristic(next) });
    }
  }
  return null;
}
