/* global L */
import { planRoutes } from './src/planner/objectives.js';
import { loadGrid } from './src/data/grid.js';
import {
  $, MARS_RADIUS_M, TREK, TREK_ATTR, cellAtLatLng, cellCenterLatLng, gridBounds, loadJson,
} from './shared.js';

const JEZERO_CENTER = [18.445, 77.451];
const jezeroCtxBounds = L.latLngBounds([15.9058484, 75.1537692], [19.4453003, 78.8717121]);
const controlledCtxBounds = L.latLngBounds([18.2110274, 77.1604655], [18.7211945, 77.6991776]);
const hiriseBounds = L.latLngBounds([18.3067994, 77.2229331], [18.669315, 77.583964]);
const marsCrs = L.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M });
const map = L.map('map', { crs: marsCrs, minZoom: 1, maxZoom: 18, zoomSnap: 0.5, worldCopyJump: false })
  .setView(JEZERO_CENTER, 9);

const base = {
  'MOLA · relieve global': L.tileLayer(TREK('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 18, attribution: `${TREK_ATTR} · MGS MOLA`,
  }),
  'Viking · color global': L.tileLayer(TREK('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'), {
    maxNativeZoom: 7, maxZoom: 18, attribution: `${TREK_ATTR} · Viking`,
  }),
};
const overlays = {
  'CTX · mosaico Jezero (NASA/JPL)': L.tileLayer(TREK('JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 'png'), {
    bounds: controlledCtxBounds, maxNativeZoom: 12, maxZoom: 18, attribution: 'MRO CTX · NASA/JPL-Caltech',
  }),
  'CTX · cobertura regional preliminar': L.tileLayer(TREK('Jezero_CTX_BlockAdj_dd', 'png'), {
    bounds: jezeroCtxBounds, maxNativeZoom: 12, maxZoom: 18, opacity: 0.85, attribution: 'MRO CTX · NASA/JPL-Caltech',
  }),
  'HiRISE · mosaico Jezero (NASA/JPL)': L.tileLayer(TREK('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png'), {
    bounds: hiriseBounds, maxNativeZoom: 16, maxZoom: 18, attribution: 'MRO HiRISE · NASA/JPL-Caltech',
  }),
};
base['MOLA · relieve global'].addTo(map);
overlays['CTX · mosaico Jezero (NASA/JPL)'].addTo(map);
overlays['HiRISE · mosaico Jezero (NASA/JPL)'].addTo(map);
L.control.layers(base, overlays, { collapsed: window.innerWidth < 860 }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

const referenceRoute = L.layerGroup().addTo(map);
const plannerLayers = L.layerGroup().addTo(map);
const selectionLayers = L.layerGroup().addTo(map);
let grid = null;
let pickMode = null;
let start = null;
let goal = null;
let gridOverlay = null;

function gridColor(value, field, min, max) {
  if (field === 'risk') {
    const t = Math.max(0, Math.min(1, (value - 1) / 9));
    return `rgb(${Math.round(50 + t * 190)},${Math.round(190 - t * 150)},70)`;
  }
  const t = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return `rgb(${Math.round(50 + t * 190)},${Math.round(190 - t * 150)},70)`;
}

function drawGrid(field = $('grid-view').value) {
  if (!grid) return;
  if (gridOverlay) map.removeLayer(gridOverlay);
  const maxCanvasSide = 2048;
  const factor = Math.min(1, maxCanvasSide / grid.cols, maxCanvasSide / grid.rows);
  const width = Math.max(1, Math.ceil(grid.cols * factor));
  const height = Math.max(1, Math.ceil(grid.rows * factor));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  let min = Infinity; let max = -Infinity;
  for (const row of grid[field]) for (const value of row) {
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const row = Math.min(grid.rows - 1, Math.floor((y / height) * grid.rows));
      const col = Math.min(grid.cols - 1, Math.floor((x / width) * grid.cols));
      const i = (y * width + x) * 4;
      if (grid.blocked[row][col]) { pixels.data[i] = 30; pixels.data[i + 1] = 18; pixels.data[i + 2] = 22; pixels.data[i + 3] = 210; }
      else {
        const rgb = gridColor(grid[field][row][col], field, min, max).match(/\d+/g).map(Number);
        pixels.data[i] = rgb[0]; pixels.data[i + 1] = rgb[1]; pixels.data[i + 2] = rgb[2]; pixels.data[i + 3] = 150;
      }
    }
  }
  context.putImageData(pixels, 0, 0);
  gridOverlay = L.imageOverlay(canvas.toDataURL(), gridBounds(grid), { opacity: 0.9, interactive: false }).addTo(map);
}

function updatePickerLabels() {
  $('start-cell').textContent = start ? `Fila ${start.row + 1}, columna ${start.col + 1}` : 'Sin elegir';
  $('goal-cell').textContent = goal ? `Fila ${goal.row + 1}, columna ${goal.col + 1}` : 'Sin elegir';
}

function renderRoutes() {
  plannerLayers.clearLayers();
  $('route-results').replaceChildren();
  const result = planRoutes({ grid, start, goal });
  const routes = [
    { key: 'safest', title: 'Ruta más segura', color: '#4cc38a', label: 'Riesgo acumulado' },
    { key: 'fastest', title: 'Ruta más rápida', color: '#ff9c55', label: 'Tiempo estimado' },
  ];
  for (const route of routes) {
    const value = result[route.key];
    const card = document.createElement('div');
    card.className = 'route-result';
    const heading = document.createElement('strong');
    heading.textContent = route.title;
    card.append(heading);
    if (!value) {
      const message = document.createElement('p'); message.textContent = 'No se encontró una ruta transitable.'; card.append(message);
    } else {
      const line = L.polyline(value.path.map((cell) => cellCenterLatLng(grid, cell)), { color: route.color, weight: 5, opacity: 0.95 });
      line.bindTooltip(route.title); line.addTo(plannerLayers);
      const metric = document.createElement('p');
      metric.textContent = `${route.label}: ${route.key === 'safest' ? value.totalRisk.toFixed(1) : `${(value.totalTimeSeconds / 60).toFixed(1)} min`} · ${value.path.length} celdas`;
      card.append(metric);
      const secondary = document.createElement('p'); secondary.className = 'muted small';
      secondary.textContent = route.key === 'safest'
        ? `Tiempo estimado: ${(value.totalTimeSeconds / 60).toFixed(1)} min`
        : `Riesgo acumulado: ${value.totalRisk.toFixed(1)}`;
      card.append(secondary);
    }
    $('route-results').append(card);
  }
}

map.on('click', (event) => {
  if (!grid || !pickMode) return;
  const cell = cellAtLatLng(grid, event.latlng.lat, event.latlng.lng);
  if (!cell) { $('grid-status').textContent = 'Ese punto queda fuera de la cuadrícula de análisis.'; return; }
  if (grid.blocked[cell.row][cell.col]) { $('grid-status').textContent = 'Esa celda está marcada como intransitable.'; return; }
  if (pickMode === 'start') start = cell; else goal = cell;
  pickMode = null;
  $('pick-start').classList.remove('selected'); $('pick-goal').classList.remove('selected');
  updatePickerLabels();
  selectionLayers.clearLayers();
  for (const [point, label, color] of [[start, 'Inicio', '#ffffff'], [goal, 'Destino', '#ffcf70']]) {
    if (!point) continue;
    L.circleMarker(cellCenterLatLng(grid, point), { radius: 7, color: '#111820', weight: 2, fillColor: color, fillOpacity: 1 })
      .bindTooltip(label).addTo(selectionLayers);
  }
  $('plan-routes').disabled = !start || !goal;
  $('grid-status').textContent = 'Punto seleccionado. Pulsa el otro botón para elegir el siguiente.';
});

$('pick-start').addEventListener('click', () => { pickMode = 'start'; $('grid-status').textContent = 'Pulsa en el mapa para elegir el inicio.'; $('pick-start').classList.add('selected'); $('pick-goal').classList.remove('selected'); });
$('pick-goal').addEventListener('click', () => { pickMode = 'goal'; $('grid-status').textContent = 'Pulsa en el mapa para elegir el destino.'; $('pick-goal').classList.add('selected'); $('pick-start').classList.remove('selected'); });
$('plan-routes').addEventListener('click', renderRoutes);
$('grid-view').addEventListener('change', () => drawGrid());

async function loadReferenceWaypoints() {
  try {
    const data = await loadJson('data/jezero/waypoints.json');
    const points = data.features
      .filter((feature) => feature.geometry?.type === 'Point' && Number.isFinite(feature.properties?.sol))
      .sort((a, b) => a.properties.sol - b.properties.sol);
    const latLngs = points.map((feature) => [feature.properties.lat, feature.properties.lon]);
    L.polyline(latLngs, { color: '#69aef5', weight: 2, opacity: 0.75, dashArray: '4 5' }).addTo(referenceRoute);
    points.filter((_, i) => i % 12 === 0).forEach((feature) => {
      L.circleMarker([feature.properties.lat, feature.properties.lon], {
        radius: 3, color: '#10233a', weight: 1, fillColor: '#8bc4ff', fillOpacity: 0.95,
      }).bindTooltip(`Perseverance · sol ${feature.properties.sol}`).addTo(referenceRoute);
    });
    $('data-status').textContent = `${points.length} localizaciones de Perseverance`;
    $('waypoint-summary').textContent = `${points.length} localizaciones de Perseverance en Jezero. La línea une esos puntos y sirve como referencia visual.`;
    if (latLngs.length) map.fitBounds(L.latLngBounds(latLngs).pad(0.08));
  } catch (error) {
    $('data-status').textContent = 'Faltan los puntos de Perseverance';
    $('waypoint-summary').textContent = 'Ejecuta node scripts/fetch-data.mjs para descargar el GeoJSON oficial de NASA.';
    console.error(error);
  }
}

async function loadTerrainGrid() {
  try {
    grid = await loadGrid('data/jezero/grid.json');
    $('grid-view').disabled = false;
    $('pick-start').disabled = false; $('pick-goal').disabled = false;
    $('grid-status').textContent = `${grid.cols} × ${grid.rows} celdas · cuadrícula cargada.`;
    drawGrid();
  } catch (error) {
    $('grid-status').textContent = error.message.includes('404')
      ? 'La matriz real de Jezero todavía no está en el repositorio. No se calcularán rutas con datos de ejemplo.'
      : `No se pudo cargar la matriz: ${error.message}`;
    console.info(error.message);
  }
}

await Promise.all([loadReferenceWaypoints(), loadTerrainGrid()]);
