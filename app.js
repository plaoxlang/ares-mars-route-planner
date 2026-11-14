/* global L */
// Mapa 2D del cráter Jezero con el planificador de rutas: capas de satélite y del relieve, rutas A → B
// (tres alternativas) y reproducción de la ruta elegida en la barra de tiempo.

import {
  TREK, TREK_ATTR, MARS_RADIUS_M, SITE, colors, fmt, $, loadJson, latLon, trekTileAt,
  tiltClass, hexRgb, rampRgb, ELEV_RAMP, THEMIS_NIGHT, COLD_RAMP, rampCss, colorizeCold, setPlayButton,
} from './shared.js';
import { loadDem, terrainDerivatives, pixelCanvas } from './dem.js';
import { setupPlanner } from './planner.js';
import { mountPlanDock, loadPlan, PLAN_COLOR, renderPlanStats, clock, formatHours } from './route-player.js';
import { satAt, renderHero } from './hero.js';
import { startPresentation } from './present.js';

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

// Base fija: relieve MOLA en color (todo el planeta). Encima va una sola capa a la vez.
const MOLA = L.tileLayer(TREK('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'), {
  maxNativeZoom: 7, maxZoom: 19, attribution: `${TREK_ATTR} · MGS MOLA`,
});

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

MOLA.addTo(map);

// Miniaturas de capa con teselas reales de la zona.
const THUMBS = {
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

// ---------- Datos ----------
const [dem, defaultPlan] = await Promise.all([loadDem(SITE.dem), loadJson('data/jezero/default-plan.json')]);

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

const wide = () => window.innerWidth > 900; // en escritorio la ficha ocupa la izquierda
map.fitBounds(demBounds, wide() ? { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] } : { padding: [10, 10] });

$('cold-legend').innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(COLD_RAMP)})"></div>
  <div class="ramp-labels"><span>más frío de noche</span><span>más templado</span></div>`;

// ---------- Capas: una sola a la vez sobre MOLA ----------
// HiRISE no cubre toda la zona: lleva CTX debajo para que no queden huecos.
const LAYER_SET = { ctx: ['ctx'], hirise: ['ctx', 'hirise'], elev: ['elev'], slope: ['slope'], cold: ['cold'] };
function setLayer(key) {
  const want = new Set(LAYER_SET[key] ?? []);
  Object.entries(OVERLAYS).forEach(([k, layer]) => (want.has(k) ? layer.addTo(map) : layer.remove()));
  Object.keys(LAYER_SET).forEach((k) => { const lg = $(`${k}-legend`); if (lg) lg.hidden = k !== key; });
}
document.querySelectorAll('input[name="layer2d"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setLayer(r.value); }));
setLayer(document.querySelector('input[name="layer2d"]:checked')?.value ?? 'hirise');

// ---------- Planificador de rutas ----------
// La ruta elegida se reproduce en la barra de tiempo: play recorre la ruta con el vehículo a la
// velocidad estimada (comprimida) y la ficha de la izquierda sigue su posición.
const planVehicle = {
  done: L.polyline([], { color: '#ffffff', weight: 3, opacity: 0.95, interactive: false }),
  halo: L.circleMarker([0, 0], { radius: 15, weight: 1, color: PLAN_COLOR, opacity: 0.7, fill: false, interactive: false }),
  dot: L.circleMarker([0, 0], { radius: 7, weight: 3, color: '#fff', fillColor: PLAN_COLOR, fillOpacity: 1, interactive: false }),
};
let planDock = null;

function setDockMode() {
  const plan = planner.current();
  planDock?.destroy();
  planDock = null;
  document.querySelector('.dock').classList.add('plan-mode');
  renderPlanStats($('stats'), plan);
  if (!plan) {
    Object.values(planVehicle).forEach((l) => l.remove());
    setPlayButton($('play'), false);
    $('slider-label').textContent = '—';
    $('readout-sub').textContent = 'Marca A y B en el mapa';
    renderEmptyHero();
    return;
  }
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
      renderPlanHero(plan, s);
    },
  });
  $('to-other-view').href = '3d.html#plan';
}

// Cabecera de la ficha: imagen de satélite de donde va el vehículo y progreso de la ruta
let heroT = 0;
function renderPlanHero(plan, s) {
  const now = performance.now();
  if (planDock?.player.playing && now - heroT < 250) return;
  heroT = now;
  const sat = satAt(s.lon, s.lat);
  renderHero($('insp-hero'), {
    img: sat.css,
    caption: `${sat.caption} · posición del vehículo`,
    title: 'Mi ruta',
    meta: `${plan.labels.join(' · ')} · ${plan.vehicleName}`,
    meta2: `${clock(s.t)} · ${latLon({ lat: s.lat, lon: s.lon })}`,
    from: `A · ${plan.origin.name ?? 'origen'}`,
    to: `B · ${plan.dest.name ?? 'destino'}`,
    frac: s.dist / (plan.dist.at(-1) || 1),
    left: `${fmt.km(s.dist)} de ${fmt.km(plan.dist.at(-1))}`,
    right: `llegada en ${formatHours(Math.max(0, plan.hours.at(-1) - s.t))}`,
  });
}
function renderEmptyHero() {
  const sat = satAt(SITE.center.lon, SITE.center.lat);
  renderHero($('insp-hero'), {
    img: sat.css, caption: sat.caption, title: 'Nueva ruta', meta: 'Pulsa en el mapa el origen (A) y el destino (B)',
    from: 'A', to: 'B', frac: 0, left: '', right: '',
  });
}

const planner = setupPlanner({
  L, map, dem,
  onRouteChange: () => setDockMode(),
  onPlay: () => planDock?.player.toggle(),
});
planner.setActive(true);
$('play').addEventListener('click', () => planDock?.player.toggle());
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || document.body.classList.contains('presenting')) return;
  if (planDock && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const p = planDock.player;
    p.seek(p.t + (e.key === 'ArrowRight' ? 1 : -1) * p.total * 0.02);
  }
  if (e.key === ' ' && planDock) { e.preventDefault(); planDock.player.toggle(); }
});

// Ruta inicial: la última trazada (también si se vuelve del 3D) o, si no hay, la de ejemplo de Jezero
renderEmptyHero();
setDockMode();
planner.restore(loadPlan() ?? defaultPlan);

// ---------- Presentación ----------
startPresentation({
  page: '2d',
  ready: Promise.resolve(),
  api: {
    L, map, planner, dem, defaultPlan,
    get planDock() { return planDock; },
    setLayer(key) { const r = document.querySelector(`input[name="layer2d"][value="${key}"]`); if (r && !r.checked) r.click(); },
    // En la presentación la tarjeta ocupa la parte derecha: se encuadra en el hueco que queda
    fit(latlngs, ms = 1.6) { map.flyToBounds(L.latLngBounds(latlngs), { ...(wide() ? { paddingTopLeft: [430, 90], paddingBottomRight: [470, 50] } : { padding: [20, 20] }), duration: ms }); },
    flyTo(lat, lon, zoom, ms = 2) { map.flyTo([lat, lon], zoom, { duration: ms }); },
    toScreen(lat, lon) { const p = map.latLngToContainerPoint([lat, lon]); const r = map.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; },
    demBounds,
  },
});
