// Ruta de Perseverance (Mars 2020) en Jezero: paradas del visor MMGIS de NASA y perfil de elevación.
// Uso: node scripts/jezero/fetch-route.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'jezero');
const SOURCE = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const geo = await res.json();
if (geo.type !== 'FeatureCollection') throw new Error('No es un FeatureCollection');

// El acumulado de NASA (dist_total_m) vuelve a 0 en muchas paradas: se recalcula sumando dist_m,
// que reproduce exactamente su total final.
let running = 0;
const points = geo.features.map((f, i) => {
  const p = f.properties;
  running += i === 0 ? 0 : Math.max(0, p.dist_m ?? 0);
  return {
    i,
    sol: p.sol,
    site: p.site,
    drive: p.drive,
    lon: p.lon,
    lat: p.lat,
    elev_m: p.elev_geoid,
    dist_total_m: round(running),
    dist_total_nasa_m: p.dist_total_m,
    dist_from_prev_m: p.dist_m,
    tilt_deg: p.tilt,
    pitch_deg: p.pitch,
    roll_deg: p.roll,
    yaw_deg: p.yaw,
    note: p.Note ?? null,
  };
});

const elevs = points.map((p) => p.elev_m);
let gain = 0;
let loss = 0;
for (let i = 1; i < elevs.length; i++) {
  const d = elevs[i] - elevs[i - 1];
  if (d > 0) gain += d;
  else loss -= d;
}
const summary = {
  points: points.length,
  distance_m: round(running),
  elev_start_m: round(elevs[0]),
  elev_end_m: round(elevs.at(-1)),
  elev_min_m: round(Math.min(...elevs)),
  elev_max_m: round(Math.max(...elevs)),
  cumulative_gain_m: round(gain),
  cumulative_loss_m: round(loss),
  sol_range: [points[0].sol, points.at(-1).sol],
};
const meta = {
  mission: 'Mars 2020 Perseverance',
  site: 'Cráter Jezero',
  source: SOURCE,
  elevation_reference: 'elev_m: metros respecto al areoide de Marte (elev_geoid de NASA)',
  fields: {
    tilt_deg: 'Inclinación total del rover al final de la conducción (aproximación a la pendiente)',
    dist_total_m: 'Distancia acumulada desde el aterrizaje (suma de dist_from_prev_m)',
    dist_total_nasa_m: 'Acumulado original de NASA; se reinicia a 0 en muchas paradas, no usar para gráficas',
  },
  generatedAt: new Date().toISOString(),
  summary,
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'm20_waypoints.json'), JSON.stringify(geo));
await writeFile(join(outDir, 'elevation_waypoints.json'), JSON.stringify({ meta, points }, null, 1));
const cols = Object.keys(points[0]);
const csv = [cols.join(','), ...points.map((r) => cols.map((c) => (typeof r[c] === 'string' ? `"${r[c].replace(/"/g, '""')}"` : r[c] ?? '')).join(','))];
await writeFile(join(outDir, 'elevation_waypoints.csv'), `${csv.join('\n')}\n`);
console.log('elevation_waypoints:', summary);
