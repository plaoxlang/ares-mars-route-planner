// Clima medido por Curiosity (REMS) para cada sol, desde el feed público de NASA/CAB.
// Uso: node scripts/gale/export-weather.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'data', 'gale', 'export');
const FEED = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';

const num = (v) => (v === '--' || v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === '--' || v === '' || v == null ? null : v);

const res = await fetch(FEED);
if (!res.ok) throw new Error(`${FEED} -> HTTP ${res.status}`);
const feed = await res.json();

const sols = feed.soles
  .map((s) => ({
    sol: Number(s.sol),
    date: s.terrestrial_date,
    ls: num(s.ls), // longitud solar: estación marciana (0 = equinoccio de primavera del norte)
    air_min_c: num(s.min_temp),
    air_max_c: num(s.max_temp),
    ground_min_c: num(s.min_gts_temp),
    ground_max_c: num(s.max_gts_temp),
    pressure_pa: num(s.pressure),
    uv_index: str(s.local_uv_irradiance_index),
    opacity: str(s.atmo_opacity),
    sunrise: str(s.sunrise),
    sunset: str(s.sunset),
  }))
  .sort((a, b) => a.sol - b.sol);

const withTemp = sols.filter((s) => s.air_min_c !== null);
const meta = {
  source: FEED,
  instrument: 'REMS (Rover Environmental Monitoring Station), Centro de Astrobiología (CAB) / NASA',
  disclaimer: 'Datos de divulgación según el propio feed. Para uso científico: NASA PDS.',
  units: { temperature: '°C', pressure: 'Pa' },
  fields: {
    air_min_c: 'Temperatura mínima del aire en el sol',
    ground_min_c: 'Temperatura mínima de la superficie (sensor de suelo GTS)',
  },
  generatedAt: new Date().toISOString(),
  sols: sols.length,
  sols_with_temperature: withTemp.length,
  sol_range: [sols[0].sol, sols.at(-1).sol],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'weather_by_sol.json'), JSON.stringify({ meta, sols }));
console.log(`weather_by_sol.json: ${sols.length} soles (${withTemp.length} con temperatura), soles ${meta.sol_range.join('–')}`);
