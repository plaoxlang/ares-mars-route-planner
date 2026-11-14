// Utilidades compartidas por la vista 2D (app.js) y la 3D (scene3d.js).

export const MARS_RADIUS_M = 3396190;
export const M_PER_DEG = (MARS_RADIUS_M * Math.PI) / 180;

export const TREK = (layer, ext) =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
export const TREK_ATTR = 'NASA/JPL-Caltech · Mars Trek';

export const TILT = { warn: 8, bad: 15 };
export const tiltClass = (t) => (t >= TILT.bad ? 'bad' : t >= TILT.warn ? 'warn' : 'ok');
export const TILT_LABEL = { ok: 'suave', warn: 'moderada', bad: 'fuerte' };

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const colors = () => ({ ok: css('--ok'), warn: css('--warn'), bad: css('--bad'), accent: css('--accent') });

export const fmt = {
  m: (n) => `${Math.round(n).toLocaleString('es-ES')} m`,
  km: (n) => `${(n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} km`,
  deg: (n) => `${n.toFixed(1)}°`,
};

export const $ = (id) => document.getElementById(id);

export async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---------- Colores ----------
export const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
export const rgbCss = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;
export function rampRgb(ramp, t) {
  const s = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  return ramp[i].map((v, k) => v + (ramp[i + 1][k] - v) * f);
}
// De frío (azul oscuro) a templado (naranja). Se usa para temperaturas y para THEMIS de noche.
export const COLD_RAMP = ['#24287a', '#2f6fd0', '#35b3c9', '#8fd36a', '#f2d45a', '#f29a4a'].map(hexRgb);
export const rampCss = (ramp) => ramp.map(rgbCss).join(',');

// THEMIS IR nocturno (Mars Trek): gris de 8 bits, más claro = superficie más templada de noche.
// Es relativo (no son grados) y puede tener cortes entre franjas tomadas en noches distintas.
export const THEMIS_NIGHT = { layer: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', z: 9 };
export function colorizeCold(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const [r, g, b] = rampRgb(COLD_RAMP, data[i] / 255);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

// ---------- Clima (REMS) y avisos ----------
export async function loadWeather() {
  const j = await loadJson('data/export/weather_by_sol.json');
  return { meta: j.meta, bySol: new Map(j.sols.map((s) => [s.sol, s])) };
}

// Clima del sol pedido o, si no hay medida ese sol, del más cercano (hasta maxGap soles).
export function weatherFor(weather, sol, maxGap = 5) {
  for (let d = 0; d <= maxGap; d++) {
    for (const s of d ? [sol - d, sol + d] : [sol]) {
      const w = weather.bySol.get(s);
      if (w && w.air_min_c !== null) return { ...w, gap: d };
    }
  }
  return null;
}

// Umbrales de ejemplo, editables en la interfaz: el equipo debe fijar los reales (límites del traje, etc.).
export const DEFAULT_THRESHOLDS = { air_min_c: -80, ground_min_c: -100 };
const TH_KEY = 'martian-map:thresholds';
export function loadThresholds() {
  try {
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(localStorage.getItem(TH_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}
function saveThresholds(th) {
  try { localStorage.setItem(TH_KEY, JSON.stringify(th)); } catch { /* sin almacenamiento: solo esta sesión */ }
}

export function alertsFor(w, th) {
  if (!w) return [];
  const out = [];
  if (w.air_min_c !== null && w.air_min_c < th.air_min_c) out.push(`Aire mínimo ${w.air_min_c} °C (umbral ${th.air_min_c} °C)`);
  if (w.ground_min_c !== null && w.ground_min_c < th.ground_min_c) out.push(`Suelo mínimo ${w.ground_min_c} °C (umbral ${th.ground_min_c} °C)`);
  return out;
}

export function weatherRows(w) {
  if (!w) return [['Clima', '<span class="muted">sin medida REMS cercana</span>']];
  const from = w.gap ? ` <span class="muted">(sol ${w.sol})</span>` : '';
  const v = (x) => (x ?? '–');
  return [
    ['Aire mín / máx', `${v(w.air_min_c)} / ${v(w.air_max_c)} °C${from}`],
    ['Suelo mín / máx', `${v(w.ground_min_c)} / ${v(w.ground_max_c)} °C`],
    ['Presión', w.pressure_pa ? `${w.pressure_pa} Pa` : '–'],
    ['UV · cielo', `${v(w.uv_index)} · ${v(w.opacity)}`],
    ['Fecha Tierra', v(w.date)],
  ];
}

// Tarjeta "Clima y avisos" (misma en 2D y 3D). onChange se llama al cambiar umbrales o modo de color.
export function setupWeatherPanel({ pts, weather, onChange }) {
  const th = loadThresholds();
  const wx = pts.map((p) => weatherFor(weather, p.sol));
  const temps = wx.filter(Boolean).map((w) => w.air_min_c);
  const range = [Math.min(...temps), Math.max(...temps)];
  const COL = colors();
  const panel = {
    th,
    wx,
    mode: 'tilt',
    alertsAt: (i) => alertsFor(wx[i], th),
    colorAt(i) {
      if (panel.mode === 'tilt') return COL[tiltClass(pts[i].tilt_deg)];
      const w = wx[i];
      if (!w) return '#777777';
      if (alertsFor(w, th).length) return COL.bad;
      return rgbCss(rampRgb(COLD_RAMP, (w.air_min_c - range[0]) / (range[1] - range[0])));
    },
    renderStopAlerts(i) {
      const a = panel.alertsAt(i);
      $('stop-alerts').innerHTML = a.length
        ? a.map((t) => `<p class="alert">⚠ ${t}</p>`).join('')
        : '<p class="muted small">Sin avisos de frío en esta parada.</p>';
    },
  };

  const legend = () => {
    $('route-legend').innerHTML = panel.mode === 'tilt'
      ? '<div class="legend"><i class="sw ok"></i>&lt; 8° <i class="sw warn"></i>8–15° <i class="sw bad"></i>&gt; 15°</div>'
      : `<div class="ramp" style="background:linear-gradient(to right,${rampCss(COLD_RAMP)})"></div>
         <div class="ramp-labels mono"><span>${range[0]} °C</span><span>${range[1]} °C</span></div>
         <p><i class="sw bad"></i> por debajo de un umbral · gris: sin dato</p>`;
  };
  const summary = () => {
    const n = wx.filter((w) => alertsFor(w, th).length).length;
    $('alert-summary').innerHTML = `<span class="badge ${n ? 'bad' : 'ok'}">${n}</span> de ${pts.length} paradas con aviso de frío`;
  };

  const air = $('th-air');
  const ground = $('th-ground');
  air.value = th.air_min_c;
  ground.value = th.ground_min_c;
  const onThreshold = () => {
    if (Number.isFinite(air.valueAsNumber)) th.air_min_c = air.valueAsNumber;
    if (Number.isFinite(ground.valueAsNumber)) th.ground_min_c = ground.valueAsNumber;
    saveThresholds(th);
    summary();
    onChange();
  };
  air.addEventListener('change', onThreshold);
  ground.addEventListener('change', onThreshold);
  $('route-color').addEventListener('change', (e) => {
    panel.mode = e.target.value;
    legend();
    onChange();
  });
  legend();
  summary();
  return panel;
}

// Índice de parada compartido entre vistas vía hash: 3d.html#i=123
export const indexFromHash = (max) => {
  const m = location.hash.match(/i=(\d+)/);
  return m ? Math.min(Number(m[1]), max) : max;
};
