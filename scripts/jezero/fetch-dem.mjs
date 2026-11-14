// Relieve de Jezero: DTM CTX controlado de 20 m (Mars 2020 TRN, USGS), recortado a la zona de la ruta.
// Salida: data/jezero/dem_ctx_20m.bin (Int16 little-endian, decímetros respecto al areoide; -32768 = sin dato)
//         data/jezero/dem_ctx_20m.json (extensión, tamaño y escala)
// Uso: node scripts/jezero/fetch-dem.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'jezero');
const SOURCE = 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/'
  + 'JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif';
const MARS_R = 3396190; // esfera IAU Mars 2000, la del propio GeoTIFF
const PAD_DEG = 0.04; // margen alrededor de la ruta (~2,3 km)
const NODATA = -32768;

// --- Lector TIFF mínimo: little-endian, sin compresión, float32 en tiras (es como viene este DTM) ---
function readTiff(buf) {
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error('Se esperaba un TIFF little-endian');
  const ifd = buf.readUInt32LE(4);
  const tags = {};
  const SIZE = { 3: 2, 4: 4, 12: 8 };
  for (let i = 0; i < buf.readUInt16LE(ifd); i++) {
    const e = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(e);
    const type = buf.readUInt16LE(e + 2);
    const count = buf.readUInt32LE(e + 4);
    const size = (SIZE[type] ?? 1) * count;
    const off = size <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const read = { 3: (k) => buf.readUInt16LE(off + 2 * k), 4: (k) => buf.readUInt32LE(off + 4 * k), 12: (k) => buf.readDoubleLE(off + 8 * k) }[type];
    tags[tag] = read ? Array.from({ length: count }, (_, k) => read(k)) : null;
  }
  const [width] = tags[256];
  const [height] = tags[257];
  if (tags[259][0] !== 1) throw new Error(`Compresión ${tags[259][0]} no soportada`);
  if (tags[258][0] !== 32 || tags[339][0] !== 3) throw new Error('Se esperaba float32');
  const [sx, sy] = tags[33550]; // ModelPixelScale (m)
  const [, , , x0, y0] = tags[33922]; // ModelTiepoint: esquina superior izquierda (m)
  const offsets = tags[273];
  const rowsPerStrip = tags[278][0];
  const data = new Float32Array(width * height);
  offsets.forEach((off, s) => {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    for (let k = 0; k < rows * width; k++) data[s * rowsPerStrip * width + k] = buf.readFloatLE(off + 4 * k);
  });
  return { width, height, sx, sy, x0, y0, data };
}

const deg = (m) => (m / MARS_R) * (180 / Math.PI);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const tif = readTiff(Buffer.from(await res.arrayBuffer()));
const pxDeg = deg(tif.sx); // equirectangular con latitud estándar 0: mismo paso en lon y lat
const west0 = deg(tif.x0);
const north0 = deg(tif.y0);

const route = JSON.parse(await readFile(join(outDir, 'elevation_waypoints.json'), 'utf8')).points;
const lons = route.map((p) => p.lon);
const lats = route.map((p) => p.lat);
const c0 = Math.max(0, Math.floor((Math.min(...lons) - PAD_DEG - west0) / pxDeg));
const c1 = Math.min(tif.width - 1, Math.ceil((Math.max(...lons) + PAD_DEG - west0) / pxDeg));
const r0 = Math.max(0, Math.floor((north0 - Math.max(...lats) - PAD_DEG) / pxDeg));
const r1 = Math.min(tif.height - 1, Math.ceil((north0 - Math.min(...lats) + PAD_DEG) / pxDeg));
const width = c1 - c0 + 1;
const height = r1 - r0 + 1;

const out = Buffer.alloc(width * height * 2);
let valid = 0;
let min = Infinity;
let max = -Infinity;
for (let r = 0; r < height; r++) {
  for (let c = 0; c < width; c++) {
    const v = tif.data[(r0 + r) * tif.width + (c0 + c)];
    const ok = Number.isFinite(v) && v > -1e30;
    const dm = ok ? Math.round(v * 10) : NODATA;
    out.writeInt16LE(dm, 2 * (r * width + c));
    if (ok) { valid++; if (v < min) min = v; if (v > max) max = v; }
  }
}

const meta = {
  source: SOURCE,
  product: 'MRO CTX DTM controlado, Mars 2020 Terrain Relative Navigation (USGS Astrogeology)',
  resolution_m: tif.sx,
  width,
  height,
  // Bordes exteriores de los píxeles, en grados planetocéntricos (longitud este)
  west: west0 + c0 * pxDeg,
  east: west0 + (c1 + 1) * pxDeg,
  north: north0 - r0 * pxDeg,
  south: north0 - (r1 + 1) * pxDeg,
  encoding: 'Int16 little-endian, fila a fila desde el norte; metros = valor × 0,1',
  scale: 0.1,
  nodata: NODATA,
  elevation_reference: 'metros respecto al areoide (MOLA)',
  stats: { min_m: Math.round(min * 10) / 10, max_m: Math.round(max * 10) / 10, valid_pct: Math.round((1000 * valid) / (width * height)) / 10 },
  generatedAt: new Date().toISOString(),
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'dem_ctx_20m.bin'), out);
await writeFile(join(outDir, 'dem_ctx_20m.json'), JSON.stringify(meta, null, 2));
console.log(`dem_ctx_20m: ${width}×${height} px, ${(out.length / 1e6).toFixed(2)} MB`, meta.stats);
