/* global L */
// Mapa 2D de la travesía de Perseverance en el cráter Jezero. Sin algoritmo de rutas todavía:
// visualiza los datos de NASA/USGS que necesitará.

import {
  TREK, TREK_ATTR, MARS_RADIUS_M, SITE, colors, fmt, num, $, loadJson, indexFromHash, latLon, trekTileAt,
  tiltClass, hexRgb, rampRgb, ELEV_RAMP, THEMIS_NIGHT, COLD_RAMP, rampCss, colorizeCold,
  renderInspector, metricHTML, CLIMATE_NOTE, renderRouteLegend, buildProfile, setPlayButton,
} from './shared.js';
import { loadDem, terrainDerivatives, pixelCanvas } from './dem.js';
import { setupPlanner } from './planner.js';
import { mountPlanDock, loadPlan, PLAN_COLOR } from './route-player.js';

// Mars Trek sirve teselas en plate carrée (EPSG:104905), que encaja con la rejilla
// EPSG:4326 de Leaflet (zoom 0 = 2×1 teselas). Solo cambiamos el radio para que
// la escala y las distancias sean de Marte.
const MarsCRS = L.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M });
const COLORS = colors();
const toBounds = (b) => L.latLngBounds([b.south, b.west], [b.north, b.east]);

// ---------- Mapa ----------
const map = L.map('map', { crs: MarsCRS, minZoom: 1, maxZoom: 19, zoomSnap: 0.5, zoomControl: false });
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

const Coords = L.Control.extend({
  onAdd() {
    const d = L.DomUtil.create('div', 'coords');
    d.textContent = latLon(SITE.center);
    return d;
  },
});
const coords = new Coords({ position: 'bottomleft' }).addTo(map);
map.on('mousemove', (e) => {
  coords.getContainer().textContent = latLon({ lat: e.latlng.lat, lon: e.latlng.lng });
});

// Vista inicial antes de añadir capas vectoriales (Leaflet la necesita para recortarlas).
map.fitBounds(toBounds(SITE.tiles.hirise.bounds));

const trekLayer = (t, opts = {}) => L.tileLayer(TREK(t.layer, t.ext), {
  bounds: toBounds(t.bounds), maxNativeZoom: t.maxZoom, maxZoom: 19, ...opts,
});

const BASE = {
  mola: L.tileLayer(TREK('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 19, attribution: `${TREK_ATTR} · MGS MOLA`,
  }),
  viking: L.tileLayer(TREK('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 19, attribution: `${TREK_ATTR} · Viking MDIM 2.1`,
  }),
};

// THEMIS IR nocturno recoloreado en el navegador: azul = superficie más fría de noche.
const ColdLayer = L.GridLayer.extend({
  createTile(c, done) {
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 256;
    const url = TREK(THEMIS_NIGHT.layer, THEMIS_NIGHT.ext).replace('{z}', c.z).replace('{y}', c.y).replace('{x}', c.x);
    colorizedTile(url)
      .then((src) => { tile.getContext('2d').drawImage(src, 0, 0); done(null, tile); })
      .catch((err) => done(err, tile));
    return tile;
  },
});

async function colorizedTile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  colorizeCold(img.data);
  g.putImageData(img, 0, 0);
  return c;
}

const OVERLAYS = {
  ctx: L.layerGroup([
    trekLayer(SITE.tiles.ctxWide, { attribution: 'MRO CTX' }),
    trekLayer(SITE.tiles.ctx),
  ]),
  hirise: trekLayer(SITE.tiles.hirise, { attribution: 'MRO HiRISE (controlado)' }),
  cold: new ColdLayer({ maxNativeZoom: THEMIS_NIGHT.z, maxZoom: 19, opacity: 0.72, attribution: 'MO THEMIS (ASU)' }),
  // elev y slope se crean al cargar el DTM
};

BASE.mola.addTo(map);
OVERLAYS.ctx.addTo(map);
OVERLAYS.hirise.addTo(map);

// Miniaturas de capa con teselas reales de la zona.
const THUMBS = {
  mola: trekTileAt('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 5, SITE.center.lon, SITE.center.lat),
  viking: trekTileAt('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 5, SITE.center.lon, SITE.center.lat),
  ctx: trekTileAt(SITE.tiles.ctx.layer, 'png', 11, 77.42, 18.45),
  hirise: trekTileAt(SITE.tiles.hirise.layer, 'png', 15, 77.44, 18.445),
};
document.querySelectorAll('[data-thumb]').forEach((t) => {
  const u = THUMBS[t.dataset.thumb];
  if (u) t.style.backgroundImage = `url("${u}")`;
});
document.querySelector('[data-thumb="elev"]').style.backgroundImage = `linear-gradient(135deg,${rampCss(ELEV_RAMP)})`;
document.querySelector('[data-thumb="slope"]').style.backgroundImage = `linear-gradient(135deg,${COLORS.ok} 0 45%,${COLORS.warn} 45% 70%,${COLORS.bad} 70%)`;
colorizedTile(trekTileAt(THEMIS_NIGHT.layer, THEMIS_NIGHT.ext, 9, SITE.center.lon, SITE.center.lat))
  .then((c) => { document.querySelector('[data-thumb="cold"]').style.backgroundImage = `url("${c.toDataURL()}")`; })
  .catch(() => { /* la miniatura es decorativa */ });

// ---------- Estado y datos ----------
const state = { idx: 0, playing: null, photoTicket: 0, imagesCache: new Map() };

const [elev, dem] = await Promise.all([loadJson(SITE.route), loadDem(SITE.dem)]);
const pts = elev.points;
renderStats(elev.meta.summary);
renderRouteLegend();

// Capas calculadas del DTM real: altura en color y pendiente, ambas con sombreado.
const derivs = terrainDerivatives(dem);
const demBounds = toBounds(dem);
const SLOPE_RGB = { ok: hexRgb(COLORS.ok), warn: hexRgb(COLORS.warn), bad: hexRgb(COLORS.bad) };
const elevCanvas = pixelCanvas(dem.width, dem.height, (i) => {
  const s = 0.55 + 0.45 * derivs.shade[i];
  return [...rampRgb(ELEV_RAMP, (dem.heights[i] - dem.min) / (dem.max - dem.min)).map((v) => v * s), 235];
});
const slopeCanvas = pixelCanvas(dem.width, dem.height, (i) => {
  const s = 0.6 + 0.4 * derivs.shade[i];
  return [...SLOPE_RGB[tiltClass(derivs.slope[i])].map((v) => v * s), 215];
});
OVERLAYS.elev = L.imageOverlay(elevCanvas.toDataURL(), demBounds, { attribution: 'DTM CTX (USGS)', className: 'dem-overlay' });
OVERLAYS.slope = L.imageOverlay(slopeCanvas.toDataURL(), demBounds, { attribution: 'DTM CTX (USGS)', className: 'dem-overlay' });
$('elev-legend').innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(ELEV_RAMP)})"></div>
  <div class="ramp-labels"><span>${fmt.m(dem.min)}</span><span>${fmt.m(dem.max)}</span></div>`;

const canvas = L.canvas({ padding: 0.5 });
const trace = L.polyline(pts.map((p) => [p.lat, p.lon]), {
  renderer: canvas, color: '#ffffff', weight: 1.6, opacity: 0.55, interactive: false,
}).addTo(map);
const travelled = L.polyline([], {
  renderer: canvas, color: COLORS.accent, weight: 3.5, opacity: 1, interactive: false,
}).addTo(map);

const stops = L.layerGroup().addTo(map);
pts.forEach((p, i) => {
  L.circleMarker([p.lat, p.lon], {
    renderer: canvas, radius: 2.8, weight: 0.6, color: 'rgba(0,0,0,0.6)', fillColor: COLORS[tiltClass(p.tilt_deg)], fillOpacity: 1,
  })
    .bindTooltip(`Sol ${p.sol} · ${fmt.m(p.elev_m)} · ${fmt.deg(p.tilt_deg)}`, { direction: 'top', offset: [0, -4] })
    .on('click', () => select(i, { pan: false }))
    .addTo(stops);
});
OVERLAYS.trace = trace;
OVERLAYS.stops = stops;

const halo = L.circleMarker([pts[0].lat, pts[0].lon], {
  radius: 14, weight: 1, color: COLORS.accent, opacity: 0.6, fill: false, interactive: false,
}).addTo(map);
const rover = L.circleMarker([pts[0].lat, pts[0].lon], {
  radius: 6, weight: 2.5, color: '#fff', fillColor: COLORS.accent, fillOpacity: 1, interactive: false,
}).addTo(map);

const wide = window.innerWidth > 900; // en escritorio los paneles flotan sobre el mapa
map.fitBounds(trace.getBounds(), wide
  ? { paddingTopLeft: [300, 30], paddingBottomRight: [360, 30] }
  : { padding: [20, 20] });

// ---------- Panel de capas ----------
const keepRouteOnTop = () => [trace, travelled, halo, rover].forEach((l) => map.hasLayer(l) && l.bringToFront());
document.querySelectorAll('input[name="base"]').forEach((r) => r.addEventListener('change', () => {
  Object.entries(BASE).forEach(([k, layer]) => (k === r.value ? layer.addTo(map) : layer.remove()));
  BASE[r.value].bringToBack();
}));
document.querySelectorAll('[data-overlay]').forEach((sw) => sw.addEventListener('change', () => {
  const key = sw.dataset.overlay;
  const layer = OVERLAYS[key];
  if (sw.checked) layer.addTo(map);
  else layer.remove();
  const legend = $(`${key}-legend`);
  if (legend) legend.hidden = !sw.checked;
  keepRouteOnTop();
}));

// ---------- Planificador de rutas ----------
// Con una ruta elegida en la pestaña "Planificar", la barra de tiempo pasa a esa ruta:
// play recorre la ruta con un vehículo a la velocidad estimada (comprimida).
const planVehicle = {
  done: L.polyline([], { color: '#ffffff', weight: 3, opacity: 0.95, interactive: false }),
  halo: L.circleMarker([0, 0], { radius: 15, weight: 1, color: PLAN_COLOR, opacity: 0.7, fill: false, interactive: false }),
  dot: L.circleMarker([0, 0], { radius: 7, weight: 3, color: '#fff', fillColor: PLAN_COLOR, fillOpacity: 1, interactive: false }),
};
let planDock = null;
let planTab = false;

function setDockMode() {
  const plan = planTab ? planner.current() : null;
  planDock?.destroy();
  planDock = null;
  $('profile-wrap').hidden = !!plan;
  $('plan-profile-wrap').hidden = !plan;
  document.querySelector('.dock').classList.toggle('plan-mode', !!plan);
  if (plan) {
    if (state.playing) togglePlay(); // pausa la ruta de Perseverance
    Object.values(planVehicle).forEach((l) => l.addTo(map));
    planDock = mountPlanDock({
      wrap: $('plan-profile-wrap'),
      route: plan,
      colorAt: (p) => COLORS[tiltClass(p.slope)],
      playBtn: $('play'),
      labelEl: $('slider-label'),
      subEl: $('readout-sub'),
      onSample(s) {
        const ll = [s.lat, s.lon];
        planVehicle.dot.setLatLng(ll);
        planVehicle.halo.setLatLng(ll);
        planVehicle.done.setLatLngs([...plan.latlngs.slice(0, s.seg + 1), ll]);
        if (planDock?.player.playing && !map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll);
      },
    });
    $('to-other-view').href = '3d.html#plan';
  } else {
    Object.values(planVehicle).forEach((l) => l.remove());
    setPlayButton($('play'), !!state.playing);
    renderReadout(state.idx);
  }
}

const planner = setupPlanner({
  L, map, dem, pts,
  getStopIndex: () => state.idx,
  onRouteChange: () => setDockMode(),
  onPlay: () => planDock?.player.toggle(),
});
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  const tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('panel-layers').hidden = tab !== 'layers';
  $('panel-plan').hidden = tab !== 'plan';
  planTab = tab === 'plan';
  planner.setActive(planTab);
  setDockMode();
}));

// ---------- Perfil = barra de tiempo ----------
const profile = buildProfile($('profile-wrap'), pts, {
  onPick: (i) => select(i, { pan: true }),
  colorAt: (i) => COLORS[tiltClass(pts[i].tilt_deg)],
});

const slider = $('slider');
slider.max = String(pts.length - 1);
slider.addEventListener('input', () => select(Number(slider.value), { pan: true }));
setPlayButton($('play'), false);
$('play').addEventListener('click', togglePlay);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (planDock && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const p = planDock.player;
    p.seek(p.t + (e.key === 'ArrowRight' ? 1 : -1) * p.total * 0.02);
  } else if (e.key === 'ArrowRight') select(Math.min(state.idx + 1, pts.length - 1), { pan: true });
  else if (e.key === 'ArrowLeft') select(Math.max(state.idx - 1, 0), { pan: true });
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
});

select(indexFromHash(pts.length - 1), { pan: false });

// Llegada desde la vista 3D con una ruta planificada (index.html#plan): se restaura.
if (/plan/.test(location.hash)) {
  const saved = loadPlan();
  if (saved) {
    document.querySelector('[data-tab="plan"]').click();
    planner.restore(saved);
  }
}

// ---------- Funciones ----------
function select(i, { pan }) {
  if (i === state.idx && state.rendered) return;
  state.idx = i;
  state.rendered = true;
  const p = pts[i];
  slider.value = String(i);
  if (!planDock) renderReadout(i);
  rover.setLatLng([p.lat, p.lon]);
  halo.setLatLng([p.lat, p.lon]);
  travelled.setLatLngs(pts.slice(0, i + 1).map((q) => [q.lat, q.lon]));
  if (pan) map.panTo([p.lat, p.lon], { animate: !state.playing });
  profile.mark(i);
  renderStop(i);
  renderPhotos(p.sol);
}

// Lectura de la barra de tiempo en modo "ruta de Perseverance"
function renderReadout(i) {
  const p = pts[i];
  $('slider-label').textContent = `Sol ${p.sol}`;
  $('readout-sub').textContent = `${num(i + 1)} / ${num(pts.length)} · ${fmt.km(p.dist_total_m)}`;
  $('to-other-view').href = `3d.html#i=${i}`;
}

function renderStop(i) {
  const p = pts[i];
  const [fx, fy] = dem.toPixel(p.lon, p.lat);
  const k = Math.round(fy) * dem.width + Math.round(fx);
  const slope = derivs.slope[k] ?? 0;
  const cls = tiltClass(slope);
  const model = dem.at(p.lon, p.lat);
  renderInspector($('inspector'), {
    p,
    i,
    n: pts.length,
    prev: pts[i - 1],
    extraMetrics: [
      metricHTML({ k: 'Pendiente terreno', v: num(slope, 1), unit: '°', sub: 'DTM CTX 20 m', cls }),
      metricHTML({ k: 'Altura DTM', v: num(model), unit: 'm', sub: `${model - p.elev_m >= 0 ? '+' : '−'}${num(Math.abs(model - p.elev_m), 1)} m frente al rover` }),
    ],
    sections: CLIMATE_NOTE,
  });
}

function togglePlay() {
  if (planDock) { planDock.player.toggle(); return; }
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    setPlayButton($('play'), false);
    renderPhotos(pts[state.idx].sol);
    return;
  }
  if (state.idx >= pts.length - 1) select(0, { pan: true });
  setPlayButton($('play'), true);
  state.playing = setInterval(() => {
    if (state.idx >= pts.length - 1) return togglePlay();
    select(state.idx + 1, { pan: true });
  }, 140);
}

function renderStats(s) {
  const items = [
    [`${num(s.distance_m / 1000, 1)} km`, 'Recorrido'],
    [`+${num(s.elev_end_m - s.elev_start_m)} m`, 'Desnivel neto'],
    [`${num(s.cumulative_gain_m)} m`, 'Subida acumulada'],
    [`${num(pts.length)}`, 'Paradas'],
    [`${pts[0].sol}–${pts.at(-1).sol}`, 'Soles'],
  ];
  $('stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

// ---------- Fotos del rover (API pública de Perseverance, en directo) ----------
const CAMERAS = {
  NAVCAM_LEFT: 'Navcam', NAVCAM_RIGHT: 'Navcam', MCZ_LEFT: 'Mastcam-Z', MCZ_RIGHT: 'Mastcam-Z',
  FRONT_HAZCAM_LEFT_A: 'Hazcam del.', FRONT_HAZCAM_RIGHT_A: 'Hazcam del.', FRONT_HAZCAM_LEFT_B: 'Hazcam del.', FRONT_HAZCAM_RIGHT_B: 'Hazcam del.',
  REAR_HAZCAM_LEFT: 'Hazcam tras.', REAR_HAZCAM_RIGHT: 'Hazcam tras.', SUPERCAM_RMI: 'SuperCam', SKYCAM: 'SkyCam',
  SHERLOC_WATSON: 'WATSON', CACHECAM: 'CacheCam', PIXL_MCC: 'PIXL',
};
const CAMERA_ORDER = ['Navcam', 'Mastcam-Z', 'Hazcam del.', 'Hazcam tras.', 'SuperCam', 'WATSON'];

// Hasta 12 fotos variadas: como mucho 3 por cámara, priorizando las de navegación y paisaje.
function pickImages(images) {
  const byCam = new Map();
  for (const im of images) {
    const cam = CAMERAS[im.camera?.instrument] ?? im.camera?.instrument ?? 'Cámara';
    if (!byCam.has(cam)) byCam.set(cam, []);
    byCam.get(cam).push({ cam, thumb: im.image_files?.small, url: im.image_files?.large ?? im.image_files?.full_res });
  }
  const cams = [...byCam.keys()].sort((a, b) => (CAMERA_ORDER.indexOf(a) + 99) % 99 - (CAMERA_ORDER.indexOf(b) + 99) % 99);
  const out = [];
  for (let round = 0; round < 3 && out.length < 12; round++) {
    for (const c of cams) if (byCam.get(c)[round] && out.length < 12) out.push(byCam.get(c)[round]);
  }
  return out.filter((x) => x.thumb);
}

async function imagesForSol(sol) {
  if (!state.imagesCache.has(sol)) {
    state.imagesCache.set(sol, loadJson(SITE.images(sol)).then((j) => ({ total: j.images.length, picked: pickImages(j.images) })));
  }
  return state.imagesCache.get(sol);
}

async function renderPhotos(sol) {
  const ticket = ++state.photoTicket;
  const box = $('photos');
  const status = $('photos-status');
  if (state.playing) {
    status.textContent = 'en pausa al reproducir';
    box.innerHTML = '';
    return;
  }
  status.textContent = 'cargando…';
  box.innerHTML = '<div class="skeleton"></div>'.repeat(8);
  try {
    const data = await imagesForSol(sol);
    if (ticket !== state.photoTicket) return;
    if (!data.picked.length) {
      status.textContent = 'ninguna este sol';
      box.innerHTML = '';
      return;
    }
    status.textContent = `${data.picked.length} de ${num(data.total)}`;
    box.innerHTML = data.picked.map((im) => `<a href="${im.url}" target="_blank" rel="noopener" title="${im.cam} · sol ${sol}">
        <img src="${im.thumb}" alt="${im.cam}, sol ${sol}" loading="lazy"><span class="cam">${im.cam}</span></a>`).join('');
  } catch (err) {
    state.imagesCache.delete(sol);
    if (ticket !== state.photoTicket) return;
    status.textContent = 'no disponibles';
    box.innerHTML = `<p class="empty" style="grid-column:1/-1">No se pudieron cargar (${err.message}).</p>`;
  }
}
