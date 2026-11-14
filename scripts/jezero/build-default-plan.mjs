// Ruta por defecto de la app (data/jezero/default-plan.json): la que se ve al abrir el mapa o el 3D sin
// haber trazado ninguna, y la que crea la presentación punto a punto. Se calcula con el mismo planificador
// que el navegador (planner-worker.js + src/planner/a-star.js), así que coincide con lo que verá el usuario.
// Uso: node scripts/jezero/build-default-plan.mjs            → escribe el JSON
//      node scripts/jezero/build-default-plan.mjs --try      → prueba los pares candidatos sin escribir
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'data', 'jezero');
const { VEHICLE, OBJECTIVES, DEFAULT_POINTS } = await import(pathToFileURL(join(root, 'plan-config.js')).href);

const meta = JSON.parse(await readFile(join(dataDir, 'dem_ctx_20m.json'), 'utf8'));
const raw = new Int16Array((await readFile(join(dataDir, 'dem_ctx_20m.bin'))).buffer.slice(0));
const heights = Float32Array.from(raw, (v) => (v === meta.nodata ? NaN : v * meta.scale));
const M = (3396190 * Math.PI) / 180;
const latC = (meta.north + meta.south) / 2;
const pxX = ((meta.east - meta.west) / meta.width) * M * Math.cos((latC * Math.PI) / 180);
const pxY = ((meta.north - meta.south) / meta.height) * M;

const out = [];
globalThis.self = { postMessage: (m) => out.push(m) };
await import(pathToFileURL(join(root, 'planner-worker.js')).href);
await self.onmessage({ data: { type: 'init', heights, width: meta.width, height: meta.height, pxX, pxY } });

// Mismas conversiones que planner.js
const toCell = ({ lat, lon }) => [
  Math.floor(((lon - meta.west) / (meta.east - meta.west)) * meta.width),
  Math.floor(((meta.north - lat) / (meta.north - meta.south)) * meta.height),
];
const toLatLng = (i) => {
  const c = i % meta.width;
  const r = (i - c) / meta.width;
  return [meta.north - ((r + 0.5) * (meta.north - meta.south)) / meta.height, meta.west + ((c + 0.5) * (meta.east - meta.west)) / meta.width];
};

function plan(origin, dest) {
  out.length = 0;
  self.onmessage({ data: { type: 'plan', id: 1, start: toCell(origin), goal: toCell(dest), vehicle: VEHICLE, objectives: OBJECTIVES.map((o) => o.key) } });
  const m = out.find((x) => x.type === 'result' || x.type === 'error');
  if (m.type === 'error') throw new Error(m.message);
  return m;
}
// Alternativas distintas (como uniqueRoutes de planner.js)
function unique(routes) {
  const res = [];
  for (const r of routes) {
    if (r.unreachable) continue;
    const label = OBJECTIVES.find((o) => o.key === r.objective).label;
    const dup = res.find((o) => Math.abs(o.distance_m - r.distance_m) < 1 && o.cells.length === r.cells.length);
    if (dup) { dup.labels.push(label); dup.objectives.push(r.objective); } else res.push({ ...r, labels: [label], objectives: [r.objective] });
  }
  return res;
}

if (process.argv.includes('--try')) {
  const CANDIDATES = JSON.parse(process.argv[process.argv.indexOf('--try') + 1] ?? '[]');
  for (const [a, b] of CANDIDATES) {
    const m = plan(a, b);
    const u = unique(m.routes);
    console.log(JSON.stringify([a, b]), `${m.ms} ms`, u.map((r) => `${r.labels.join('+')}: ${(r.distance_m / 1000).toFixed(2)} km ${r.hours.toFixed(2)} h +${r.ascent_m.toFixed(0)} m máx ${r.max_slope_deg.toFixed(1)}°`).join(' | ') || 'SIN RUTA');
  }
  process.exit(0);
}

const { origin, dest } = DEFAULT_POINTS;
const m = plan(origin, dest);
const r = unique(m.routes)[0];
if (!r) throw new Error('Sin ruta entre los puntos por defecto');
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const latlngs = Array.from(r.cells, (i) => toLatLng(i).map((v) => round(v, 6)));
const result = {
  origin, dest,
  vehicleKey: 'sev',
  vehicle: VEHICLE,
  vehicleName: `${VEHICLE.name} (${VEHICLE.sub})`,
  objective: r.objectives[0],
  labels: r.labels,
  stats: {
    distance_m: r.distance_m, hours: r.hours, energy_wh: r.energy_wh, ascent_m: r.ascent_m,
    descent_m: r.descent_m, max_slope_deg: r.max_slope_deg, steep_m: r.steep_m,
  },
  latlngs,
  dist: Array.from(r.track.dist, (v) => round(v, 1)),
  hours: Array.from(r.track.hours, (v) => round(v, 5)),
  elev: Array.from(r.track.elev, (v) => round(v, 1)),
  slope: Array.from(r.track.slope, (v) => round(v, 2)),
  default: true,
};
await writeFile(join(dataDir, 'default-plan.json'), JSON.stringify(result));
console.log(`default-plan.json: ${r.labels.join(' · ')} · ${(r.distance_m / 1000).toFixed(2)} km · ${r.hours.toFixed(2)} h · ${latlngs.length} vértices · ${m.ms} ms`);
