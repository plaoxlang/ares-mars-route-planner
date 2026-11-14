// Utilidades y componentes compartidos por la vista 2D (app.js) y la 3D (scene3d.js).

export const MARS_RADIUS_M = 3396190;
export const M_PER_DEG = (MARS_RADIUS_M * Math.PI) / 180;

export const TREK = (layer, ext) =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
export const TREK_ATTR = 'NASA/JPL-Caltech · Mars Trek';

// URL de una tesela concreta de Mars Trek que contiene (lon, lat): sirve de miniatura de capa.
export function trekTileAt(layer, ext, z, lon, lat) {
  const d = 180 / 2 ** z;
  return TREK(layer, ext)
    .replace('{z}', z)
    .replace('{y}', Math.floor((90 - lat) / d))
    .replace('{x}', Math.floor((lon + 180) / d));
}

export const TILT = { warn: 8, bad: 15 };
export const tiltClass = (t) => (t >= TILT.bad ? 'bad' : t >= TILT.warn ? 'warn' : 'ok');
export const TILT_LABEL = { ok: 'suave', warn: 'moderada', bad: 'fuerte' };

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const colors = () => ({ ok: css('--ok'), warn: css('--warn'), bad: css('--bad'), accent: css('--accent') });

// Números en es-ES con signo menos tipográfico.
export const num = (n, d = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
export const fmt = {
  m: (n) => `${num(Math.round(n))} m`,
  km: (n) => `${num(n / 1000, 2)} km`,
  deg: (n) => `${num(n, 1)}°`,
};
export const latLon = (p) => `${num(Math.abs(p.lat), 4)}° ${p.lat < 0 ? 'S' : 'N'}, ${num(Math.abs(p.lon), 4)}° ${p.lon < 0 ? 'O' : 'E'}`;

export const $ = (id) => document.getElementById(id);

export async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export const ICON = {
  play: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>',
};

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
// Altura: de azul (bajo) a blanco (alto), como los mapas MOLA.
export const ELEV_RAMP = ['#1b2a8a', '#1f78c8', '#28b4a0', '#7bc85a', '#e3d45a', '#e8903c', '#c8503c', '#f2efe9'].map(hexRgb);

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

// ---------- Zona de trabajo: cráter Jezero (Perseverance) ----------
const M20_LANDING_MS = Date.UTC(2021, 1, 18, 20, 55); // sol 0 de Perseverance
const SOL_MS = 88775244; // un sol en milisegundos

export const SITE = {
  name: 'Jezero',
  title: 'Cráter Jezero',
  rover: 'Perseverance',
  center: { lon: 77.38, lat: 18.46 },
  route: 'data/jezero/elevation_waypoints.json',
  dem: 'data/jezero/dem_ctx_20m',
  tiles: {
    ctx: {
      layer: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', ext: 'png', maxZoom: 13,
      bounds: { west: 77.1605, east: 77.6992, south: 18.2110, north: 18.7212 },
    },
    ctxWide: {
      layer: 'Jezero_CTX_BlockAdj_dd', ext: 'png', maxZoom: 12,
      bounds: { west: 75.1538, east: 78.8717, south: 15.9058, north: 19.4453 },
    },
    hirise: {
      layer: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', ext: 'png', maxZoom: 17,
      bounds: { west: 77.2229, east: 77.5840, south: 18.3068, north: 18.6693 },
    },
  },
  images: (sol) => `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=${sol}`,
  // Fecha terrestre aproximada de un sol (la ruta de MMGIS no trae fecha).
  solDate: (sol) => new Date(M20_LANDING_MS + sol * SOL_MS).toISOString().slice(0, 10),
};

// ---------- Inspector de parada ----------
export const metricHTML = ({ k, v, unit = '', sub = '', cls = '', extra = '' }) => `
  <div class="metric"><span class="k">${k}</span><span class="v">${v}${unit ? `<small>${unit}</small>` : ''}</span>${extra}${sub ? `<span class="d ${cls}">${sub}</span>` : ''}</div>`;

export function renderInspector(el, { p, i, n, prev, extraMetrics = [], sections = '' }) {
  const cls = tiltClass(p.tilt_deg);
  const [stCls, stText] = cls === 'bad' ? ['bad', 'Pendiente fuerte'] : cls === 'warn' ? ['warn', 'Precaución'] : ['ok', 'Nominal'];
  const climb = prev ? p.elev_m - prev.elev_m : 0;
  el.innerHTML = `
    <header class="insp-head">
      <div class="insp-top"><div class="insp-sol"><small>SOL</small>${p.sol}</div><span class="status ${stCls}">${stText}</span></div>
      <div class="insp-meta">≈ ${SITE.solDate(p.sol)} · parada ${num(i + 1)} de ${num(n)}</div>
      <div class="insp-meta">${latLon(p)}</div>
    </header>
    ${p.note && !/localization/i.test(p.note) ? `<p class="insp-note">${p.note}</p>` : ''}
    <div class="metrics">
      ${metricHTML({ k: 'Elevación', v: num(p.elev_m), unit: 'm', sub: `${climb >= 0 ? '+' : '−'}${num(Math.abs(climb), 1)} m en ${num(p.dist_from_prev_m)} m` })}
      ${metricHTML({ k: 'Recorrido', v: num(p.dist_total_m / 1000, 2), unit: 'km', sub: `site ${p.site} · drive ${p.drive}` })}
      ${metricHTML({ k: 'Inclinación', v: num(p.tilt_deg, 1), unit: '°', sub: `rover · ${TILT_LABEL[cls]}`, cls })}
      ${metricHTML({ k: 'Cabeceo / alabeo', v: `${num(p.pitch_deg, 1)} / ${num(p.roll_deg, 1)}`, unit: '°' })}
      ${extraMetrics.join('')}
    </div>
    ${sections}`;
}

// Nota común: no hay temperatura por parada en Jezero.
export const CLIMATE_NOTE = `<section class="insp-sec">
  <h3 class="sec-title">Temperatura <span>MEDA</span></h3>
  <p class="empty">El feed público de MEDA (Perseverance) solo cubre unos pocos soles, así que no hay temperatura por parada.
  Los datos completos están en NASA PDS.</p></section>`;

// Panel de la ruta: leyenda de inclinación (único modo de color en Jezero).
export function renderRouteLegend() {
  $('route-legend').innerHTML = '<div class="legend"><span><i class="sw ok"></i>&lt; 8°</span><span><i class="sw warn"></i>8–15°</span><span><i class="sw bad"></i>&gt; 15°</span></div>'
    + '<p>Pendiente del terreno en cada tramo de la ruta (DTM CTX de 20 m).</p>';
}

// ---------- Perfil de elevación = barra de tiempo ----------
// Las etiquetas van en HTML (no en el SVG) para que no se deformen al estirar el gráfico.
export function buildProfile(wrap, points, { onPick, colorAt, tip: tipText, color }) {
  const accent = color ?? css('--accent');
  const uid = Math.random().toString(36).slice(2, 8); // ids únicos: puede haber dos perfiles en la página
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000;
  const H = 100;
  const pad = { t: 10, b: 16 };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Perfil de elevación de la ruta. Haz clic o arrastra para elegir parada.');
  wrap.prepend(svg);

  const maxD = points.at(-1).dist_total_m;
  const minE = Math.min(...points.map((p) => p.elev_m));
  const maxE = Math.max(...points.map((p) => p.elev_m));
  const x = (d) => (d / maxD) * W;
  const y = (e) => pad.t + (1 - (e - minE) / (maxE - minE)) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const el = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };
  const html = (cls, styles, text = '') => {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, styles);
    d.textContent = text;
    wrap.appendChild(d);
    return d;
  };

  const defs = el('defs', {});
  const grad = el('linearGradient', { id: `pfill-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: 0, 'stop-color': accent, 'stop-opacity': 0.4 }, grad);
  el('stop', { offset: 1, 'stop-color': accent, 'stop-opacity': 0.02 }, grad);
  const clip = el('clipPath', { id: `pclip-${uid}` }, defs);
  const clipRect = el('rect', { x: 0, y: 0, width: 0, height: H }, clip);

  for (let k = 1; k <= 3; k++) {
    const yy = pad.t + ((H - pad.t - pad.b) * k) / 4;
    el('line', { x1: 0, x2: W, y1: yy, y2: yy, stroke: css('--line'), 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist_total_m).toFixed(1)},${y(p.elev_m).toFixed(1)}`).join('');
  const area = `${line}L${W},${base}L0,${base}Z`;
  el('path', { d: area, fill: 'rgba(255,255,255,0.035)' });
  el('path', { d: line, fill: 'none', stroke: css('--text-3'), 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' });
  el('path', { d: area, fill: `url(#pfill-${uid})`, 'clip-path': `url(#pclip-${uid})` });
  el('path', { d: line, fill: 'none', stroke: accent, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke', 'clip-path': `url(#pclip-${uid})` });

  // Banda de color bajo el perfil (inclinación o temperatura, según el modo de la ruta)
  const band = points.slice(1).map((p, k) => el('rect', {
    x: x(points[k].dist_total_m), y: base + 3, height: 4,
    width: Math.max(0.6, x(p.dist_total_m) - x(points[k].dist_total_m)),
  }));
  const recolor = () => band.forEach((r, k) => r.setAttribute('fill', colorAt(k + 1)));
  recolor();

  const hover = el('line', { y1: 0, y2: base, stroke: css('--text-2'), 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0 });
  const marker = el('line', { y1: 0, y2: base, stroke: accent, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });

  html('plabel', { left: '4px', top: '0' }, `${num(maxE)} m`);
  html('plabel', { left: '4px', bottom: '22px' }, `${num(minE)} m`);
  const step = maxD > 30000 ? 10000 : maxD > 12000 ? 5000 : maxD > 5000 ? 2000 : maxD > 2000 ? 1000 : 500;
  for (let d = step; d < maxD - step / 3; d += step) {
    html('plabel', { left: `${(d / maxD) * 100}%`, bottom: '-14px', transform: 'translateX(-50%)' }, `${num(d / 1000, d % 1000 ? 1 : 0)} km`);
  }
  const dot = html('pdot', color ? { background: accent, boxShadow: `0 0 0 2px var(--panel-solid), 0 0 0 3px ${accent}` } : {});
  const tip = html('ptip', {});

  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const d = ((evt.clientX - r.left) / r.width) * maxD;
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].dist_total_m < d) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1].dist_total_m - d) < Math.abs(points[lo].dist_total_m - d)) lo -= 1;
    return lo;
  };
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    onPick(nearest(e));
  });
  svg.addEventListener('pointermove', (e) => {
    const i = nearest(e);
    const p = points[i];
    const px = x(p.dist_total_m);
    hover.setAttribute('x1', px);
    hover.setAttribute('x2', px);
    hover.setAttribute('opacity', 0.5);
    tip.style.left = `${(px / W) * 100}%`;
    tip.style.opacity = 1;
    tip.textContent = tipText ? tipText(p) : `Sol ${p.sol} · ${fmt.m(p.elev_m)} · ${fmt.km(p.dist_total_m)}`;
    if (dragging) onPick(i);
  });
  const end = () => { dragging = false; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('pointerleave', () => {
    hover.setAttribute('opacity', 0);
    tip.style.opacity = 0;
  });

  return {
    recolor,
    mark(i) {
      const p = points[i];
      const px = x(p.dist_total_m);
      clipRect.setAttribute('width', px);
      marker.setAttribute('x1', px);
      marker.setAttribute('x2', px);
      dot.style.left = `${(px / W) * 100}%`;
      dot.style.top = `${(y(p.elev_m) / H) * 100}%`;
    },
  };
}

// Botón de reproducir/pausa con icono.
export function setPlayButton(btn, playing) {
  btn.innerHTML = playing ? ICON.pause : ICON.play;
  btn.setAttribute('aria-pressed', String(playing));
  btn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir ruta');
}

// Índice de parada compartido entre vistas vía hash: 3d.html#i=123
export const indexFromHash = (max) => {
  const m = location.hash.match(/i=(\d+)/);
  return m ? Math.min(Number(m[1]), max) : max;
};
