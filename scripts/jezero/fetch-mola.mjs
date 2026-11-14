// Relieve regional alrededor de Jezero: MOLA MEGDR de 128 px/grado (~463 m/px), NASA PDS.
// Sirve para el terreno lejano de la vista 3D (el DTM CTX de 20 m solo cubre la zona de la ruta).
// Se descargan solo las filas necesarias de la tesela 0–44° N, 0–90° E (petición por rangos, ~14 MB).
// Salida: data/jezero/dem_mola_463m.bin (Int16 little-endian, metros respecto al areoide, fila a fila desde el norte)
//         data/jezero/dem_mola_463m.json (extensión y tamaño)
// Uso: node scripts/jezero/fetch-mola.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'jezero');
const SOURCE = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img';
const LABEL = SOURCE.replace(/\.img$/, '.lbl');
// Según la etiqueta PDS: 5632 líneas × 11520 muestras, MSB_INTEGER de 16 bits, metros;
// línea 0 = 44° N, muestra 0 = 0° E, 128 píxeles por grado.
const TILE = { lines: 5632, samples: 11520, north: 44, west: 0, ppd: 128 };
const CENTER = { lon: 77.34, lat: 18.46 }; // centro del DTM CTX de la ruta
const HALF_DEG = 2.4; // ~±140 km: con la niebla, el borde no se ve

const label = await (await fetch(LABEL)).text();
for (const [k, v] of [['LINES', TILE.lines], ['LINE_SAMPLES', TILE.samples], ['MAP_RESOLUTION', TILE.ppd]]) {
  const m = label.match(new RegExp(`\\b${k}\\s*=\\s*([\\d.]+)`));
  if (!m || Number(m[1]) !== v) throw new Error(`La etiqueta no coincide en ${k}: ${m?.[1]}`);
}
if (!/SAMPLE_TYPE\s*=\s*MSB_INTEGER/.test(label)) throw new Error('Se esperaba MSB_INTEGER');

const l0 = Math.floor((TILE.north - (CENTER.lat + HALF_DEG)) * TILE.ppd);
const l1 = Math.ceil((TILE.north - (CENTER.lat - HALF_DEG)) * TILE.ppd);
const s0 = Math.floor((CENTER.lon - HALF_DEG - TILE.west) * TILE.ppd);
const s1 = Math.ceil((CENTER.lon + HALF_DEG - TILE.west) * TILE.ppd);
const rowBytes = TILE.samples * 2;
const res = await fetch(SOURCE, { headers: { Range: `bytes=${l0 * rowBytes}-${l1 * rowBytes - 1}` } });
if (res.status !== 206) throw new Error(`Se esperaba una respuesta parcial (206) y llegó ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());

const width = s1 - s0;
const height = l1 - l0;
const out = Buffer.alloc(width * height * 2);
let min = Infinity;
let max = -Infinity;
for (let r = 0; r < height; r++) {
  for (let c = 0; c < width; c++) {
    const v = buf.readInt16BE(r * rowBytes + (s0 + c) * 2);
    out.writeInt16LE(v, 2 * (r * width + c));
    if (v < min) min = v;
    if (v > max) max = v;
  }
}

const meta = {
  source: SOURCE,
  label: LABEL,
  product: 'MGS MOLA Mission Experiment Gridded Data Record (MEGDR), 128 píxeles/grado (NASA PDS Geosciences)',
  resolution_m: 463,
  width,
  height,
  // Bordes exteriores de los píxeles, grados planetocéntricos (longitud este)
  west: TILE.west + s0 / TILE.ppd,
  east: TILE.west + s1 / TILE.ppd,
  north: TILE.north - l0 / TILE.ppd,
  south: TILE.north - l1 / TILE.ppd,
  encoding: 'Int16 little-endian, fila a fila desde el norte; metros',
  scale: 1,
  elevation_reference: 'metros respecto al areoide (MOLA)',
  stats: { min_m: min, max_m: max },
  generatedAt: new Date().toISOString(),
};
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'dem_mola_463m.bin'), out);
await writeFile(join(outDir, 'dem_mola_463m.json'), JSON.stringify(meta, null, 2));
console.log(`dem_mola_463m: ${width}×${height} px, ${(out.length / 1e6).toFixed(2)} MB`, meta.stats);
