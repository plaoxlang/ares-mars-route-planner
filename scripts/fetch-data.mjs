// Descarga los datos de ruta de Curiosity (MSL) desde el visor MMGIS de NASA.
// Estos JSON no admiten CORS, por eso se guardan en local en data/.
// Uso: node scripts/fetch-data.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'data');

const SOURCES = {
  'msl_waypoints.json': 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json',
  'msl_traverse.json': 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
};

await mkdir(outDir, { recursive: true });

for (const [file, url] of Object.entries(SOURCES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  if (json.type !== 'FeatureCollection') throw new Error(`${url} no es un FeatureCollection`);
  await writeFile(join(outDir, file), JSON.stringify(json));
  console.log(`${file}: ${json.features.length} features`);
}

await writeFile(
  join(outDir, 'sources.json'),
  JSON.stringify({ downloadedAt: new Date().toISOString(), sources: SOURCES }, null, 2),
);
