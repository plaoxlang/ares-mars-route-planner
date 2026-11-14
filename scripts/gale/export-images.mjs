// Índice de imágenes de Curiosity para cada sol en el que el rover tiene una parada.
// Consulta la API pública de raw images de NASA (una petición por sol, concurrencia limitada).
// Uso: node scripts/gale/export-images.mjs [imagenesPorSol=12]
// Si ya existe data/export/images_by_sol.json, solo repite los soles que fallaron
// (la API devuelve 403 si se le hacen demasiadas peticiones seguidas).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dataDir = join(root, 'data', 'gale');
const outDir = join(dataDir, 'export');

const PER_SOL = Number(process.argv[2] ?? 12);
const OUT_FILE = join(outDir, 'images_by_sol.json');
const previous = existsSync(OUT_FILE) ? JSON.parse(await readFile(OUT_FILE, 'utf8')) : null;
const CONCURRENCY = previous ? 1 : 4;
const PAUSE_MS = previous ? 400 : 0;
const API = 'https://mars.nasa.gov/api/v1/raw_image_items/';

const apiUrl = (sol) =>
  `${API}?order=sol%20desc,date_taken%20desc&per_page=${PER_SOL}&page=0` +
  `&condition_1=msl:mission&condition_2=${sol}:sol:gte&condition_3=${sol}:sol:lte` +
  `&extended=thumbnail::sample_type::noteq`;

async function fetchSol(sol, attempt = 1) {
  try {
    const res = await fetch(apiUrl(sol));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      sol,
      total_images: json.total,
      images: json.items.map((it) => ({
        imageid: it.imageid,
        instrument: it.instrument,
        date_taken: it.date_taken,
        site: it.site,
        drive: it.drive,
        url: it.https_url ?? it.url,
        title: it.title,
      })),
    };
  } catch (err) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchSol(sol, attempt + 1);
    }
    return { sol, error: String(err.message ?? err), images: [] };
  }
}

const waypoints = JSON.parse(await readFile(join(dataDir, 'msl_waypoints.json'), 'utf8'));
const sols = [...new Set(waypoints.features.map((f) => f.properties.sol))].sort((a, b) => a - b);

const prevBySol = new Map((previous?.sols ?? []).map((s) => [s.sol, s]));
const results = sols.map((sol) => {
  const prev = prevBySol.get(sol);
  return prev && !prev.error && prev.images.length <= PER_SOL ? prev : null;
});
const pending = results.flatMap((r, i) => (r ? [] : [i]));
console.log(`${sols.length - pending.length} soles ya descargados, ${pending.length} por pedir`);

let next = 0;
let done = 0;
async function worker() {
  while (next < pending.length) {
    const idx = pending[next++];
    results[idx] = await fetchSol(sols[idx]);
    if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    if (++done % 100 === 0) console.log(`${done}/${pending.length} soles`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

await mkdir(outDir, { recursive: true });
const failed = results.filter((r) => r.error).map((r) => r.sol);
const meta = {
  mission: 'MSL Curiosity',
  source: API,
  generatedAt: new Date().toISOString(),
  images_per_sol_max: PER_SOL,
  sols: sols.length,
  sols_failed: failed,
  note: 'total_images es el total de ese sol en la API; images trae solo las primeras N (sin miniaturas).',
};
await writeFile(OUT_FILE, JSON.stringify({ meta, sols: results }, null, 1));
console.log(`Hecho: ${sols.length} soles, ${failed.length} fallidos, ${results.reduce((a, r) => a + r.images.length, 0)} imágenes indexadas`);
