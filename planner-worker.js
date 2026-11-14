// Planificador de rutas sobre el DTM (celdas de 20 m), en un Web Worker de módulo.
// Recibe el relieve una vez ('init') y responde consultas ('plan') con varias alternativas.
// La búsqueda la hace el A* común del proyecto (src/planner/a-star.js, del equipo): aquí solo se
// definen el modelo del vehículo, el coste de cada tramo (con sentido: subir no cuesta lo mismo que
// bajar) y qué celdas son transitables.
import { findPath } from './src/planner/a-star.js';

const G_MARS = 3.721; // m/s²
const SAFE_SLOPE = 8; // por encima de esta pendiente (°) la ruta "segura" penaliza fuerte
const TURN_PENALTY = 0.35; // coste relativo al tramo por cambio de rumbo (0 = sin preferencia)
let T = null; // terreno: { h, w, hgt, pxX, pxY, slope, rough }

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    T = prepareTerrain(msg);
    self.postMessage({ type: 'ready' });
  } else if (msg.type === 'plan') {
    const t0 = performance.now();
    try {
      // Si A o B no se pueden alcanzar (ladera por encima del límite o zona aislada por pendientes),
      // se mueven al punto alcanzable más cercano: siempre hay ruta y se avisa de cuánto se ha movido.
      const snap = resolveEndpoints(msg.start, msg.goal, msg.vehicle.maxSlope);
      const routes = msg.objectives.map((obj) => plan(snap.start, snap.goal, msg.vehicle, obj)).filter(Boolean);
      self.postMessage({ type: 'result', id: msg.id, routes, snap, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err.message ?? err) });
    }
  }
};

// ---------- Terreno: pendiente y rugosidad por celda ----------
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0; let c = 0;
    for (let k = 0; k <= Math.min(w - 1, r); k++) { s += src[row + k]; c++; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / c;
      if (x + r + 1 < w) { s += src[row + x + r + 1]; c++; }
      if (x - r >= 0) { s -= src[row + x - r]; c--; }
    }
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let s = 0; let c = 0;
    for (let k = 0; k <= Math.min(h - 1, r); k++) { s += tmp[k * w + x]; c++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / c;
      if (y + r + 1 < h) { s += tmp[(y + r + 1) * w + x]; c++; }
      if (y - r >= 0) { s -= tmp[(y - r) * w + x]; c--; }
    }
  }
  return out;
}

function prepareTerrain({ heights, width: w, height: hgt, pxX, pxY }) {
  const smooth = boxBlur(heights, w, hgt, 1); // ≈60 m, igual que la capa de pendiente
  const broad = boxBlur(heights, w, hgt, 3);
  const slope = new Float32Array(w * hgt);
  const rough = new Float32Array(w * hgt);
  const at = (a, x, y) => a[Math.min(hgt - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dE = (at(smooth, x + 1, y) - at(smooth, x - 1, y)) / (2 * pxX);
      const dN = (at(smooth, x, y - 1) - at(smooth, x, y + 1)) / (2 * pxY);
      slope[i] = (Math.atan(Math.hypot(dE, dN)) * 180) / Math.PI;
      // Rugosidad: cuánto se separa el terreno de su tendencia a ~140 m (resaltes, escalones, cráteres pequeños)
      rough[i] = Math.abs(heights[i] - broad[i]);
    }
  }
  return { h: heights, w, hgt, pxX, pxY, slope, rough };
}

// ---------- Modelo del vehículo ----------
// grade: desnivel/distancia del tramo (positivo = subida). Devuelve km/h.
function speedKmh(v, grade, rough) {
  let s;
  if (v.model === 'tobler') {
    // Función de Tobler normalizada para que en llano dé vFlat; máximo un poco cuesta abajo.
    s = v.vFlat * Math.exp(-3.5 * (Math.abs(grade + 0.05) - 0.05));
  } else {
    const deg = (Math.atan(Math.abs(grade)) * 180) / Math.PI;
    s = v.vFlat * Math.max(0.2, 1 - (0.7 * deg) / v.maxSlope);
  }
  return s / (1 + rough / v.roughRef);
}

// Energía mecánica del tramo (Wh): rodadura/marcha + subir el desnivel, con un rendimiento global.
function energyWh(v, d, dh) {
  return (v.crr * v.mass * G_MARS * d + v.mass * G_MARS * Math.max(0, dh)) / v.eff / 3600;
}

// ---------- Búsqueda (A* común) ----------
// Celdas no transitables para un vehículo: pendiente (escala ~60 m) por encima de su máximo.
// Se calculan una vez por pendiente máxima y se reutilizan entre consultas y objetivos.
const blockedCache = new Map();
function blockedFor(maxSlope) {
  let m = blockedCache.get(maxSlope);
  if (!m) {
    const { slope } = T;
    m = new Uint8Array(slope.length);
    for (let i = 0; i < slope.length; i++) m[i] = slope[i] > maxSlope ? 1 : 0;
    if (blockedCache.size > 8) blockedCache.clear();
    blockedCache.set(maxSlope, m);
  }
  return m;
}

// ---------- Zonas conectadas ----------
// Para una pendiente máxima, cada celda transitable recibe el número de su zona conectada (8 vecinos,
// igual que el A* con cornerCutting) y se cuenta el tamaño de cada zona. Así se sabe al instante si
// B es alcanzable desde A sin lanzar una búsqueda que recorrería todo el mapa para nada.
const compCache = new Map();
function componentsFor(maxSlope) {
  let c = compCache.get(maxSlope);
  if (c) return c;
  const { w, hgt } = T;
  const blocked = blockedFor(maxSlope);
  const n = w * hgt;
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const queue = new Int32Array(n);
  for (let i0 = 0; i0 < n; i0++) {
    if (blocked[i0] || comp[i0] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = i0;
    comp[i0] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= hgt) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((!dx && !dy) || xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (blocked[j] || comp[j] >= 0) continue;
          comp[j] = id;
          queue[tail++] = j;
        }
      }
    }
    sizes.push(tail);
  }
  c = { comp, sizes };
  if (compCache.size > 4) compCache.clear();
  compCache.set(maxSlope, c);
  return c;
}

const BIG_ZONE = 2500; // celdas (~1 km²): por debajo, la zona es un "islote" entre laderas
function resolveEndpoints(start, goal, maxSlope) {
  const { w, hgt, pxX, pxY } = T;
  const { comp, sizes } = componentsFor(maxSlope);
  const idx = ([x, y]) => y * w + x;
  // Zona de una celda: la suya o, si es una celda empinada, la de un vecino (se puede salir de ella)
  const zonesOf = (i) => {
    if (comp[i] >= 0) return [comp[i]];
    const x = i % w;
    const y = (i - x) / w;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < hgt && comp[yy * w + xx] >= 0) out.push(comp[yy * w + xx]);
      }
    }
    return out;
  };
  // Celda más cercana (en metros) que cumpla ok(zona); primero en ~3 km alrededor y, si no, en todo el mapa
  const nearest = (p, ok) => {
    const scan = (x0, y0, x1, y1) => {
      let best = -1;
      let bestD = Infinity;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const z = comp[y * w + x];
          if (z < 0 || !ok(z)) continue;
          const d = Math.hypot((x - p[0]) * pxX, (y - p[1]) * pxY);
          if (d < bestD) { bestD = d; best = y * w + x; }
        }
      }
      return best;
    };
    const R = 150;
    let i = scan(Math.max(0, p[0] - R), Math.max(0, p[1] - R), Math.min(w - 1, p[0] + R), Math.min(hgt - 1, p[1] + R));
    if (i < 0) i = scan(0, 0, w - 1, hgt - 1);
    return i < 0 ? null : [i % w, Math.floor(i / w)];
  };
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * pxX, (a[1] - b[1]) * pxY);

  let s = start;
  let zone = zonesOf(idx(start)).find((z) => sizes[z] >= BIG_ZONE);
  if (zone === undefined) {
    // A está en una ladera o en un islote: se lleva a la zona grande más cercana
    s = nearest(start, (z) => sizes[z] >= BIG_ZONE) ?? start;
    zone = comp[idx(s)];
  }
  let g = goal;
  if (!zonesOf(idx(goal)).includes(zone)) g = nearest(goal, (z) => z === zone) ?? goal;
  return {
    start: s,
    goal: g,
    startMoved_m: s === start ? 0 : dist(s, start),
    goalMoved_m: g === goal ? 0 : dist(g, goal),
  };
}

// Factores por celda que solo dependen del vehículo (se calculan una vez y se reutilizan):
//  rf = 1 + rugosidad / referencia (la velocidad se divide por él); safe = penalización de la ruta segura.
const cellCache = new Map();
function cellFactors(v) {
  const key = `${v.maxSlope}|${v.roughRef}`;
  let c = cellCache.get(key);
  if (!c) {
    const { slope, rough } = T;
    const n = slope.length;
    const rf = new Float32Array(n);
    const safe = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const rr = rough[i] / v.roughRef;
      rf[i] = 1 + rr;
      const sr = slope[i] / v.maxSlope;
      const over = Math.max(0, (slope[i] - SAFE_SLOPE) / Math.max(1, v.maxSlope - SAFE_SLOPE));
      // 'safe': evita sobre todo pendientes > 8° (penalización fuerte y creciente hasta el límite),
      // y en menor medida cualquier pendiente y la rugosidad.
      safe[i] = 1 + 2 * sr * sr + 40 * over * over + 2 * rr;
    }
    if (cellCache.size > 4) cellCache.clear();
    c = { rf, safe };
    cellCache.set(key, c);
  }
  return c;
}

// Inversa de la velocidad según la pendiente del tramo (h/m sin rugosidad), tabulada cada 1/1024 de
// pendiente entre −150 % y +150 %: evita exp/atan en cada uno de los millones de tramos que se evalúan.
const GRADE_MAX = 1.5;
const GRADE_STEP = 1024;
function invSpeedTable(v) {
  const n = 2 * GRADE_MAX * GRADE_STEP + 1;
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = 1 / (1000 * speedKmh(v, k / GRADE_STEP - GRADE_MAX, 0));
  return t;
}

function plan(start, goal, v, objective) {
  const { w, hgt, h, pxX, pxY, slope, rough } = T;
  const s = start[1] * w + start[0];
  const g = goal[1] * w + goal[0];
  // Velocidad máxima posible del vehículo (cota de la heurística): Tobler alcanza su máximo un poco
  // cuesta abajo (×e^0,175 ≈ 1,19); el modelo de rover, en llano y sin rugosidad.
  const vMax = v.model === 'tobler' ? v.vFlat * Math.exp(0.175) : v.vFlat;
  const minWhPerM = (v.crr * v.mass * G_MARS) / v.eff / 3600;
  const gx = goal[0];
  const gy = goal[1];
  const hScale = objective === 'energy' ? minWhPerM : 1 / (1000 * vMax);
  const heuristic = (i) => {
    const r = (i / w) | 0;
    const dx = (i - r * w - gx) * pxX;
    const dy = (r - gy) * pxY;
    return Math.sqrt(dx * dx + dy * dy) * hScale;
  };
  const { rf, safe } = cellFactors(v);
  const inv = invSpeedTable(v);
  const kMax = inv.length - 1;
  const mg = v.mass * G_MARS;
  const eDist = (v.crr * mg) / v.eff / 3600;
  const eUp = mg / v.eff / 3600;
  const roughE = 1 / (4 * v.roughRef);
  const hoursOf = (a, b, d) => {
    const dh = h[b] - h[a];
    let k = ((dh / d + GRADE_MAX) * GRADE_STEP + 0.5) | 0;
    if (k < 0) k = 0; else if (k > kMax) k = kMax;
    return Math.sqrt(d * d + dh * dh) * inv[k] * rf[b];
  };
  const edgeCost = objective === 'fast' ? hoursOf
    : objective === 'safe' ? (a, b, d) => hoursOf(a, b, d) * safe[b]
      : (a, b, d) => {
        const dh = h[b] - h[a];
        return (eDist * d + (dh > 0 ? eUp * dh : 0)) * (1 + rough[b] * roughE);
      };

  // El origen y el destino siempre se pueden pisar (aunque estén en una celda empinada)
  const blocked = blockedFor(v.maxSlope);
  const keep = [blocked[s], blocked[g]];
  blocked[s] = 0;
  blocked[g] = 0;
  let res;
  try {
    res = findPath({
      grid: { rows: hgt, cols: w, blocked, cellWidth: pxX, cellHeight: pxY },
      start: { row: start[1], col: start[0] },
      goal: { row: goal[1], col: goal[0] },
      edgeCost,
      heuristic,
      // 1 - cos(ángulo) apenas penaliza curvas amplias, pero sí evita cambios bruscos y zigzags.
      // La penalización usa las mismas unidades que el objetivo (s, o Wh) y nunca altera la seguridad.
      turnPenalty: (baseCost, bend) => baseCost * TURN_PENALTY * bend,
      cornerCutting: true, // celdas bloqueadas = umbral de una pendiente suavizada, no obstáculos puntuales
    });
  } finally {
    blocked[s] = keep[0];
    blocked[g] = keep[1];
  }
  if (!res) return { objective, unreachable: true };
  return { objective, expanded: res.expanded, ...pathStats(res.indices, v) };
}

// ---------- Estadísticas de una ruta ----------
function pathStats(cells, v) {
  const { w, h, pxX, pxY, slope, rough } = T;
  let dist = 0; let hours = 0; let wh = 0; let up = 0; let down = 0;
  let maxSlope = 0; let steepM = 0; let roughM = 0;
  const profile = [];
  // Valores por vértice para reproducir la ruta: distancia y tiempo acumulados, altura y pendiente.
  const n = cells.length;
  const cumD = new Float32Array(n);
  const cumH = new Float32Array(n);
  const elev = new Float32Array(n);
  const slopeAt = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const b = cells[k];
    if (k > 0) {
      const a = cells[k - 1];
      const ox = (b % w) - (a % w);
      const oy = Math.floor(b / w) - Math.floor(a / w);
      const d = Math.hypot(ox * pxX, oy * pxY);
      const dh = h[b] - h[a];
      dist += Math.hypot(d, dh);
      hours += (Math.hypot(d, dh) / 1000) / speedKmh(v, dh / d, rough[b]);
      wh += energyWh(v, d, dh);
      if (dh > 0) up += dh; else down -= dh;
      if (slope[b] > 8) steepM += d;
      if (rough[b] > v.roughRef) roughM += d;
    }
    maxSlope = Math.max(maxSlope, slope[b]);
    profile.push([dist, h[b]]);
    cumD[k] = dist;
    cumH[k] = hours;
    elev[k] = h[b];
    slopeAt[k] = slope[b];
  }
  return {
    cells: Int32Array.from(cells),
    distance_m: dist,
    hours,
    energy_wh: wh,
    ascent_m: up,
    descent_m: down,
    max_slope_deg: maxSlope,
    steep_m: steepM, // tramo con pendiente > 8°
    rough_m: roughM,
    profile: thin(profile, 80),
    track: { dist: cumD, hours: cumH, elev, slope: slopeAt },
  };
}

function thin(arr, n) {
  if (arr.length <= n) return arr;
  return Array.from({ length: n }, (_, k) => arr[Math.round((k * (arr.length - 1)) / (n - 1))]);
}
