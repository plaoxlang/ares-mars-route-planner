/**
 * A* común del proyecto (mapa, vista 3D, worker del planificador y scripts).
 *
 * Mantiene el contrato y el comportamiento del A* del equipo (rama planner/a-star):
 *  · entrada en formato matriz ({ rows, cols, risk, timeSeconds, blocked }) o lista plana de celdas
 *    ({ row, col, traversable, risk, lon/lat bounds }), también envuelta en { meta, grid } tal como la
 *    genera src/data/mars_grid.py;
 *  · objetivos 'risk' y 'timeSeconds'; coste de un tramo = media de las dos celdas × distancia
 *    (en la lista de celdas, el tiempo es distancia / velocidad);
 *  · 8 direcciones sin cortar esquinas entre celdas bloqueadas; heurística admisible;
 *  · devuelve { path: [{ row, col }], objectiveCost } o null si no hay ruta.
 *
 * Añade, para la rejilla densa del DTM de Jezero (~460 000 celdas de 20 m):
 *  · arrays tipados e índices enteros (sin Map ni claves de texto) y memoria reutilizada entre búsquedas;
 *  · costes por tramo con sentido (edgeCost): subir no cuesta lo mismo que bajar;
 *  · heurística a medida (heuristic) y celdas de tamaño físico (cellWidth/cellHeight en metros).
 */

// ---------- Montículo binario de mínimos (índices Int32 + prioridades Float64) ----------
class MinHeap {
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.pri = new Float64Array(capacity);
    this.size = 0;
  }
  clear() { this.size = 0; }
  push(id, p) {
    if (this.size >= this.ids.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= p) break;
      this.ids[i] = this.ids[parent];
      this.pri[i] = this.pri[parent];
      i = parent;
    }
    this.ids[i] = id;
    this.pri[i] = p;
  }
  pop() {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastP = this.pri[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pri[c + 1] < this.pri[c]) c++;
      if (this.pri[c] >= lastP) break;
      this.ids[i] = this.ids[c];
      this.pri[i] = this.pri[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.pri[i] = lastP;
    return top;
  }
  grow() {
    const ids = new Int32Array(this.ids.length * 2);
    const pri = new Float64Array(this.pri.length * 2);
    ids.set(this.ids);
    pri.set(this.pri);
    this.ids = ids;
    this.pri = pri;
  }
}

// ---------- Memoria de búsqueda reutilizable ----------
// En vez de rellenar gScore con Infinity en cada búsqueda, cada celda guarda la "generación" en la que
// se tocó por última vez: si no coincide con la actual, vale como no visitada.
class SearchBuffers {
  constructor(n) {
    this.n = n;
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.gen = 0;
    this.heap = new MinHeap(Math.min(1 << 16, n * 2));
  }
  next() {
    this.gen++;
    if (this.gen === 0xffffffff) { this.stamp.fill(0); this.closedStamp.fill(0); this.gen = 1; }
    this.heap.clear();
  }
}
const bufferCache = new Map();
function buffersFor(n) {
  let b = bufferCache.get(n);
  if (!b) {
    b = new SearchBuffers(n);
    bufferCache.clear(); // solo se guarda la del último tamaño de rejilla
    bufferCache.set(n, b);
  }
  return b;
}

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

/**
 * Núcleo de A* sobre índices (i = row * cols + col).
 * blocked: Uint8Array (1 = no transitable). dist(i, j, dr, dc) → metros (o unidades) del tramo.
 * edgeCost(i, j, d) → coste (Infinity = prohibido). heuristic(i) → cota inferior del coste a la meta.
 */
export function searchIndices({ rows, cols, blocked, start, goal, dist, edgeCost, heuristic, cornerCutting = false }) {
  const n = rows * cols;
  const buf = buffersFor(n);
  buf.next();
  const { g, came, stamp, closedStamp, heap } = buf;
  const gen = buf.gen;
  g[start] = 0;
  came[start] = -1;
  stamp[start] = gen;
  heap.push(start, heuristic(start));
  let expanded = 0;

  while (heap.size) {
    const cur = heap.pop();
    if (closedStamp[cur] === gen) continue;
    if (cur === goal) break;
    closedStamp[cur] = gen;
    expanded++;
    const cr = (cur / cols) | 0;
    const cc = cur - cr * cols;
    const gc = g[cur];
    for (let k = 0; k < 8; k++) {
      const dr = DR[k];
      const dc = DC[k];
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const nb = nr * cols + nc;
      if (blocked[nb] || closedStamp[nb] === gen) continue;
      // Sin cortar esquinas entre dos celdas bloqueadas (o fuera de datos), salvo que se permita
      if (!cornerCutting && dr !== 0 && dc !== 0 && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue;
      const c = edgeCost(cur, nb, dist(cur, nb, dr, dc));
      if (!(c < Infinity)) continue;
      const tentative = gc + c;
      if (stamp[nb] !== gen || tentative < g[nb]) {
        g[nb] = tentative;
        came[nb] = cur;
        stamp[nb] = gen;
        heap.push(nb, tentative + heuristic(nb));
      }
    }
  }
  if (stamp[goal] !== gen) return { indices: null, cost: Infinity, expanded };
  let len = 0;
  for (let c = goal; c !== -1; c = came[c]) len++;
  const indices = new Int32Array(len);
  for (let c = goal, k = len - 1; c !== -1; c = came[c], k--) indices[k] = c;
  return { indices, cost: g[goal], expanded };
}

// ---------- Rejillas del contrato del equipo → forma interna ----------
const internals = new WeakMap(); // la conversión se hace una vez por objeto de rejilla

/** Acepta la lista plana, { meta, grid: [...] } (salida de mars_grid.py) o el formato matriz. */
export function normalizeGrid(source, unknownRiskPenalty = 0) {
  if (source && !Array.isArray(source) && Array.isArray(source.grid)) source = source.grid;
  if (internals.has(source) && internals.get(source).penalty === unknownRiskPenalty) return internals.get(source);
  const g = Array.isArray(source) ? fromCellList(source, unknownRiskPenalty) : fromMatrix(source);
  g.penalty = unknownRiskPenalty;
  if (source && typeof source === 'object') internals.set(source, g);
  return g;
}

function fromMatrix(grid) {
  if (!grid || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols) || !Array.isArray(grid.blocked)) {
    throw new Error('Grid does not provide rows, cols and a blocked matrix');
  }
  const { rows, cols } = grid;
  const blocked = new Uint8Array(rows * cols);
  const fields = {};
  for (const name of ['risk', 'timeSeconds']) {
    if (!Array.isArray(grid[name])) continue;
    const f = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) f[r * cols + c] = grid[name][r][c] ?? 0;
    fields[name] = f;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) blocked[r * cols + c] = grid.blocked[r][c] ? 1 : 0;
  return { kind: 'matrix', rows, cols, blocked, fields, lat: null, lon: null };
}

function fromCellList(cells, unknownRiskPenalty) {
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
    rows = Math.max(rows, cell.row + 1);
    cols = Math.max(cols, cell.col + 1);
  }
  const n = rows * cols;
  const blocked = new Uint8Array(n).fill(1); // las posiciones que falten cuentan como bloqueadas
  const risk = new Float64Array(n);
  const lat = new Float64Array(n).fill(NaN);
  const lon = new Float64Array(n).fill(NaN);
  const seen = new Uint8Array(n);
  for (const cell of cells) {
    const i = cell.row * cols + cell.col;
    if (seen[i]) throw new Error(`Duplicate grid position (${cell.row},${cell.col})`);
    seen[i] = 1;
    // La salida de mars_grid.py no trae "traversable": su riesgo 0 significa "sin datos" → no transitable
    const traversable = typeof cell.traversable === 'boolean' ? cell.traversable : (cell.risk ?? 0) > 0;
    if (!traversable) continue;
    if (cell.risk !== null && cell.risk !== undefined && (!Number.isFinite(cell.risk) || cell.risk < 0)) {
      throw new Error(`Risk at (${cell.row},${cell.col}) must be a non-negative number or null`);
    }
    blocked[i] = 0;
    risk[i] = cell.risk == null ? unknownRiskPenalty : cell.risk;
    if (['lon_min', 'lon_max', 'lat_min', 'lat_max'].every((k) => Number.isFinite(cell[k]))) {
      lat[i] = (cell.lat_min + cell.lat_max) / 2;
      lon[i] = (cell.lon_min + cell.lon_max) / 2;
    }
  }
  return { kind: 'cells', rows, cols, blocked, fields: { risk }, lat, lon };
}

const MARS_RADIUS_M = 3_389_500;
const RAD = Math.PI / 180;
function haversine(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distancia entre dos celdas de una rejilla interna: geográfica si hay centros, si no 1 / √2. */
export function cellDistance(g, a, b) {
  if (g.lat && Number.isFinite(g.lat[a]) && Number.isFinite(g.lat[b])) return haversine(g.lat[a], g.lon[a], g.lat[b], g.lon[b]);
  const ar = (a / g.cols) | 0;
  const br = (b / g.cols) | 0;
  return Math.hypot(b - br * g.cols - (a - ar * g.cols), br - ar);
}

const sameCell = (a, b) => a.row === b.row && a.col === b.col;

/**
 * Returns { path, objectiveCost } or null when no route exists (API del equipo), más:
 *  indices (Int32Array) y expanded (celdas expandidas).
 *
 * Opciones añadidas para rejillas densas propias:
 *  grid: { rows, cols, blocked: Uint8Array, cellWidth, cellHeight } con edgeCost(i, j, d) y heuristic(i).
 *  cornerCutting: permite pasar en diagonal entre dos celdas bloqueadas (por defecto no, como en el
 *  contrato del equipo). En el DTM las celdas "bloqueadas" salen de umbralizar una pendiente suavizada,
 *  no son obstáculos puntuales, y ahí el planificador lo permite.
 */
export function findPath({
  grid: sourceGrid, start, goal, objective, roverSpeedMps, unknownRiskPenalty = 0, edgeCost, heuristic, cornerCutting = false,
}) {
  // --- Rejilla densa con costes propios (worker del planificador) ---
  if (typeof edgeCost === 'function') {
    const { rows, cols, blocked, cellWidth = 1, cellHeight = 1 } = sourceGrid;
    const diag = Math.hypot(cellWidth, cellHeight);
    const dist = (i, j, dr, dc) => (dr === 0 ? cellWidth : dc === 0 ? cellHeight : diag);
    for (const [name, p] of [['start', start], ['goal', goal]]) {
      if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col) || p.row < 0 || p.col < 0 || p.row >= rows || p.col >= cols) {
        throw new Error(`${name} must identify a cell inside the grid`);
      }
    }
    const s = start.row * cols + start.col;
    const t = goal.row * cols + goal.col;
    if (s === t) return { path: [start], objectiveCost: 0, indices: Int32Array.of(s), expanded: 0 };
    const res = searchIndices({ rows, cols, blocked, start: s, goal: t, dist, edgeCost, heuristic: heuristic ?? (() => 0), cornerCutting });
    if (!res.indices) return null;
    return { path: toPoints(res.indices, cols), objectiveCost: res.cost, indices: res.indices, expanded: res.expanded };
  }

  // --- Contrato del equipo: matriz o lista de celdas ---
  const isCellList = Array.isArray(sourceGrid) || Array.isArray(sourceGrid?.grid);
  objective ??= isCellList ? 'risk' : 'timeSeconds';
  if (!['risk', 'timeSeconds'].includes(objective)) throw new Error(`Unknown objective: ${objective}`);
  if (isCellList && objective === 'timeSeconds' && (!Number.isFinite(roverSpeedMps) || roverSpeedMps <= 0)) {
    throw new Error('roverSpeedMps must be a positive finite number to calculate travel time');
  }
  const g = normalizeGrid(sourceGrid, unknownRiskPenalty);
  const field = g.fields[objective];
  if (!(isCellList && objective === 'timeSeconds') && !field) throw new Error(`Grid does not provide a valid ${objective} cost matrix`);

  const { rows, cols, blocked } = g;
  for (const [name, p] of [['start', start], ['goal', goal]]) {
    if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col) || p.row < 0 || p.col < 0 || p.row >= rows || p.col >= cols) {
      throw new Error(`${name} must identify a cell inside the grid`);
    }
    if (blocked[p.row * cols + p.col]) throw new Error(`${name} is in a blocked cell`);
  }
  if (sameCell(start, goal)) return { path: [start], objectiveCost: 0 };

  const timeByDistance = isCellList && objective === 'timeSeconds';
  let minCost = Infinity;
  if (!timeByDistance) for (let i = 0; i < rows * cols; i++) if (!blocked[i] && field[i] < minCost) minCost = field[i];
  const s = start.row * cols + start.col;
  const t = goal.row * cols + goal.col;
  const dist = isCellList ? (i, j) => cellDistance(g, i, j) : (i, j, dr, dc) => (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
  const edge = timeByDistance
    ? (i, j, d) => d / roverSpeedMps
    : (i, j, d) => ((field[i] + field[j]) / 2) * d;
  const gr = goal.row;
  const gc = goal.col;
  const h = isCellList
    ? (i) => { const d = cellDistance(g, i, t); return timeByDistance ? d / roverSpeedMps : d * minCost; }
    : (i) => {
      const r = (i / cols) | 0;
      const dx = Math.abs(i - r * cols - gc);
      const dy = Math.abs(r - gr);
      // Octile distance is admissible for 8-direction movement.
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * minCost;
    };
  const res = searchIndices({ rows, cols, blocked, start: s, goal: t, dist, edgeCost: edge, heuristic: h, cornerCutting });
  if (!res.indices) return null;
  return { path: toPoints(res.indices, cols), objectiveCost: res.cost, indices: res.indices, expanded: res.expanded };
}

function toPoints(indices, cols) {
  const out = new Array(indices.length);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const row = (i / cols) | 0;
    out[k] = { row, col: i - row * cols };
  }
  return out;
}
