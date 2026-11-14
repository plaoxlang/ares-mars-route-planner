// Exporta los datos de elevación de la ruta de Curiosity a data/export/.
// Requiere haber ejecutado antes scripts/fetch-data.mjs.
// Uso: node scripts/gale/export-elevation.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'data', 'gale');
const outDir = join(dataDir, 'export');

// Radio de Marte del sistema IAU 2000:49900 / EPSG:104905 que usa Mars Trek.
const MARS_RADIUS_M = 3396190;

const readJson = async (file) => JSON.parse(await readFile(join(dataDir, file), 'utf8'));
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function haversineMars([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(a));
}

function summarize(elevs, dists) {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevs.length; i++) {
    const d = elevs[i] - elevs[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  return {
    points: elevs.length,
    distance_m: round(dists.at(-1)),
    elev_start_m: round(elevs[0]),
    elev_end_m: round(elevs.at(-1)),
    elev_min_m: round(Math.min(...elevs)),
    elev_max_m: round(Math.max(...elevs)),
    cumulative_gain_m: round(gain),
    cumulative_loss_m: round(loss),
  };
}

await mkdir(outDir, { recursive: true });

// 1) Perfil por parada (waypoint): una fila por final de conducción, con inclinación del rover.
const waypoints = await readJson('msl_waypoints.json');
// dist_total_m de NASA se reinicia a 0 en algunas paradas (p. ej. sol 987, 1042, 1289),
// así que el acumulado se recalcula sumando dist_m (distancia de cada conducción).
let runningDist = 0;
const profile = waypoints.features.map((f, i) => {
  const p = f.properties;
  runningDist += i === 0 ? 0 : Math.max(0, p.dist_m ?? 0);
  return {
    i,
    sol: p.sol,
    site: p.site,
    drive: p.drive,
    lon: p.lon,
    lat: p.lat,
    elev_m: p.elev_geoid,
    dist_total_m: round(runningDist),
    dist_total_nasa_m: p.dist_total_m,
    dist_from_prev_m: p.dist_m,
    tilt_deg: p.tilt,
    pitch_deg: p.pitch,
    roll_deg: p.roll,
    yaw_deg: p.yaw,
  };
});

const profileMeta = {
  mission: 'MSL Curiosity',
  site: 'Gale crater / Aeolis Mons (Mount Sharp)',
  source: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json',
  elevation_reference: 'elev_geoid: metros respecto al areoide de Marte (MOLA)',
  fields: {
    tilt_deg: 'Inclinación total del rover al final de la conducción (proxy de pendiente del terreno)',
    dist_total_m: 'Distancia recorrida acumulada desde el aterrizaje (suma de dist_from_prev_m)',
    dist_total_nasa_m: 'Acumulado original de NASA; tiene reinicios a 0 en 6 paradas, no usar para gráficas',
  },
  summary: summarize(profile.map((p) => p.elev_m), profile.map((p) => p.dist_total_m)),
};

await writeFile(join(outDir, 'elevation_waypoints.json'), JSON.stringify({ meta: profileMeta, points: profile }, null, 1));

const cols = Object.keys(profile[0]);
const csv = [cols.join(','), ...profile.map((r) => cols.map((c) => r[c]).join(','))].join('\n');
await writeFile(join(outDir, 'elevation_waypoints.csv'), csv + '\n');

// 2) Trazado denso: todos los vértices de la ruta con su altura y distancia acumulada calculada.
const traverse = await readJson('msl_traverse.json');
const dense = [];
let acc = 0;
let prev = null;
const linesOf = (g) => (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]);
traverse.features.forEach((f, segment) => {
  for (const [lon, lat, elev] of linesOf(f.geometry).flat()) {
    if (prev) {
      const step = haversineMars(prev, [lon, lat]);
      if (step === 0) continue; // vértice repetido entre segmentos
      acc += step;
    }
    dense.push({ segment, lon, lat, elev_m: round(elev), dist_total_m: round(acc) });
    prev = [lon, lat];
  }
});

const denseMeta = {
  mission: 'MSL Curiosity',
  source: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
  distance_method: `Haversine con radio de Marte ${MARS_RADIUS_M} m (distancia 2D, sin contar desnivel)`,
  summary: summarize(dense.map((p) => p.elev_m), dense.map((p) => p.dist_total_m)),
};

await writeFile(join(outDir, 'elevation_traverse.json'), JSON.stringify({ meta: denseMeta, points: dense }));

console.log('elevation_waypoints:', profileMeta.summary);
console.log('elevation_traverse:', denseMeta.summary);
