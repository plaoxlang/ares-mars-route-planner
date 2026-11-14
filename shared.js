export const MARS_RADIUS_M = 3396190;
export const MARS_METERS_PER_DEGREE = (MARS_RADIUS_M * Math.PI) / 180;
export const TREK = (layer, ext) =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
export const TREK_ATTR = 'NASA/JPL-Caltech · Mars Trek';
export const $ = (id) => document.getElementById(id);

export async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// A Mars 2000 equirectangular grid (EPSG:104905) uses meters with a spherical Mars radius.
export function marsMetersToLatLng(x, y) {
  const degrees = 180 / (Math.PI * MARS_RADIUS_M);
  return [y * degrees, x * degrees];
}

export function latLngToMarsMeters(lat, lon) {
  const meters = (Math.PI * MARS_RADIUS_M) / 180;
  return { x: lon * meters, y: lat * meters };
}

export function gridBounds(grid) {
  const x0 = grid.transform.originX;
  const y0 = grid.transform.originY;
  const x1 = x0 + grid.cols * grid.transform.pixelWidth;
  const y1 = y0 + grid.rows * grid.transform.pixelHeight;
  const [north, west] = marsMetersToLatLng(Math.min(x0, x1), Math.max(y0, y1));
  const [south, east] = marsMetersToLatLng(Math.max(x0, x1), Math.min(y0, y1));
  return [[south, west], [north, east]];
}

export function cellCenterLatLng(grid, { row, col }) {
  const x = grid.transform.originX + (col + 0.5) * grid.transform.pixelWidth;
  const y = grid.transform.originY + (row + 0.5) * grid.transform.pixelHeight;
  return marsMetersToLatLng(x, y);
}

export function cellAtLatLng(grid, lat, lon) {
  const { x, y } = latLngToMarsMeters(lat, lon);
  const col = Math.floor((x - grid.transform.originX) / grid.transform.pixelWidth);
  const row = Math.floor((y - grid.transform.originY) / grid.transform.pixelHeight);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return null;
  return { row, col };
}
