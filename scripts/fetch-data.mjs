// Descarga los puntos de navegación publicados por NASA para Perseverance en Jezero.
// Se guardan localmente porque el endpoint MMGIS no permite solicitudes CORS desde el navegador.
// Uso: node scripts/fetch-data.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data', 'jezero');
const url = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const response = await fetch(url);
if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
const waypoints = await response.json();
if (waypoints.type !== 'FeatureCollection' || !Array.isArray(waypoints.features)) {
  throw new Error('NASA no devolvió un GeoJSON FeatureCollection de puntos');
}
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'waypoints.json'), JSON.stringify(waypoints));
await writeFile(join(outDir, 'sources.json'), JSON.stringify({
  downloadedAt: new Date().toISOString(),
  mission: 'Mars 2020 Perseverance',
  site: 'Jezero crater',
  sources: { waypoints: url },
  note: 'Waypoints are rover localizations; connecting them produces a reference polyline, not the exact detailed traverse.',
}, null, 2));
console.log(`Jezero waypoints: ${waypoints.features.length} points`);
