import { findPath } from './a-star.js';
import { ROVER_SPEED_MPS } from './config.js';

/** Computes route totals using the same edge convention as A*: mean of the two cell values. */
export function summarizePath(grid, path, roverSpeedMps) {
  let totalRisk = 0;
  let totalTimeSeconds = 0;
  if (Array.isArray(grid)) {
    const cellsByPosition = new Map(grid.map((cell) => [`${cell.row},${cell.col}`, cell]));
    let totalDistanceMeters = 0;
    for (let i = 1; i < path.length; i += 1) {
      const a = cellsByPosition.get(`${path[i - 1].row},${path[i - 1].col}`);
      const b = cellsByPosition.get(`${path[i].row},${path[i].col}`);
      const distance = marsDistanceMeters(a, b);
      totalDistanceMeters += distance;
      totalRisk += ((a.risk ?? 0) + (b.risk ?? 0)) / 2 * distance;
    }
    return {
      totalRisk,
      totalDistanceMeters,
      totalTimeSeconds: Number.isFinite(roverSpeedMps) && roverSpeedMps > 0
        ? totalDistanceMeters / roverSpeedMps
        : null,
    };
  }

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const distance = a.row !== b.row && a.col !== b.col ? Math.SQRT2 : 1;
    totalRisk += ((grid.risk[a.row][a.col] + grid.risk[b.row][b.col]) / 2) * distance;
    totalTimeSeconds += ((grid.timeSeconds[a.row][a.col] + grid.timeSeconds[b.row][b.col]) / 2) * distance;
  }
  return { totalRisk, totalTimeSeconds };
}

export function planRoutes({ grid, start, goal, roverSpeedMps = ROVER_SPEED_MPS }) {
  const safest = findPath({ grid, start, goal, objective: 'risk' });
  const canCalculateTime = !Array.isArray(grid) || (Number.isFinite(roverSpeedMps) && roverSpeedMps > 0);
  const fastest = canCalculateTime
    ? findPath({ grid, start, goal, objective: 'timeSeconds', roverSpeedMps })
    : null;
  return {
    safest: safest && { ...safest, ...summarizePath(grid, safest.path, roverSpeedMps), totalRisk: safest.objectiveCost },
    fastest: fastest && { ...fastest, ...summarizePath(grid, fastest.path, roverSpeedMps) },
  };
}

function marsDistanceMeters(a, b) {
  const radiusMeters = 3_389_500;
  const radians = Math.PI / 180;
  const lat1 = (a.lat_min + a.lat_max) / 2 * radians;
  const lat2 = (b.lat_min + b.lat_max) / 2 * radians;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon_min + b.lon_max) - (a.lon_min + a.lon_max)) / 2 * radians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
