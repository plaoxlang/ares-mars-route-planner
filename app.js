/* global L */
// Prototipo de mapa de ruta marciana: sin algoritmos de rutas, solo visualización de datos de NASA.

import {
  TREK, TREK_ATTR, MARS_RADIUS_M, tiltClass, TILT_LABEL, css, colors, fmt, $, loadJson, indexFromHash,
  THEMIS_NIGHT, colorizeCold, loadWeather, weatherRows, setupWeatherPanel,
} from './shared.js';

const RAW_API = 'https://mars.nasa.gov/api/v1/raw_image_items/';

// Mars Trek sirve teselas en plate carrée (EPSG:104905), que encaja con la rejilla
// EPSG:4326 de Leaflet (zoom 0 = 2×1 teselas). Solo cambiamos el radio para que
// la escala y las distancias sean de Marte.
const MarsCRS = L.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M });
const COLORS = colors();

// ---------- Mapa ----------
const map = L.map('map', { crs: MarsCRS, minZoom: 1, maxZoom: 18, zoomSnap: 0.5, worldCopyJump: false });

const galeCtxBounds = L.latLngBounds([-6.5733, 135.1843], [-2.8078, 139.2413]);
const galeHiriseBounds = L.latLngBounds([-4.9255, 137.1225], [-4.2490, 137.7298]);
// Vista inicial antes de añadir capas vectoriales (Leaflet la necesita para recortarlas).
map.fitBounds(galeHiriseBounds);

const base = {
  'MOLA relieve en color (463 m/px)': L.tileLayer(TREK('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 18, attribution: `${TREK_ATTR} · MGS MOLA`,
  }),
  'Viking color (232 m/px)': L.tileLayer(TREK('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 18, attribution: `${TREK_ATTR} · Viking MDIM 2.1`,
  }),
};

const overlays = {
  'CTX Gale (~6 m/px)': L.tileLayer(TREK('Gale_CTX_BlockAdj_dd', 'png'), {
    bounds: galeCtxBounds, maxNativeZoom: 12, maxZoom: 18, attribution: 'MRO CTX',
  }),
  'HiRISE Gale (~25 cm/px)': L.tileLayer(TREK('curiosity_hirise_mosaic', 'png'), {
    bounds: galeHiriseBounds, maxNativeZoom: 16, maxZoom: 18, attribution: 'MRO HiRISE',
  }),
  'DEM HiRISE 1 m (relieve)': L.tileLayer(TREK('Gale_DEM_SMG_1m', 'png'), {
    bounds: galeHiriseBounds, maxNativeZoom: 14, maxZoom: 18, opacity: 0.6, attribution: 'MRO HiRISE DEM',
  }),
  'Frío nocturno relativo (THEMIS IR noche)': coldLayer(),
};

// THEMIS IR nocturno recoloreado en el navegador: azul = superficie más fría de noche.
function coldLayer() {
  const Cold = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      tile.width = 256;
      tile.height = 256;
      const url = TREK(THEMIS_NIGHT.layer, THEMIS_NIGHT.ext)
        .replace('{z}', coords.z).replace('{y}', coords.y).replace('{x}', coords.x);
      fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          const g = tile.getContext('2d');
          g.drawImage(bmp, 0, 0);
          const img = g.getImageData(0, 0, 256, 256);
          colorizeCold(img.data);
          g.putImageData(img, 0, 0);
          done(null, tile);
        })
        .catch((err) => done(err, tile));
      return tile;
    },
  });
  return new Cold({
    maxNativeZoom: THEMIS_NIGHT.z, maxZoom: 18, opacity: 0.7, attribution: 'MO THEMIS IR noche (ASU)',
  });
}

base['MOLA relieve en color (463 m/px)'].addTo(map);
overlays['CTX Gale (~6 m/px)'].addTo(map);
overlays['HiRISE Gale (~25 cm/px)'].addTo(map);

const routeLayers = {};
const layerControl = L.control.layers(base, overlays, { collapsed: window.innerWidth < 860 }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

// ---------- Estado ----------
const state = { points: [], idx: 0, playing: null, imagesBySol: null, imagesLoading: null, photoTicket: 0 };

// ---------- Datos ----------
const [elev, traverse, weather] = await Promise.all([
  loadJson('data/export/elevation_waypoints.json'),
  loadJson('data/msl_traverse.json'),
  loadWeather(),
]);
state.points = elev.points;
const pts = state.points;

renderStats(elev.meta.summary);

const markers = [];
const climate = setupWeatherPanel({
  pts,
  weather,
  onChange() {
    markers.forEach((m, i) => m.setStyle({ fillColor: climate.colorAt(i) }));
    climate.renderStopAlerts(state.idx);
  },
});

const canvas = L.canvas({ padding: 0.5 });

// Trazado detallado (todas las conducciones), como línea base.
routeLayers['Trazado completo'] = L.geoJSON(traverse, {
  renderer: canvas,
  style: { color: '#ffffff', weight: 2, opacity: 0.55 },
  interactive: false,
}).addTo(map);

// Tramo ya recorrido hasta la parada seleccionada.
const travelled = L.polyline([], { renderer: canvas, color: COLORS.accent, weight: 4, opacity: 0.95, interactive: false }).addTo(map);

// Paradas coloreadas por inclinación del rover o por temperatura (según la tarjeta de clima).
const stops = L.layerGroup().addTo(map);
pts.forEach((p, i) => {
  const w = climate.wx[i];
  const temp = w ? ` · aire mín ${w.air_min_c} °C` : '';
  markers.push(L.circleMarker([p.lat, p.lon], {
    renderer: canvas, radius: 3.5, weight: 1, color: '#000', fillColor: climate.colorAt(i), fillOpacity: 0.95,
  })
    .bindTooltip(`Sol ${p.sol} · ${fmt.m(p.elev_m)} · ${fmt.deg(p.tilt_deg)}${temp}`, { direction: 'top' })
    .on('click', () => select(i, { pan: false }))
    .addTo(stops));
});
routeLayers['Paradas'] = stops;

const rover = L.circleMarker([pts[0].lat, pts[0].lon], {
  radius: 8, weight: 3, color: '#fff', fillColor: COLORS.accent, fillOpacity: 1, interactive: false,
}).addTo(map);

for (const [name, layer] of Object.entries(routeLayers)) layerControl.addOverlay(layer, name);

map.fitBounds(routeLayers['Trazado completo'].getBounds(), { padding: [30, 30] });

// ---------- Perfil de elevación ----------
const profile = buildProfile($('profile'), pts, (i) => select(i, { pan: true }));

// ---------- Línea de tiempo ----------
const slider = $('slider');
slider.max = String(pts.length - 1);
slider.addEventListener('input', () => select(Number(slider.value), { pan: true }));

$('play').addEventListener('click', togglePlay);
document.addEventListener('keydown', (e) => {
  if (e.target === slider) return;
  if (e.key === 'ArrowRight') select(Math.min(state.idx + 1, pts.length - 1), { pan: true });
  if (e.key === 'ArrowLeft') select(Math.max(state.idx - 1, 0), { pan: true });
});

select(indexFromHash(pts.length - 1), { pan: false });

// ---------- Funciones ----------
function select(i, { pan }) {
  state.idx = i;
  const p = pts[i];
  slider.value = String(i);
  $('slider-label').textContent = `Parada ${i + 1}/${pts.length} · Sol ${p.sol}`;
  $('to-other-view').href = `3d.html#i=${i}`;
  rover.setLatLng([p.lat, p.lon]);
  travelled.setLatLngs(pts.slice(0, i + 1).map((q) => [q.lat, q.lon]));
  if (pan) map.panTo([p.lat, p.lon], { animate: !state.playing });
  profile.mark(i);
  renderStop(p, i);
  renderPhotos(p.sol);
}

function togglePlay() {
  const btn = $('play');
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    btn.textContent = '▶';
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  if (state.idx >= pts.length - 1) select(0, { pan: true });
  btn.textContent = '❚❚';
  btn.setAttribute('aria-pressed', 'true');
  state.playing = setInterval(() => {
    if (state.idx >= pts.length - 1) return togglePlay();
    select(state.idx + 1, { pan: true });
  }, 120);
}

function renderStats(s) {
  const items = [
    [fmt.km(s.distance_m), 'recorrido'],
    [fmt.m(s.elev_end_m - s.elev_start_m), 'desnivel neto'],
    [fmt.m(s.cumulative_gain_m), 'subida acumulada'],
    [fmt.m(s.elev_min_m), 'cota mín.'],
    [fmt.m(s.elev_max_m), 'cota máx.'],
  ];
  $('stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

function renderStop(p, i) {
  const prev = pts[i - 1];
  const climb = prev ? p.elev_m - prev.elev_m : 0;
  const cls = tiltClass(p.tilt_deg);
  const label = TILT_LABEL[cls];
  const rows = [
    ['Sol', p.sol],
    ['Site / drive', `${p.site} / ${p.drive}`],
    ['Lat, lon', `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`],
    ['Elevación', fmt.m(p.elev_m)],
    ['Δ desde anterior', `${climb >= 0 ? '+' : ''}${climb.toFixed(1)} m en ${fmt.m(p.dist_from_prev_m)}`],
    ['Recorrido total', fmt.km(p.dist_total_m)],
    ['Inclinación', `${fmt.deg(p.tilt_deg)} <span class="badge ${cls}">${label}</span>`],
    ['Pitch / roll', `${fmt.deg(p.pitch_deg)} / ${fmt.deg(p.roll_deg)}`],
    ...weatherRows(climate.wx[i]),
  ];
  $('stop-details').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  climate.renderStopAlerts(i);
}

// Índice local (scripts/export-images.mjs) y, si no existe, la API en vivo.
async function imagesForSol(sol) {
  if (state.imagesBySol === null) {
    state.imagesLoading ??= loadJson('data/export/images_by_sol.json')
      .then((j) => new Map(j.sols.map((s) => [s.sol, s])))
      .catch(() => new Map());
    state.imagesBySol = await state.imagesLoading;
  }
  const local = state.imagesBySol.get(sol);
  if (local && !local.error) return { ...local, source: 'índice local' };

  const url = `${RAW_API}?order=sol%20desc,date_taken%20desc&per_page=12&page=0&condition_1=msl:mission`
    + `&condition_2=${sol}:sol:gte&condition_3=${sol}:sol:lte&extended=thumbnail::sample_type::noteq`;
  const j = await loadJson(url);
  return {
    sol,
    total_images: j.total,
    images: j.items.map((it) => ({ instrument: it.instrument, url: it.https_url ?? it.url, date_taken: it.date_taken })),
    source: 'API en vivo',
  };
}

async function renderPhotos(sol) {
  const ticket = ++state.photoTicket;
  const box = $('photos');
  const status = $('photos-status');
  status.textContent = `Cargando imágenes del sol ${sol}…`;
  box.innerHTML = '<div class="skeleton"></div>'.repeat(6);
  // Durante la reproducción no pedimos fotos en cada paso.
  if (state.playing) {
    status.textContent = 'En reproducción: pausa para ver las imágenes.';
    box.innerHTML = '';
    return;
  }
  try {
    const data = await imagesForSol(sol);
    if (ticket !== state.photoTicket) return;
    if (!data.images.length) {
      status.textContent = `Sin imágenes para el sol ${sol}.`;
      box.innerHTML = '';
      return;
    }
    const date = data.images[0].date_taken?.slice(0, 10) ?? '';
    status.textContent = `Sol ${sol} (${date}) · ${data.images.length} de ${data.total_images} · ${data.source}`;
    box.innerHTML = data.images.map((im) => `
      <a href="${im.url}" target="_blank" rel="noopener" title="${im.instrument}">
        <img src="${im.url}" alt="${im.instrument}, sol ${sol}" loading="lazy">
        <span class="cam">${im.instrument}</span>
      </a>`).join('');
  } catch (err) {
    if (ticket !== state.photoTicket) return;
    status.textContent = `No se pudieron cargar las imágenes (${err.message}).`;
    box.innerHTML = '';
  }
}

function buildProfile(svg, points, onPick) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000;
  const H = 150;
  const pad = { l: 48, r: 8, t: 8, b: 20 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const maxD = points.at(-1).dist_total_m;
  const minE = Math.min(...points.map((p) => p.elev_m));
  const maxE = Math.max(...points.map((p) => p.elev_m));
  const x = (d) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - minE) / (maxE - minE)) * (H - pad.t - pad.b);

  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
    return n;
  };

  // Rejilla y ejes
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const e = minE + ((maxE - minE) * k) / ticks;
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(e), y2: y(e), stroke: css('--border'), 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    el('text', { x: pad.l - 6, y: y(e) + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': 11 }).textContent = Math.round(e);
  }
  for (let km = 0; km <= maxD / 1000; km += 5) {
    el('text', { x: x(km * 1000), y: H - 5, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': 11 }).textContent = `${km} km`;
  }

  // Área y línea
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist_total_m).toFixed(1)},${y(p.elev_m).toFixed(1)}`).join('');
  el('path', { d: `${line}L${x(maxD)},${H - pad.b}L${x(0)},${H - pad.b}Z`, fill: css('--accent-soft') });
  el('path', { d: line, fill: 'none', stroke: COLORS.accent, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' });

  // Banda de inclinación bajo el eje
  points.forEach((p, i) => {
    const next = points[i + 1];
    if (!next) return;
    el('rect', {
      x: x(p.dist_total_m), y: H - pad.b + 1, width: Math.max(0.5, x(next.dist_total_m) - x(p.dist_total_m)), height: 3,
      fill: COLORS[tiltClass(next.tilt_deg)],
    });
  });

  const cursor = el('line', { y1: pad.t, y2: H - pad.b, stroke: '#fff', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0 });
  const marker = el('line', { y1: pad.t, y2: H - pad.b, stroke: COLORS.accent, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  const dot = el('circle', { r: 4, fill: COLORS.accent, stroke: '#fff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' });

  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const sx = ((evt.clientX - r.left) / r.width) * W;
    const d = ((sx - pad.l) / (W - pad.l - pad.r)) * maxD;
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

  svg.addEventListener('mousemove', (e) => {
    const i = nearest(e);
    const px = x(points[i].dist_total_m);
    cursor.setAttribute('x1', px);
    cursor.setAttribute('x2', px);
    cursor.setAttribute('opacity', 0.6);
    svg.setAttribute('aria-description', `Sol ${points[i].sol}, ${Math.round(points[i].elev_m)} m`);
  });
  svg.addEventListener('mouseleave', () => cursor.setAttribute('opacity', 0));
  svg.addEventListener('click', (e) => onPick(nearest(e)));

  return {
    mark(i) {
      const px = x(points[i].dist_total_m);
      marker.setAttribute('x1', px);
      marker.setAttribute('x2', px);
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', y(points[i].elev_m));
    },
  };
}
