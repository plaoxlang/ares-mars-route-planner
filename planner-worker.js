// Planificador de rutas: A* sobre el DTM (celdas de 20 m, 8 vecinos), en un Web Worker.
// Recibe el relieve una vez ('init') y responde consultas ('plan') con varias alternativas.

const G_MARS = 3.721; // m/s²
const SAFE_SLOPE = 8; // por encima de esta pendiente (°) la ruta "segura" penaliza fuerte
let T = null; // terreno: { h, w, hgt, pxX, pxY, slope, rough }

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    T = prepareTerrain(msg);
    self.postMessage({ type: 'ready' });
  } else if (msg.type === 'plan') {
    const t0 = performance.now();
    try {
      const routes = msg.objectives.map((obj) => plan(msg.start, msg.goal, msg.vehicle, obj)).filter(Boolean);
      self.postMessage({ type: 'result', id: msg.id, routes, ms: Math.round(performance.now() - t0) });
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

// ---------- A* ----------
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function plan(start, goal, v, objective) {
  const { w, hgt, h, pxX, pxY, slope, rough } = T;
  const N = w * hgt;
  const s = start[1] * w + start[0];
  const g = goal[1] * w + goal[0];
  const vMax = v.vFlat * 1.2; // km/h, cota superior para la heurística
  const minWhPerM = (v.crr * v.mass * G_MARS) / v.eff / 3600;
  const gx = goal[0];
  const gy = goal[1];

  const heur = (i) => {
    const dx = ((i % w) - gx) * pxX;
    const dy = (Math.floor(i / w) - gy) * pxY;
    const d = Math.hypot(dx, dy);
    return objective === 'energy' ? d * minWhPerM : (d / 1000) / vMax;
  };

  const edgeCost = (a, b, d) => {
    if (b !== g && slope[b] > v.maxSlope) return Infinity; // celda no transitable
    const dh = h[b] - h[a];
    const grade = dh / d;
    const r = rough[b];
    const hours = (Math.hypot(d, dh) / 1000) / speedKmh(v, grade, r);
    if (objective === 'fast') return hours;
    if (objective === 'energy') return energyWh(v, d, dh) * (1 + r / (4 * v.roughRef));
    // 'safe': evita sobre todo pendientes > 8° (penalización fuerte y creciente hasta el límite),
    // y en menor medida cualquier pendiente y la rugosidad.
    const sr = slope[b] / v.maxSlope;
    const over = Math.max(0, (slope[b] - SAFE_SLOPE) / Math.max(1, v.maxSlope - SAFE_SLOPE));
    return hours * (1 + 2 * sr * sr + 40 * over * over + 2 * (r / v.roughRef));
  };

  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap(N);
  gScore[s] = 0;
  heap.push(s, heur(s));
  let expanded = 0;

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === g) break;
    closed[cur] = 1;
    expanded++;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [ox, oy] of NB) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= hgt) continue;
      const nb = ny * w + nx;
      if (closed[nb]) continue;
      const d = Math.hypot(ox * pxX, oy * pxY);
      const c = edgeCost(cur, nb, d);
      if (c === Infinity) continue;
      const tentative = gScore[cur] + c;
      if (tentative < gScore[nb]) {
        gScore[nb] = tentative;
        came[nb] = cur;
        heap.push(nb, tentative + heur(nb));
      }
    }
  }
  if (came[g] === -1 && s !== g) return { objective, unreachable: true, expanded };

  const cells = [];
  for (let c = g; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  return { objective, expanded, ...pathStats(cells, v) };
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
  for (let k = 0; k < cells.length; k++) {
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

// Montículo binario de mínimos con prioridades Float64 (admite duplicados; se ignoran al sacarlos).
class MinHeap {
  constructor(cap) {
    this.ids = new Int32Array(cap * 2);
    this.pri = new Float64Array(cap * 2);
    this.size = 0;
  }
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
