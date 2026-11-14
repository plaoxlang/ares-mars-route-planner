// Rejilla de Jezero en el contrato del equipo (docs/grid-data-contract.md): una lista plana de celdas
// con límites, riesgo, transitabilidad y elevación, generada desde el DTM CTX de 20 m.
// Es la que puede usar directamente findPath / planRoutes (src/planner) y cualquier herramienta del equipo.
// Salida: data/jezero/grid.json
// Uso: node scripts/jezero/build-grid.mjs [tamaño de celda en píxeles del DTM, por defecto 10 → 200 m]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'data', 'jezero');
const BLOCK = Number(process.argv[2] ?? 10); // px del DTM por lado de celda (10 × 20 m = 200 m)
const MAX_SLOPE = 25; // ° · por encima (en el 90 % de la celda) no es transitable (límite del rover más capaz)
// Riesgo 1–5 por pendiente media de la celda (misma escala que mars_grid.py: 1 = plano … 5 = crítico).
// En mars_grid.py el riesgo sale del rango de alturas de los puntos de la ruta que caen en la celda; con el
// DTM completo se usa la pendiente, que no depende del tamaño de la celda.
const RISK_BY_SLOPE = [[2, 1], [5, 2], [8, 3], [15, 4], [Infinity, 5]];

const meta = JSON.parse(await readFile(join(dataDir, 'dem_ctx_20m.json'), 'utf8'));
const raw = new Int16Array((await readFile(join(dataDir, 'dem_ctx_20m.bin'))).buffer.slice(0));
const { width: W, height: H } = meta;
const hgt = Float32Array.from(raw, (v) => (v === meta.nodata ? NaN : v * meta.scale));
const M_PER_DEG = (3396190 * Math.PI) / 180;
const latC = (meta.north + meta.south) / 2;
const pxX = ((meta.east - meta.west) / W) * M_PER_DEG * Math.cos((latC * Math.PI) / 180);
const pxY = ((meta.north - meta.south) / H) * M_PER_DEG;

// Pendiente por píxel (diferencias centradas), en grados
const at = (x, y) => hgt[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
const slope = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dE = (at(x + 1, y) - at(x - 1, y)) / (2 * pxX);
    const dN = (at(x, y - 1) - at(x, y + 1)) / (2 * pxY);
    slope[y * W + x] = (Math.atan(Math.hypot(dE, dN)) * 180) / Math.PI;
  }
}

const rows = Math.ceil(H / BLOCK);
const cols = Math.ceil(W / BLOCK);
const degX = (meta.east - meta.west) / W;
const degY = (meta.north - meta.south) / H;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const cells = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const x0 = c * BLOCK;
    const y0 = r * BLOCK;
    const x1 = Math.min(W, x0 + BLOCK);
    const y1 = Math.min(H, y0 + BLOCK);
    const elevs = [];
    const slopes = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = hgt[y * W + x];
        if (Number.isFinite(v)) { elevs.push(v); slopes.push(slope[y * W + x]); }
      }
    }
    const n = elevs.length;
    let risk = null;
    let traversable = false;
    let eMean = null; let eMin = null; let eMax = null;
    if (n) {
      slopes.sort((a, b) => a - b);
      const mean = slopes.reduce((s, v) => s + v, 0) / n;
      const p90 = slopes[Math.floor(n * 0.9)];
      risk = RISK_BY_SLOPE.find(([lim]) => mean < lim)[1];
      traversable = p90 <= MAX_SLOPE;
      eMean = round(elevs.reduce((s, v) => s + v, 0) / n, 2);
      eMin = round(Math.min(...elevs), 2);
      eMax = round(Math.max(...elevs), 2);
    }
    // Fila 0 al sur, como en mars_grid.py (las filas crecen hacia el norte)
    const row = rows - 1 - r;
    cells.push({
      cell: row * cols + c,
      row,
      col: c,
      lon_min: round(meta.west + x0 * degX, 6),
      lat_min: round(meta.north - y1 * degY, 6),
      lon_max: round(meta.west + x1 * degX, 6),
      lat_max: round(meta.north - y0 * degY, 6),
      risk,
      points: n,
      traversable,
      elev_mean: eMean,
      elev_min: eMin,
      elev_max: eMax,
    });
  }
}
cells.sort((a, b) => a.cell - b.cell);
await writeFile(join(dataDir, 'grid.json'), `[\n${cells.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
const blocked = cells.filter((c) => !c.traversable).length;
console.log(`grid.json: ${rows} × ${cols} = ${cells.length} celdas de ${BLOCK * 20} m · no transitables ${blocked}`);
