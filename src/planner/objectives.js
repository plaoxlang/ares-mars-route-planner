import { findPath } from './a-star.js';

/** Computes route totals using the same edge convention as A*: mean of the two cell values. */
export function summarizePath(grid, path) {
  let totalRisk = 0;
  let totalTimeSeconds = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    totalRisk += (grid.risk[a.row][a.col] + grid.risk[b.row][b.col]) / 2;
    totalTimeSeconds += (grid.timeSeconds[a.row][a.col] + grid.timeSeconds[b.row][b.col]) / 2;
  }
  return { totalRisk, totalTimeSeconds };
}

export function planRoutes({ grid, start, goal }) {
  const safest = findPath({ grid, start, goal, objective: 'risk' });
  const fastest = findPath({ grid, start, goal, objective: 'timeSeconds' });
  return {
    safest: safest && { ...safest, ...summarizePath(grid, safest.path) },
    fastest: fastest && { ...fastest, ...summarizePath(grid, fastest.path) },
  };
}
