// Vista 3D del cráter Jezero con la ruta de Perseverance.
// Relieve: DTM CTX controlado de 20 m (USGS, Mars 2020 TRN), recortado a la zona de la ruta.
// Textura: mosaicos controlados CTX + HiRISE de Mars Trek.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  TREK, M_PER_DEG, SITE, tiltClass, colors, fmt, num, $, loadJson, indexFromHash, trekTileAt,
  THEMIS_NIGHT, COLD_RAMP, ELEV_RAMP, rampCss, rampRgb, rgbCss, hexRgb,
  renderInspector, metricHTML, CLIMATE_NOTE, renderRouteLegend, buildProfile, setPlayButton,
} from './shared.js';
import { loadDem, terrainDerivatives, pixelCanvas, bilinear } from './dem.js';
import { loadPlan, mountPlanDock, formatHours, PLAN_COLOR } from './route-player.js';

// Textura: CTX como base y HiRISE encima (solo cubre parte de la zona).
const TEXTURES = [
  { layer: SITE.tiles.ctx.layer, ext: SITE.tiles.ctx.ext, z: 12, bounds: SITE.tiles.ctx.bounds },
  { layer: SITE.tiles.hirise.layer, ext: SITE.tiles.hirise.ext, z: 13, bounds: SITE.tiles.hirise.bounds },
];
const MAX_SEGMENTS = 1000; // el DTM recortado (~970 px) entra entero en la malla
const ROUTE_LIFT_M = 4; // la ruta flota un poco sobre el terreno para que se vea
const EYE_HEIGHT_M = 1.8;

const COLORS = colors();
const state = { idx: 0, exag: 2, follow: true, astro: false, playing: null, layer: 'sat' };
const wantsTour = /tour/.test(location.hash); // 3d.html#tour (desde el mapa 2D): ofrecer el tour al cargar
const wantsPlan = /plan/.test(location.hash); // 3d.html#plan: mostrar la ruta planificada en el 2D
let planDock = null; // barra de tiempo en modo "ruta planificada"

// ---------- Carga de teselas ----------
const progress = { done: 0, total: 0 };
function setLoading(title, detail) {
  $('loading-title').textContent = title;
  $('loading-detail').textContent = detail ?? '';
}

async function loadTile(url, prog) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  } finally {
    prog.done += 1;
  }
}

const tileUrl = (src, r, c) => TREK(src.layer, src.ext).replace('{z}', src.z).replace('{y}', r).replace('{x}', c);

function tileRange(e, z) {
  const d = 180 / 2 ** z;
  return {
    d,
    c0: Math.floor((e.west + 180) / d),
    c1: Math.floor((e.east + 180) / d - 1e-9),
    r0: Math.floor((90 - e.north) / d),
    r1: Math.floor((90 - e.south) / d - 1e-9),
  };
}

// Pinta en ctx las teselas de una capa que cubren e, colocándolas por coordenadas.
// Si la capa declara sus límites, solo se piden las teselas dentro de ellos.
async function drawMosaic(src, e, ctx, { onTile, prog = progress } = {}) {
  const b = src.bounds;
  const area = b ? {
    west: Math.max(e.west, b.west), east: Math.min(e.east, b.east),
    south: Math.max(e.south, b.south), north: Math.min(e.north, b.north),
  } : e;
  if (area.west >= area.east || area.south >= area.north) return;
  const t = tileRange(area, src.z);
  const sx = ctx.canvas.width / (e.east - e.west);
  const sy = ctx.canvas.height / (e.north - e.south);
  const jobs = [];
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c <= t.c1; c++) {
      const x = (c * t.d - 180 - e.west) * sx;
      const y = (e.north - (90 - r * t.d)) * sy;
      jobs.push(loadTile(tileUrl(src, r, c), prog).then((bmp) => {
        if (bmp) ctx.drawImage(bmp, x, y, t.d * sx, t.d * sy);
        onTile?.();
      }));
    }
  }
  prog.total += jobs.length;
  await Promise.all(jobs);
}

// ---------- Datos: ruta y relieve ----------
setLoading('Cargando relieve', 'DTM CTX de 20 m · USGS');
$('loading-bar').style.width = '40%';
const [elev, dem] = await Promise.all([loadJson(SITE.route), loadDem(SITE.dem)]);
const pts = elev.points;
renderStats(elev.meta.summary);
renderRouteLegend();

const ext = { west: dem.west, east: dem.east, north: dem.north, south: dem.south };
const demW = dem.width;
const demH = dem.height;
const { heights } = dem;
const lonC = (ext.west + ext.east) / 2;
const latC = (ext.south + ext.north) / 2;
const cosLat = Math.cos((latC * Math.PI) / 180);
const widthM = (ext.east - ext.west) * cosLat * M_PER_DEG;
const heightM = (ext.north - ext.south) * M_PER_DEG;
const toPixel = dem.toPixel;
const sampleHeight = dem.sample;
const terrainAt = dem.at;
const hMin = dem.min;
const hMax = dem.max;
const elevRef = hMin;

// Coincidencia del relieve con las alturas medidas por el rover.
const fit = (() => {
  const d = pts.map((p) => terrainAt(p.lon, p.lat) - p.elev_m);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return { n: d.length, bias: mean, rmse: Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length) };
})();
$('calib').textContent = `Relieve: DTM CTX controlado de ${dem.resolution_m} m (${demW} × ${demH} px). `
  + `Frente a las ${fit.n} alturas medidas por el rover: error cuadrático medio ±${num(fit.rmse, 1)} m, sesgo ${num(fit.bias, 1)} m.`;

const toLocal = (lon, lat, h) => new THREE.Vector3(
  (lon - lonC) * cosLat * M_PER_DEG,
  h - elevRef,
  -(lat - latC) * M_PER_DEG,
);

// ---------- Escena ----------
const host = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07080a');
scene.fog = new THREE.Fog('#07080a', 25000, 60000);

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 200000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.HemisphereLight('#ffe9d6', '#5a3a2a', 1.3));
const sun = new THREE.DirectionalLight('#fff1e0', 2.0);
sun.position.set(-1, 1.1, -0.8).multiplyScalar(10000); // sol desde el noroeste: realza el relieve
scene.add(sun);

const world = new THREE.Group(); // se escala en Y para la exageración vertical
scene.add(world);

// Malla del terreno
const step = Math.max(1, Math.ceil(Math.max(demW, demH) / MAX_SEGMENTS));
const segX = Math.round(demW / step);
const segY = Math.round(demH / step);
const geo = new THREE.PlaneGeometry(widthM, heightM, segX, segY);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const ix = i % (segX + 1);
  const iy = Math.floor(i / (segX + 1));
  pos.setY(i, sampleHeight((ix / segX) * (demW - 1), (iy / segY) * (demH - 1)) - elevRef);
}
geo.computeVertexNormals();

// Textura: empieza en color marciano y se va completando con CTX y HiRISE.
const maxTex = renderer.capabilities.maxTextureSize;
const texPxPerDeg = 256 / (180 / 2 ** TEXTURES.at(-1).z);
const texScale = Math.min(1, maxTex / ((ext.east - ext.west) * texPxPerDeg));
const texW = Math.round((ext.east - ext.west) * texPxPerDeg * texScale);
const texH = Math.round((ext.north - ext.south) * texPxPerDeg * texScale);
const texCanvas = document.createElement('canvas');
texCanvas.width = texW;
texCanvas.height = texH;
const texCtx = texCanvas.getContext('2d');
texCtx.fillStyle = '#8c6a55';
texCtx.fillRect(0, 0, texW, texH);
function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const texture = makeTexture(texCanvas);

const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture }));
world.add(terrain);

// ---------- Capas (vistas del terreno) ----------
let derivs = null;
const terrainDerivs = () => (derivs ??= terrainDerivatives(dem));
const demTexture = (colorAt) => makeTexture(pixelCanvas(demW, demH, colorAt));

const SLOPE_COLORS = { ok: hexRgb(COLORS.ok), warn: hexRgb(COLORS.warn), bad: hexRgb(COLORS.bad) };
const VIKING = { layer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', z: 7 };

// Satélite en color: luminosidad de HiRISE/CTX + tono y saturación de Viking (modo de fusión "color").
const colorLayer = { canvas: null, viking: null };
function composeColor() {
  const g = colorLayer.canvas.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.drawImage(texCanvas, 0, 0);
  g.globalCompositeOperation = 'color';
  g.drawImage(colorLayer.viking, 0, 0, texW, texH);
  g.globalCompositeOperation = 'source-over';
  LAYERS.color.texture.needsUpdate = true;
}

// Frío nocturno THEMIS en la rejilla del DTM: gris 0–255 (más claro = más templado de noche).
// Se carga al arrancar para poder dar el dato en cada parada.
const coldProg = { done: 0, total: 0 };
const cold = (async () => {
  const c = document.createElement('canvas');
  c.width = demW;
  c.height = demH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  await drawMosaic(THEMIS_NIGHT, ext, g, { prog: coldProg });
  const d = g.getImageData(0, 0, demW, demH).data;
  const gray = new Uint8Array(demW * demH);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) { gray[i] = d[i * 4]; hist[gray[i]]++; }
  // warmerThan[v] = fracción de la zona más templada que el valor v
  const warmerThan = new Float32Array(256);
  let acc = 0;
  for (let v = 255; v >= 0; v--) { warmerThan[v] = acc / gray.length; acc += hist[v]; }
  return { gray, warmerThan };
})();
let coldData = null;
cold.then((c) => {
  coldData = c;
  renderStop(pts[state.idx], state.idx);
}).catch(() => { /* el dato es opcional */ });

// ---------- Radiación estimada (modelo, no medida) ----------
// Dosis = media medida por RAD (Curiosity, Gale) × cielo visible × efecto de la altitud
// respecto al punto donde se midió (Jezero está ~1,9 km más alto: menos atmósfera encima).
// No incluye el ciclo solar ni tormentas solares (SPE), que cambian la dosis en el tiempo.
const RAD = {
  base_mSv_day: 0.64, // RAD/Curiosity en superficie, Gale (Hassler et al., 2014, Science): 0,64 ± 0,12 mSv/día
  refElevation_m: -4500, // altitud aproximada de esas medidas (Bradbury Landing, Gale)
  scaleHeight_m: 11100, // altura de escala de la atmósfera de Marte
  columnSensitivity: 0.4, // supuesto: % de cambio de dosis por % de cambio de columna atmosférica (ajustable)
  horizonRadius_m: 3000, // hasta dónde se busca relieve que tape el cielo
  dirs: 16,
  step: 4, // la rejilla se calcula cada 4 px del DTM (~80 m) y se interpola
};
const RAD_RAMP = ['#1d4f4a', '#2f8f6f', '#9ccf5a', '#f2d45a', '#f28a3c', '#d9435a'].map(hexRgb);

let radCache = null;
function radiationGrid() {
  if (radCache) return radCache;
  const gw = Math.ceil(demW / RAD.step);
  const gh = Math.ceil(demH / RAD.step);
  const dists = [];
  for (let d = 30; d <= RAD.horizonRadius_m; d *= 1.25) dists.push(d);
  const dirs = Array.from({ length: RAD.dirs }, (_, k) => {
    const a = (2 * Math.PI * k) / RAD.dirs;
    return [Math.sin(a) / dem.pxX, -Math.cos(a) / dem.pxY]; // píxeles por metro hacia (este, norte)
  });
  // Fracción de cielo visible (ángulo sólido): 1 − media del seno del horizonte en cada dirección.
  const svfAt = (x, y) => {
    const h0 = sampleHeight(x, y);
    let sum = 0;
    for (const [dx, dy] of dirs) {
      let maxTan = 0;
      for (const d of dists) {
        const px = x + dx * d;
        const py = y + dy * d;
        if (px < 0 || py < 0 || px > demW - 1 || py > demH - 1) break;
        const t = (sampleHeight(px, py) - h0) / d;
        if (t > maxTan) maxTan = t;
      }
      sum += maxTan / Math.sqrt(1 + maxTan * maxTan);
    }
    return 1 - sum / dirs.length;
  };
  const dose = (svf, h) => RAD.base_mSv_day * svf
    * Math.exp((RAD.columnSensitivity * (h - RAD.refElevation_m)) / RAD.scaleHeight_m);

  const grid = new Float32Array(gw * gh);
  let min = Infinity;
  let max = -Infinity;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(gx * RAD.step, demW - 1);
      const y = Math.min(gy * RAD.step, demH - 1);
      const v = dose(svfAt(x, y), sampleHeight(x, y));
      grid[gy * gw + gx] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const sample = (x, y) => bilinear(grid, gw, gh, x / RAD.step, y / RAD.step);
  radCache = { min, max, sample, at: (lon, lat) => sample(...toPixel(lon, lat)) };
  return radCache;
}

const LAYERS = {
  sat: { texture },
  color: {
    async build() {
      colorLayer.viking = document.createElement('canvas');
      colorLayer.viking.width = 256;
      colorLayer.viking.height = Math.round((256 * texH) / texW);
      await drawMosaic(VIKING, ext, colorLayer.viking.getContext('2d'), { prog: { done: 0, total: 0 } });
      colorLayer.canvas = document.createElement('canvas');
      colorLayer.canvas.width = texW;
      colorLayer.canvas.height = texH;
      LAYERS.color.texture = makeTexture(colorLayer.canvas);
      composeColor();
      return LAYERS.color.texture;
    },
  },
  elev: {
    build() {
      const { shade } = terrainDerivs();
      return demTexture((i) => {
        const s = 0.55 + 0.45 * shade[i];
        return rampRgb(ELEV_RAMP, (heights[i] - hMin) / (hMax - hMin)).map((v) => v * s);
      });
    },
  },
  slope: {
    build() {
      const { slope, shade } = terrainDerivs();
      return demTexture((i) => {
        const s = 0.6 + 0.4 * shade[i];
        return SLOPE_COLORS[tiltClass(slope[i])].map((v) => v * s);
      });
    },
  },
  cold: {
    async build() {
      const { gray } = await cold;
      const { shade } = terrainDerivs();
      return demTexture((i) => {
        const s = 0.65 + 0.35 * shade[i];
        return rampRgb(COLD_RAMP, gray[i] / 255).map((v) => v * s);
      });
    },
  },
  rad: {
    build() {
      const r = radiationGrid();
      const { shade } = terrainDerivs();
      const span = r.max - r.min || 1;
      return demTexture((i) => {
        const s = 0.7 + 0.3 * shade[i];
        return rampRgb(RAD_RAMP, (r.sample(i % demW, Math.floor(i / demW)) - r.min) / span).map((v) => v * s);
      });
    },
  },
};

async function setLayer(key) {
  const layer = LAYERS[key];
  state.layer = key;
  const radio = document.querySelector(`input[name="layer"][value="${key}"]`);
  if (radio) radio.checked = true; // por si la cambia el tour
  if (!layer.texture) {
    $('tex-status').textContent = 'Generando capa…';
    await new Promise(requestAnimationFrame); // deja pintar el aviso antes del cálculo
    layer.texture = await layer.build();
    $('tex-status').textContent = '';
  }
  if (state.layer !== key) return; // el usuario cambió de capa mientras se generaba
  terrain.material.map = layer.texture;
  terrain.material.needsUpdate = true;
  renderLegend(key);
}

function renderLegend(key) {
  const el = $('legend');
  if (key === 'elev') {
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(ELEV_RAMP)})"></div>
      <div class="ramp-labels"><span>${fmt.m(hMin)}</span><span>${fmt.m(hMax)}</span></div>
      <p>Altura del DTM respecto al areoide, con sombreado del relieve.</p>`;
  } else if (key === 'slope') {
    el.innerHTML = `<div class="legend"><span><i class="sw ok"></i>&lt; 8°</span><span><i class="sw warn"></i>8–15°</span><span><i class="sw bad"></i>&gt; 15°</span></div>
      <p>Pendiente del DTM CTX a escala de ~60 m. Las pendientes locales (rocas, escalones) pueden ser mayores.</p>`;
  } else if (key === 'rad') {
    const r = radiationGrid();
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(RAD_RAMP)})"></div>
      <div class="ramp-labels"><span>${num(r.min, 2)}</span><span>${num(r.max, 2)} mSv/día</span></div>
      <p><strong>Estimación, no medida.</strong> Parte de ${num(RAD.base_mSv_day, 2)} mSv/día medidos por RAD (Curiosity) en Gale
      y la ajusta por el cielo visible (el relieve tapa parte de la radiación) y por la altitud (Jezero está más alto: menos atmósfera encima).
      No incluye el ciclo solar ni tormentas solares.</p>`;
  } else if (key === 'cold') {
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(COLD_RAMP)})"></div>
      <div class="ramp-labels"><span>más frío de noche</span><span>más templado</span></div>
      <p>THEMIS IR nocturno (~100 m/px). Relativo, no son grados: la arena y el polvo se enfrían más que la roca.</p>`;
  } else if (key === 'color') {
    el.innerHTML = '<p>Detalle de HiRISE/CTX con el color de Viking (~300 m/px). Color aproximado, no es una foto en color real.</p>';
  } else {
    el.innerHTML = '<p>Mosaicos controlados de Jezero: HiRISE (25 cm/px de origen) sobre CTX (6 m/px). Escala de grises.</p>';
  }
}

// ---------- Ruta ----------
const routePos = [];
for (const p of pts) {
  const v = toLocal(p.lon, p.lat, terrainAt(p.lon, p.lat) + ROUTE_LIFT_M);
  routePos.push(v.x, v.y, v.z);
}
const tiltColor = (i) => COLORS[tiltClass(pts[i].tilt_deg)];
const routeGeo = new LineGeometry();
routeGeo.setPositions(routePos);
const tmpColor = new THREE.Color();
routeGeo.setColors(pts.flatMap((_, i) => tmpColor.set(tiltColor(i)).toArray()));
const routeMat = new LineMaterial({ linewidth: 3, vertexColors: true });
world.add(new Line2(routeGeo, routeMat));

const doneGeo = new LineGeometry();
doneGeo.setPositions(routePos.map((v, i) => (i % 3 === 1 ? v + 1.5 : v)));
const doneMat = new LineMaterial({ color: COLORS.accent, linewidth: 6 });
world.add(new Line2(doneGeo, doneMat));

// Marcador del rover (fuera de world para no deformarlo con la exageración).
// Visible a través del relieve (depthTest off) para no perderlo en la vista general.
const rover = new THREE.Group();
const markerMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
const head = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), markerMat('#ffffff'));
head.renderOrder = 10;
rover.add(head);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 700, 12), markerMat(COLORS.accent, 0.7));
beam.renderOrder = 9;
beam.position.y = 350;
rover.add(beam);
scene.add(rover);

// Baliza de la siguiente parada, solo en vista astronauta (escala humana).
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.15, 0.15, 12, 12),
  new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.9 }),
);
beacon.geometry.translate(0, 6, 0);
beacon.visible = false;
scene.add(beacon);

const routeLines = world.children.filter((o) => o instanceof Line2);
const SKY = { space: new THREE.Color('#07080a'), mars: new THREE.Color('#c79f7f') };

// Miniaturas de las capas del terreno: teselas reales o la rampa de color de cada capa.
const RAMP_THUMB = (ramp) => `linear-gradient(135deg,${rampCss(ramp)})`;
const LAYER_THUMBS = {
  sat: `url("${trekTileAt(SITE.tiles.hirise.layer, 'png', 15, 77.44, 18.445)}")`,
  color: `url("${trekTileAt('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 6, SITE.center.lon, SITE.center.lat)}")`,
  elev: RAMP_THUMB(ELEV_RAMP),
  slope: `linear-gradient(135deg,${COLORS.ok} 0 45%,${COLORS.warn} 45% 70%,${COLORS.bad} 70%)`,
  cold: RAMP_THUMB(COLD_RAMP),
  rad: RAMP_THUMB(RAD_RAMP),
};
document.querySelectorAll('[data-thumb3d]').forEach((t) => { t.style.backgroundImage = LAYER_THUMBS[t.dataset.thumb3d]; });

function setViewButton(id) {
  ['overview', 'top', 'astro'].forEach((b) => $(b).setAttribute('aria-pressed', String(b === id)));
}

function setAstroMode(on, { showBeacon = true } = {}) {
  state.astro = on;
  rover.visible = !on;
  beacon.visible = on && showBeacon;
  routeLines.forEach((l) => { l.visible = !on; });
  scene.background = on ? SKY.mars : SKY.space;
  scene.fog.color.copy(on ? SKY.mars : SKY.space);
  scene.fog.near = on ? 400 : 25000;
  scene.fog.far = on ? 9000 : 60000;
}

// ---------- Interacción ----------
const worldPoint = (lon, lat, extra = 0) => {
  const v = toLocal(lon, lat, terrainAt(lon, lat));
  v.y = v.y * state.exag + extra;
  return v;
};

function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  routeMat.resolution.set(w, h);
  doneMat.resolution.set(w, h);
}
new ResizeObserver(resize).observe(host);
resize();

function overview() {
  setAstroMode(false);
  setViewButton('overview');
  const p = pts[state.idx];
  const target = worldPoint(p.lon, p.lat);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(1800, 2400 * Math.max(1, state.exag / 2), 3200));
  controls.update();
}

// Vista cenital: cámara vertical con el norte arriba, como un mapa 2D.
function topView() {
  setAstroMode(false);
  setViewButton('top');
  const p = pts[state.idx];
  const target = state.follow ? worldPoint(p.lon, p.lat) : new THREE.Vector3(0, ((hMin + hMax) / 2 - elevRef) * state.exag, 0);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const span = state.follow ? 4000 : Math.max(heightM, widthM / camera.aspect);
  const dist = (span / 2 / Math.tan(halfFov)) * 1.05;
  controls.target.copy(target);
  camera.position.set(target.x, target.y + dist, target.z + 1); // +1 m al sur: evita el polo de OrbitControls
  controls.update();
}

// Posición de los ojos de un astronauta en la parada i, mirando hacia la siguiente.
function astroPose(i) {
  const p = pts[i];
  const q = i < pts.length - 1 ? pts[i + 1] : pts[i - 1];
  const eye = worldPoint(p.lon, p.lat, EYE_HEIGHT_M + 2);
  const ahead = worldPoint(q.lon, q.lat);
  const dir = ahead.clone().sub(eye).setY(0);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  dir.normalize();
  const look = eye.clone().addScaledVector(dir, 300);
  look.y = worldPoint(p.lon + (q.lon - p.lon) * 3, p.lat + (q.lat - p.lat) * 3).y + EYE_HEIGHT_M;
  return { pos: eye, target: look, beacon: ahead };
}

function astronautView() {
  setAstroMode(true);
  setViewButton('astro');
  const pose = astroPose(state.idx);
  camera.position.copy(pose.pos);
  controls.target.copy(pose.target);
  controls.update();
  beacon.position.copy(pose.beacon);
}

function select(i, { moveCamera = true } = {}) {
  const prevTarget = rover.position.clone();
  state.idx = i;
  const p = pts[i];
  $('slider').value = String(i);
  if (!planDock) {
    $('slider-label').textContent = `Sol ${p.sol}`;
    $('readout-sub').textContent = `${num(i + 1)} / ${num(pts.length)} · ${fmt.km(p.dist_total_m)}`;
    $('to-other-view').href = `index.html#i=${i}`;
    history.replaceState(null, '', `#i=${i}`);
  }
  profile.mark(i);

  rover.position.copy(worldPoint(p.lon, p.lat, ROUTE_LIFT_M * state.exag));
  doneGeo.instanceCount = Math.max(0, i);

  if (moveCamera) {
    if (state.astro) astronautView();
    else if (state.follow) {
      const delta = rover.position.clone().sub(prevTarget);
      camera.position.add(delta);
      controls.target.add(delta);
    }
  }
  renderStop(p, i);
}

function setExaggeration(v) {
  state.exag = v;
  world.scale.y = v;
  $('exag-label').textContent = `${num(v, Number.isInteger(v) ? 0 : 1)}×`;
  $('exag').value = String(v);
  const p = pts[state.idx];
  rover.position.copy(worldPoint(p.lon, p.lat, ROUTE_LIFT_M * v));
  if (state.astro) astronautView();
  planViz?.refresh();
  if (planDock) planDock.player.seek(planDock.player.t); // recoloca el vehículo de la ruta planificada
}

function renderStop(p, i) {
  const rad = radiationGrid();
  const dose = rad.at(p.lon, p.lat);
  const pct = ((dose - rad.min) / (rad.max - rad.min || 1)) * 100;
  const { slope } = terrainDerivs();
  const [fx, fy] = toPixel(p.lon, p.lat);
  const k = Math.round(fy) * demW + Math.round(fx);
  const slopeHere = slope[k] ?? 0;
  const coldPct = coldData ? Math.round(coldData.warmerThan[coldData.gray[k] ?? 0] * 100) : null;
  renderInspector($('inspector'), {
    p,
    i,
    n: pts.length,
    prev: pts[i - 1],
    extraMetrics: [
      metricHTML({ k: 'Pendiente terreno', v: num(slopeHere, 1), unit: '°', sub: 'DTM CTX 20 m', cls: tiltClass(slopeHere) }),
      metricHTML({
        k: 'Frío nocturno',
        v: coldPct === null ? '…' : `${coldPct}`,
        unit: coldPct === null ? '' : '%',
        sub: coldPct === null ? 'cargando THEMIS' : `más frío que el ${coldPct} % de la zona`,
      }),
      metricHTML({
        k: 'Radiación est.',
        v: num(dose, 2),
        unit: 'mSv/día',
        sub: 'modelo · ver capa',
        extra: `<div class="meter" title="Posición dentro del rango de la zona">
          <i style="width:${pct}%;background:${rgbCss(rampRgb(RAD_RAMP, pct / 100))}"></i></div>`,
      }),
      metricHTML({
        k: 'Altura DTM',
        v: num(terrainAt(p.lon, p.lat)),
        unit: 'm',
        sub: `${terrainAt(p.lon, p.lat) - p.elev_m >= 0 ? '+' : '−'}${num(Math.abs(terrainAt(p.lon, p.lat) - p.elev_m), 1)} m frente al rover`,
      }),
    ],
    sections: CLIMATE_NOTE,
  });
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

function togglePlay() {
  if (planDock) { planDock.player.toggle(); return; }
  const btn = $('play');
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    setPlayButton(btn, false);
    return;
  }
  if (state.idx >= pts.length - 1) select(0);
  setPlayButton(btn, true);
  state.playing = setInterval(() => {
    if (state.idx >= pts.length - 1) return togglePlay();
    select(state.idx + 1);
  }, 110);
}

// ---------- Ruta planificada (viene del planificador del mapa 2D) ----------
const plan = loadPlan();
const planViz = plan ? (() => {
  const lift = ROUTE_LIFT_M + 1;
  const pos = [];
  for (const [lat, lon] of plan.latlngs) {
    const v = toLocal(lon, lat, terrainAt(lon, lat) + lift);
    pos.push(v.x, v.y, v.z);
  }
  const lineGeo = new LineGeometry();
  lineGeo.setPositions(pos);
  const lineMat = new LineMaterial({ color: PLAN_COLOR, linewidth: 4 });
  const line = new Line2(lineGeo, lineMat);
  const doneGeoP = new LineGeometry();
  doneGeoP.setPositions(pos.map((v, i) => (i % 3 === 1 ? v + 1 : v)));
  const doneMatP = new LineMaterial({ color: '#ffffff', linewidth: 5 });
  const done = new Line2(doneGeoP, doneMatP);
  doneGeoP.instanceCount = 0;
  world.add(line, done);

  const beamMarker = (color, radius = 22) => {
    const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), markerMat(color));
    s.renderOrder = 11;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 500, 10), markerMat(color, 0.6));
    b.position.y = 250;
    b.renderOrder = 10;
    g.add(s, b);
    scene.add(g);
    return g;
  };
  const pinA = beamMarker('#2fbf71');
  const pinB = beamMarker('#ef5350');
  const vehicle = beamMarker(PLAN_COLOR, 30);
  const mats = [lineMat, doneMatP];
  const setRes = () => mats.forEach((m) => m.resolution.set(host.clientWidth, host.clientHeight));
  new ResizeObserver(setRes).observe(host);
  setRes();

  const viz = {
    refresh() {
      pinA.position.copy(worldPoint(plan.origin.lon, plan.origin.lat, 6 * state.exag));
      pinB.position.copy(worldPoint(plan.dest.lon, plan.dest.lat, 6 * state.exag));
    },
    setVisible(on) {
      [line, done, pinA, pinB, vehicle].forEach((o) => { o.visible = on; });
    },
    vehicle,
    done: doneGeoP,
  };
  viz.setVisible(false);
  return viz;
})() : null;

function frameRoute() {
  const lats = plan.latlngs.map((p) => p[0]);
  const lons = plan.latlngs.map((p) => p[1]);
  const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  const span = Math.max((Math.max(...lats) - Math.min(...lats)) * M_PER_DEG, (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG * cosLat, 1500);
  setAstroMode(false);
  setViewButton('overview');
  const target = worldPoint(c.lon, c.lat);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(span * 0.35, span * 0.75, span * 0.9));
  controls.update();
}

function renderPlanPanel() {
  const sec = $('plan-sec');
  if (!plan) { sec.hidden = true; return; }
  sec.hidden = false;
  const s = plan.stats;
  const summary = `<p class="plan-sum"><b>${plan.labels.join(' · ')}</b> · ${plan.vehicleName}</p>
    <div class="plan-chips">
      <div><b>${formatHours(s.hours)}</b><span>tiempo</span></div>
      <div><b>${fmt.km(s.distance_m)}</b><span>distancia</span></div>
      <div><b>+${num(s.ascent_m)} m</b><span>subida</span></div>
      <div><b>${num(s.max_slope_deg, 1)}°</b><span>pend. máx.</span></div>
    </div>`;
  sec.innerHTML = planDock
    ? `<h2 class="sec-title">Ruta planificada <span class="plan-dot"></span></h2>${summary}
       <div class="btn-row plan-btns">
         <button class="btn primary plan-play" type="button" data-plan="play">Reproducir</button>
         <button class="btn" type="button" data-plan="frame">Encuadrar</button>
         <a class="btn" href="index.html#plan">Editar en el mapa</a>
         <button class="btn" type="button" data-plan="close">Cerrar</button>
       </div>`
    : `<h2 class="sec-title">Ruta planificada</h2>${summary}
       <div class="btn-row plan-btns"><button class="btn primary plan-play" type="button" data-plan="open">Mostrar en 3D</button></div>`;
}

function enterPlanMode() {
  if (!plan) return;
  if (state.playing) togglePlay(); // pausa la ruta de Perseverance
  planViz.setVisible(true);
  planViz.refresh();
  $('profile-wrap').hidden = true;
  $('plan-profile-wrap').hidden = false;
  document.querySelector('.dock').classList.add('plan-mode');
  let last = null;
  planDock = mountPlanDock({
    wrap: $('plan-profile-wrap'),
    route: plan,
    colorAt: (p) => COLORS[tiltClass(p.slope)],
    playBtn: $('play'),
    labelEl: $('slider-label'),
    subEl: $('readout-sub'),
    onSample(s) {
      const v = worldPoint(s.lon, s.lat, ROUTE_LIFT_M * state.exag);
      planViz.vehicle.position.copy(v);
      planViz.done.instanceCount = s.seg;
      // La cámara acompaña al vehículo mientras se reproduce (si "Seguir" está activo)
      if (state.follow && !state.astro && last && planDock?.player.playing) {
        const d = v.clone().sub(last);
        camera.position.add(d);
        controls.target.add(d);
      }
      last = v.clone();
    },
  });
  $('to-other-view').href = 'index.html#plan';
  history.replaceState(null, '', '#plan');
  renderPlanPanel();
  frameRoute();
}

function exitPlanMode() {
  planDock?.destroy();
  planDock = null;
  planViz?.setVisible(false);
  $('profile-wrap').hidden = false;
  $('plan-profile-wrap').hidden = true;
  document.querySelector('.dock').classList.remove('plan-mode');
  setPlayButton($('play'), false);
  renderPlanPanel();
  select(state.idx, { moveCamera: false });
}

$('plan-sec').addEventListener('click', (e) => {
  const act = e.target.closest('[data-plan]')?.dataset.plan;
  if (act === 'open') enterPlanMode();
  else if (act === 'close') exitPlanMode();
  else if (act === 'frame') frameRoute();
  else if (act === 'play') planDock?.player.toggle();
});

const profile = buildProfile($('profile-wrap'), pts, { onPick: (i) => select(i), colorAt: tiltColor });

const slider = $('slider');
slider.max = String(pts.length - 1);
slider.addEventListener('input', () => select(Number(slider.value)));
setPlayButton($('play'), false);
$('play').addEventListener('click', togglePlay);
$('exag').addEventListener('input', (e) => setExaggeration(Number(e.target.value)));
$('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
$('astro').addEventListener('click', astronautView);
$('overview').addEventListener('click', overview);
$('top').addEventListener('click', topView);
$('layer').addEventListener('change', (e) => setLayer(e.target.value));
renderLegend(state.layer);
document.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('touring')) return; // el tour tiene sus propias teclas
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowRight') select(Math.min(state.idx + 1, pts.length - 1));
  if (e.key === 'ArrowLeft') select(Math.max(state.idx - 1, 0));
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
});

setExaggeration(state.exag);
select(indexFromHash(pts.length - 1), { moveCamera: false });
overview();
renderPlanPanel();
if (wantsPlan && plan) enterPlanMode();
$('loading').hidden = true;

const frameHooks = new Set();
renderer.setAnimationLoop((t) => {
  frameHooks.forEach((fn) => fn(t));
  controls.update();
  renderer.render(scene, camera);
});

// ---------- Tour guiado (se carga solo al pedirlo) ----------
const tourApi = {
  THREE, camera, controls, pts, state, stats: elev.meta.summary,
  stage: document.querySelector('.stage'),
  center: () => toLocal(lonC, latC, (hMin + hMax) / 2).multiply(new THREE.Vector3(1, state.exag, 1)),
  worldPoint, astroPose, setLayer, setExaggeration, setAstroMode, setViewButton, select, overview,
  radiation: () => radiationGrid(),
  onFrame: (fn) => { frameHooks.add(fn); return () => frameHooks.delete(fn); },
};
async function startTour() {
  const { runTour } = await import('./tour.js');
  runTour(tourApi);
}
$('tour-btn').addEventListener('click', startTour);
if (wantsTour) {
  import('./tour.js').then(({ offerTour }) => offerTour(tourApi));
}

// ---------- Textura en segundo plano ----------
let dirty = false;
const markDirty = () => {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(() => {
    texture.needsUpdate = true;
    if (state.layer === 'color' && LAYERS.color.texture) composeColor(); // sigue la carga de HiRISE
    dirty = false;
  });
};
const texStatus = $('tex-status');
const texTimer = setInterval(() => {
  texStatus.textContent = `Cargando imagen: ${progress.done}/${progress.total} teselas`;
}, 250);
for (const src of TEXTURES) {
  // eslint-disable-next-line no-await-in-loop
  await drawMosaic(src, ext, texCtx, { onTile: markDirty });
}
clearInterval(texTimer);
texStatus.textContent = '';
markDirty();
