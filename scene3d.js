// Vista 3D del cráter Jezero con la ruta de Perseverance.
// Relieve: DTM CTX controlado de 20 m (USGS, Mars 2020 TRN), recortado a la zona de la ruta.
// Textura: mosaicos controlados CTX + HiRISE de Mars Trek.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  TREK, M_PER_DEG, SITE, TILT, tiltClass, colors, latLon, fmt, num, $, loadJson, indexFromHash, trekTileAt,
  THEMIS_NIGHT, COLD_RAMP, ELEV_RAMP, rampCss, rampRgb, rgbCss, hexRgb,
  renderInspector, metricHTML, CLIMATE_NOTE, renderRouteLegend, buildProfile, setPlayButton,
} from './shared.js';
import { loadDem, terrainDerivatives, pixelCanvas, bilinear } from './dem.js';
import { loadPlan, mountPlanDock, formatHours, clock, PLAN_COLOR, renderPlanStats } from './route-player.js';
import { applyGroundDetail } from './detail.js';
import { missionReport, reportHTML, arrivalHTML } from './mission.js';
import { createSky, sunDirection, skyState } from './sky.js';
import { createPhotos } from './photos.js';
import { satAt, renderHero as paintHero, renderStopHero as paintStopHero } from './hero.js';
import { createMinimap } from './minimap.js';
import { microRelief, shake, createDust, createTracks } from './fx.js';

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
// Intro cinematográfica: al entrar en 3d.html (una vez por sesión) o con #intro; nunca en la presentación
const presenting = (() => { try { return !!sessionStorage.getItem('ares:present'); } catch { return false; } })();
// 3d.html#drive (al crear una ruta en el mapa): entra directamente al volante con un vuelo de cámara
const wantsDrive = /drive/.test(location.hash) && !presenting;
const wantsIntro = !presenting && !wantsDrive && (/intro/.test(location.hash) || (() => {
  try { return sessionStorage.getItem('ares:intro') !== '1'; } catch { return true; }
})());
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

const camera = new THREE.PerspectiveCamera(50, 1, 2, 200000); // near de 2 m: precisión de profundidad para el terreno lejano
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
// Navegación de mapa en la vista General: arrastrar desplaza sobre el terreno, botón derecho
// (o Ctrl/Mayús + arrastrar) gira, la rueda acerca hacia el cursor. Táctil: un dedo desplaza, dos giran y acercan.
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.screenSpacePanning = false;
controls.zoomToCursor = true;
controls.minDistance = 40;
controls.maxDistance = 80000;

const hemi = new THREE.HemisphereLight('#ffe9d6', '#5a3a2a', 1.3);
scene.add(hemi);
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
  // Misma conversión posición → lon/lat que el resto (toLocal/terrainAt): sin desfase de medio píxel,
  // que en una ladera serían ~1 m de error y enterraría las ruedas del rover.
  const lon = lonC + pos.getX(i) / (cosLat * M_PER_DEG);
  const lat = latC - pos.getZ(i) / M_PER_DEG;
  pos.setY(i, terrainAt(lon, lat) - elevRef);
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
// Grano de suelo procedimental al acercarse (solo aspecto; ver detail.js). En capas de datos se apaga.
// Ocre marciano para las vistas a ras de suelo (luminancia ≈ 1: no cambia el brillo, solo el tono).
const MARS_TINT = new THREE.Vector3(1.32, 0.96, 0.72);
const terrainDetail = applyGroundDetail(terrain.material, {
  // Sin mapa de normales: repetido sobre 20 km crearía una trama visible desde lejos.
  sizeU: widthM, sizeV: heightM, fine: 6, coarse: 40, fade: [50, 350], fadeCoarse: [150, 700], normalScale: 0,
});
// El terreno general solo se tiñe en las vistas del rover y con la capa de satélite en gris.
function updateTerrainTint() {
  terrainDetail.uTint.value.set(1, 1, 1);
  farMat.color.setRGB(1, 1, 1);
  if (state.drive && state.layer === 'sat') {
    terrainDetail.uTint.value.copy(MARS_TINT);
    farMat.color.setRGB(MARS_TINT.x, MARS_TINT.y, MARS_TINT.z);
  }
}

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
  if (planDock) renderMissionPanel(); else renderStop(pts[state.idx], state.idx);
  if (plan) renderPlanPanel();
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
  terrainDetail.uDetStrength.value = key === 'sat' || key === 'color' ? 1 : 0;
  updateTerrainTint();
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

// ---------- Terreno lejano: Marte alrededor del recorte de 20 m ----------
// El DTM detallado solo cubre la zona de la ruta (~19 × 9,5 km). Alrededor se pone el relieve
// MOLA de 463 m/px (~280 × 280 km) con la imagen CTX regional, para que no se vea el borde:
//  · junto al borde, MOLA se corrige para coincidir con el DTM de 20 m y la corrección se
//    desvanece en ~3 km (no hay escalón);
//  · debajo del recorte no se dibuja (agujero): solo queda una franja de enlace en el borde, hundida
//    unos metros, y el terreno detallado lleva un faldón vertical que cubre cualquier rendija;
//  · a lo lejos baja con la curvatura de Marte (a 130 km, ~2,5 km), que hace de horizonte.
const MARS_R = 3389500;
const FAR = { segments: 420, blend_m: 3000, sink_m: 30, bias_m: -5 }; // bias: mediana CTX − MOLA en la zona común

// Faldón del terreno detallado: pared de 25 m hacia abajo a lo largo de todo el borde
{
  const cols = segX + 1;
  const ring = [];
  for (let i = 0; i <= segX; i++) ring.push(i); // norte, de oeste a este
  for (let j = 1; j <= segY; j++) ring.push(j * cols + segX); // este, de norte a sur
  for (let i = segX - 1; i >= 0; i--) ring.push(segY * cols + i); // sur, de este a oeste
  for (let j = segY - 1; j >= 0; j--) ring.push(j * cols); // oeste, de sur a norte
  const P = geo.attributes.position;
  const UV = geo.attributes.uv;
  const n = ring.length;
  const sp = new Float32Array(n * 2 * 3);
  const su = new Float32Array(n * 2 * 2);
  ring.forEach((k, r) => {
    for (const [d, dy] of [[0, 0], [1, -25]]) {
      const o = r * 2 + d;
      sp[o * 3] = P.getX(k);
      sp[o * 3 + 1] = P.getY(k) + dy;
      sp[o * 3 + 2] = P.getZ(k);
      su[o * 2] = UV.getX(k);
      su[o * 2 + 1] = UV.getY(k);
    }
  });
  const idx = [];
  for (let r = 0; r < n - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('uv', new THREE.BufferAttribute(su, 2));
  sg.setIndex(idx);
  // Normales hacia arriba: el faldón se ilumina como el suelo del borde y no se ve como una línea oscura
  sg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 2 * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  const skirt = new THREE.Mesh(sg, terrain.material);
  world.add(skirt);
}

// Se resuelve cuando termina de cargar la imagen del terreno detallado (al final del módulo)
let resolveTextureDone;
const textureDone = new Promise((res) => { resolveTextureDone = res; });
function canvasStats(src, sx, sy, sw, sh) {
  const S = 96;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g2 = c.getContext('2d');
  g2.drawImage(src, sx, sy, sw, sh, 0, 0, S, S);
  const d = g2.getImageData(0, 0, S, S).data;
  let m = 0;
  let m2 = 0;
  for (let i = 0; i < d.length; i += 4) { m += d[i]; m2 += d[i] * d[i]; }
  m /= S * S;
  return { m, sd: Math.sqrt(Math.max(1, m2 / (S * S) - m * m)) };
}
// Ajusta el lienzo (ctx) para que, en la zona [x, y, w, h] que coincide con el terreno detallado,
// tenga su misma media y contraste.
function toneMatch(ctx, canvas, [x, y, w, h]) {
  const near = canvasStats(texCanvas, 0, 0, texW, texH);
  const here = canvasStats(canvas, x, y, w, h);
  const k = Math.min(1.6, Math.max(0.6, near.sd / here.sd));
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, near.m + (d[i + c] - here.m) * k));
  }
  ctx.putImageData(img, 0, 0);
}
// Entorno desenfocado: lejos del recorte se emborrona, pierde color y se oscurece (da contexto sin
// quitar protagonismo a la zona de la ruta). 0 = todo nítido.
const farFocus = { value: 1 };
const farMat = new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
const farTerrain = (async () => {
  const far = await loadDem('data/jezero/dem_mola_463m');
  const molaAt = (lon, lat) => far.at(lon, lat) + FAR.bias_m;
  const cx = toLocal((far.west + far.east) / 2, (far.north + far.south) / 2, 0);
  const wM = (far.east - far.west) * cosLat * M_PER_DEG;
  const hM = (far.north - far.south) * M_PER_DEG;
  const g = new THREE.PlaneGeometry(wM, hM, FAR.segments, FAR.segments);
  g.rotateX(-Math.PI / 2);
  g.translate(cx.x, 0, cx.z);
  const P = g.attributes.position;
  const mLon = cosLat * M_PER_DEG;
  const inside = new Uint8Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const lon = lonC + P.getX(i) / mLon;
    const lat = latC - P.getZ(i) / M_PER_DEG;
    const lonK = Math.min(ext.east, Math.max(ext.west, lon));
    const latK = Math.min(ext.north, Math.max(ext.south, lat));
    const dOut = Math.hypot((lon - lonK) * mLon, (lat - latK) * M_PER_DEG);
    let h;
    if (dOut === 0) {
      // Dentro del recorte: igual que el DTM en el borde y hundido hacia dentro
      inside[i] = 1;
      h = terrainAt(lon, lat) - FAR.sink_m;
    } else {
      const delta = terrainAt(lonK, latK) - molaAt(lonK, latK);
      h = molaAt(lon, lat) + delta * Math.exp(-dOut / FAR.blend_m) - (dOut * dOut) / (2 * MARS_R);
    }
    P.setY(i, h - elevRef);
  }
  // Agujero: fuera los triángulos con los tres vértices dentro del recorte detallado
  const index = g.index.array;
  const keep = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    if (!(inside[a] && inside[b] && inside[c])) keep.push(a, b, c);
  }
  // Costura: los vértices de la franja de enlace que caen dentro del recorte se llevan al borde más
  // cercano, a la altura del DTM de 20 m (1 m por debajo), para que no quede escalón.
  const xW = toLocal(ext.west, latC, 0).x;
  const xE = toLocal(ext.east, latC, 0).x;
  const zN = toLocal(lonC, ext.north, 0).z;
  const zS = toLocal(lonC, ext.south, 0).z;
  for (const i of new Set(keep)) {
    if (!inside[i]) continue;
    let x = P.getX(i);
    let z = P.getZ(i);
    const opts = [[x - xW, 'x', xW], [xE - x, 'x', xE], [z - zN, 'z', zN], [zS - z, 'z', zS]];
    const [, axis, v] = opts.reduce((m, o) => (o[0] < m[0] ? o : m));
    if (axis === 'x') x = v; else z = v;
    P.setX(i, x);
    P.setZ(i, z);
    P.setY(i, terrainAt(lonC + x / mLon, latC - z / M_PER_DEG) - elevRef - 1);
  }
  g.setIndex(keep);
  g.computeVertexNormals();

  // Imagen: Viking (en gris) de fondo y el mosaico CTX regional encima
  const e = { west: far.west, east: far.east, north: far.north, south: far.south };
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const cg = canvas.getContext('2d');
  cg.fillStyle = '#6f6458';
  cg.fillRect(0, 0, 2048, 2048);
  const map = makeTexture(canvas);
  // Empujado un poco hacia atrás en profundidad: donde coincide con el terreno detallado, gana el detallado
  const mesh = new THREE.Mesh(g, farMat);
  farMat.map = map;
  farMat.needsUpdate = true;
  mesh.renderOrder = -1;
  world.add(mesh);
  const prog = { done: 0, total: 0 };
  const redraw = () => { map.needsUpdate = true; };
  cg.filter = 'grayscale(1) brightness(0.95) contrast(1.15)';
  await drawMosaic({ ...VIKING, z: 7 }, e, cg, { onTile: redraw, prog });
  cg.filter = 'none';
  // El mosaico CTX regional es preliminar y tiene franjas sin datos (negro) entre pasadas:
  // se pinta aparte y solo se copian sus píxeles con dato; en las franjas queda Viking.
  const w = SITE.tiles.ctxWide;
  const ctxCanvas = document.createElement('canvas');
  ctxCanvas.width = 2048;
  ctxCanvas.height = 2048;
  const xg = ctxCanvas.getContext('2d');
  await drawMosaic({ layer: w.layer, ext: w.ext, z: 9, bounds: w.bounds }, e, xg, { prog });
  const base = cg.getImageData(0, 0, 2048, 2048);
  const top = xg.getImageData(0, 0, 2048, 2048).data;
  const bd = base.data;
  for (let i = 0; i < bd.length; i += 4) {
    if (top[i + 3] > 200 && top[i] + top[i + 1] + top[i + 2] > 18) {
      bd[i] = top[i];
      bd[i + 1] = top[i + 1];
      bd[i + 2] = top[i + 2];
    }
  }
  cg.putImageData(base, 0, 0);

  // Anillo intermedio: el mismo mosaico CTX de 6 m que lleva de base el terreno detallado, en una
  // segunda textura que el sombreador usa dentro de sus límites (con fundido en los bordes).
  const mb = SITE.tiles.ctx.bounds;
  const midCanvas = document.createElement('canvas');
  midCanvas.width = 2048;
  midCanvas.height = 2048;
  const mg = midCanvas.getContext('2d');
  mg.fillStyle = '#6f6458';
  mg.fillRect(0, 0, 2048, 2048);
  const midMap = makeTexture(midCanvas);
  const midUni = {
    uMid: { value: midMap },
    uMidOff: { value: new THREE.Vector2((mb.west - e.west) / (e.east - e.west), (mb.south - e.south) / (e.north - e.south)) },
    uMidScale: { value: new THREE.Vector2((e.east - e.west) / (mb.east - mb.west), (e.north - e.south) / (mb.north - mb.south)) },
    // Recorte detallado en coordenadas de textura del terreno lejano, y su tamaño en metros
    uCropMin: { value: new THREE.Vector2((ext.west - e.west) / (e.east - e.west), (ext.south - e.south) / (e.north - e.south)) },
    uCropMax: { value: new THREE.Vector2((ext.east - e.west) / (e.east - e.west), (ext.north - e.south) / (e.north - e.south)) },
    uCropSize: { value: new THREE.Vector2(widthM, heightM) },
    uFocus: farFocus,
  };
  farMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, midUni);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMid;
uniform vec2 uMidOff;
uniform vec2 uMidScale;
uniform vec2 uCropMin;
uniform vec2 uCropMax;
uniform vec2 uCropSize;
uniform float uFocus;`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
{
  // Distancia (m) al recorte detallado: modo "enfoque" = desenfoque, menos color y más oscuro al alejarse
  vec2 cu = (vMapUv - uCropMin) / (uCropMax - uCropMin);
  float dist = length(max(max(-cu, cu - 1.0), 0.0) * uCropSize);
  float f = uFocus * smoothstep(0.0, 2500.0, dist);
  vec4 sampledDiffuseColor = texture2D(map, vMapUv, f * 4.5);
  diffuseColor *= sampledDiffuseColor;
  vec2 m = (vMapUv - uMidOff) * uMidScale;
  vec2 edge = min(m, 1.0 - m);
  float k = smoothstep(0.0, 0.04, min(edge.x, edge.y));
  if (k > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uMid, m, f * 4.5).rgb * diffuse, k);
  float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gray) * 0.3, f * 0.9);
}
#endif`);
  };
  farMat.customProgramCacheKey = () => 'far-terrain';
  farMat.needsUpdate = true;
  const midDone = drawMosaic({ layer: SITE.tiles.ctx.layer, ext: SITE.tiles.ctx.ext, z: 11, bounds: mb }, { ...mb }, mg, {
    onTile: () => { midMap.needsUpdate = true; }, prog,
  });
  // Mismo tono que el terreno detallado (zona común), cuando ambas imágenes han terminado
  Promise.all([midDone, textureDone]).then(() => {
    const u0 = ((ext.west - mb.west) / (mb.east - mb.west)) * 2048;
    const v0 = ((mb.north - ext.north) / (mb.north - mb.south)) * 2048;
    const uw = ((ext.east - ext.west) / (mb.east - mb.west)) * 2048;
    const vh = ((ext.north - ext.south) / (mb.north - mb.south)) * 2048;
    toneMatch(mg, midCanvas, [u0, v0, uw, vh]);
    midMap.needsUpdate = true;
  });
  // Mismo tono que el terreno detallado (se compara la zona común); se repite cuando acaba de
  // cargar la imagen detallada, que llega más tarde.
  const original = cg.getImageData(0, 0, 2048, 2048);
  const matchTone = () => {
    const S = 96;
    const stats = (src, sx, sy, sw, sh) => {
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const g2 = c.getContext('2d');
      g2.drawImage(src, sx, sy, sw, sh, 0, 0, S, S);
      const d = g2.getImageData(0, 0, S, S).data;
      let m = 0;
      let m2 = 0;
      for (let i = 0; i < d.length; i += 4) { m += d[i]; m2 += d[i] * d[i]; }
      m /= S * S;
      return { m, sd: Math.sqrt(Math.max(1, m2 / (S * S) - m * m)) };
    };
    const u0 = ((ext.west - e.west) / (e.east - e.west)) * 2048;
    const v0 = ((e.north - ext.north) / (e.north - e.south)) * 2048;
    const uw = ((ext.east - ext.west) / (e.east - e.west)) * 2048;
    const vh = ((ext.north - ext.south) / (e.north - e.south)) * 2048;
    const near = stats(texCanvas, 0, 0, texW, texH);
    cg.putImageData(original, 0, 0);
    const farS = stats(canvas, u0, v0, uw, vh);
    const k = Math.min(1.6, Math.max(0.6, near.sd / farS.sd));
    const img = cg.getImageData(0, 0, 2048, 2048);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, near.m + (d[i + c] - farS.m) * k));
    }
    cg.putImageData(img, 0, 0);
    map.needsUpdate = true;
  };
  matchTone();
  textureDone.then(matchTone);
  return mesh;
})().catch((err) => { console.warn('Terreno lejano no disponible:', err); return null; });

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

// ---------- Zona de estudio: contorno del DTM de 20 m sobre el relieve ----------
// Fuera de este rectángulo el relieve es MOLA (463 m) y la imagen se desenfoca y apaga.
const zone = (() => {
  const hw = widthM / 2 - 1;
  const hh = heightM / 2 - 1;
  const groundAt = (x, z) => {
    const h = terrainAt(lonC + x / (cosLat * M_PER_DEG), latC - z / M_PER_DEG);
    return Number.isFinite(h) ? h - elevRef : 0;
  };
  const p = [];
  const edge = (x0, z0, x1, z1) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 40));
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      p.push(x, groundAt(x, z) + 30, z); // 30 m: la malla general es más gruesa que el DTM
    }
  };
  edge(-hw, -hh, hw, -hh);
  edge(hw, -hh, hw, hh);
  edge(hw, hh, -hw, hh);
  edge(-hw, hh, -hw, -hh);
  p.push(p[0], p[1], p[2]);
  const g = new THREE.Group();
  const lineGeo = new LineGeometry();
  lineGeo.setPositions(p);
  // Halo sin escritura de profundidad y dibujado antes: si no, las dos líneas se pelean y salen a trazos
  const halo = new LineMaterial({ color: '#000000', linewidth: 5, transparent: true, opacity: 0.5, depthWrite: false });
  const line = new LineMaterial({ color: '#f2f4f7', linewidth: 1.6, transparent: true, opacity: 0.95, depthWrite: false });
  const haloLine = new Line2(lineGeo, halo);
  const mainLine = new Line2(lineGeo, line);
  haloLine.renderOrder = 1;
  mainLine.renderOrder = 2;
  g.add(haloLine, mainLine);
  world.add(g);
  const label = document.createElement('div');
  label.className = 'zone-label';
  const km = (m) => (m / 1000).toFixed(1).replace('.', ',');
  label.innerHTML = `<b>Zona de estudio</b><span>Relieve DTM 20 m · ${km(widthM)} × ${km(heightM)} km</span>`;
  host.append(label);
  return { group: g, mats: [halo, line], label, corner: new THREE.Vector3(0, groundAt(0, hh) + 30, hh) };
})();

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
routeLines.forEach((l) => { l.visible = false; });
rover.visible = false;
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
  ['overview', 'drive', 'pov'].forEach((b) => $(b).setAttribute('aria-pressed', String(b === id)));
}

function setAstroMode(on, { showBeacon = true } = {}) {
  state.astro = on;
  beacon.visible = on && showBeacon;
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
  if (camera.view) camera.setViewOffset(w, h, -viewShift, 0, w, h);
  camera.updateProjectionMatrix();
  routeMat.resolution.set(w, h);
  doneMat.resolution.set(w, h);
  zone.mats.forEach((m) => m.resolution.set(w, h));
}
new ResizeObserver(resize).observe(host);
resize();

// Punto a seguir: el vehículo de "Mi ruta" o la parada actual de Perseverance
function focusPoint() {
  if (planDock) {
    const s = planDock.sample;
    return worldPoint(s.lon, s.lat);
  }
  const p = pts[state.idx];
  return worldPoint(p.lon, p.lat);
}

function overview() {
  exitDrive();
  setAstroMode(false);
  setViewButton('overview');
  const target = focusPoint();
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(1800, 2400 * Math.max(1, state.exag / 2), 3200));
  controls.update();
}

// Posición de los ojos de un astronauta en la parada i, mirando hacia la siguiente.
// (La usa el tour guiado; el botón Astronauta usa la vista a ras de suelo común con coche y POV.)
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
  exitDrive();
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
    else if (state.follow && !state.playing) {
      const delta = rover.position.clone().sub(prevTarget);
      camera.position.add(delta);
      controls.target.add(delta);
    }
  }
  if (planDock) renderMissionPanel(); else { renderStop(p, i); renderPhotos(p.sol); }
}

function renderPhotos(sol) {
  renderPhotos.show ??= createPhotos($('photos'), $('photos-status'), {
    onLoad: (list, s) => {
      heroPhoto = { sol: s, url: list[0].url, cam: list[0].cam };
      if (!planDock && pts[state.idx].sol === s) renderStopHero(pts[state.idx], state.idx);
    },
  });
  $('photos-sec').hidden = false;
  return renderPhotos.show(sol, { paused: !!state.playing });
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

// ---------- Cabecera de la ficha (hero.js) ----------
let heroPhoto = null;
const renderHero = (opts) => paintHero($('insp-hero'), opts);
const renderStopHero = (p, i) => paintStopHero($('insp-hero'), p, i, pts, heroPhoto);

function renderStop(p, i) {
  renderStopHero(p, i);
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
    renderPhotos(pts[state.idx].sol);
    return;
  }
  if (state.idx >= pts.length - 1) select(0);
  setPlayButton(btn, true);
  state.playing = setInterval(() => {
    if (state.idx >= pts.length - 1) return togglePlay();
    select(state.idx + 1);
  }, state.drive ? 900 : 110); // conduciendo, una parada por segundo
}

// ---------- Ruta planificada (viene del planificador del mapa 2D) ----------
const savedPlan = loadPlan();
const plan = savedPlan?.vehicleKey === 'sev' && savedPlan.latlngs?.length ? savedPlan : await loadJson('data/jezero/default-plan.json');
renderPlanStats($('stats'), plan);
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

// "Recorrido": qué ruta siguen todas las vistas y el play.
function renderRouteSwitch() {}
function setRoute(kind) {
  if (kind === 'plan') {
    if (!plan) { location.href = 'index.html#plan'; return; }
    if (!planDock) enterPlanMode();
  } else if (planDock) {
    exitPlanMode();
  }
}

function renderPlanPanel() {
  const sec = $('plan-sec');
  renderRouteSwitch();
  if (!plan || !planDock) { sec.hidden = true; return; }
  sec.hidden = false;
  sec.innerHTML = `<p class="plan-sum"><b>${plan.labels.join(' · ')}</b> · ${plan.vehicleName}</p>
    <div class="btn-row plan-btns">
      <button class="btn primary plan-play" type="button" data-plan="play">Reproducir</button>
      <button class="btn" type="button" data-plan="frame">Encuadrar</button>
      <a class="btn" href="index.html#plan">Editar en el mapa</a>
    </div>`;
}

// ---------- Informe de misión de "Mi ruta" ----------
// Con "Mi ruta" activa, el panel derecho deja de mostrar la parada de Perseverance y pasa a la
// telemetría de la misión (se actualiza durante la reproducción) y al informe GO / PRECAUCIÓN / NO-GO.
let missionCache = null;
function mission() {
  if (!plan) return null;
  const key = coldData ? 'cold' : 'nocold';
  if (missionCache?.key === key) return missionCache.r;
  const rad = radiationGrid();
  const r = missionReport(plan, {
    doseAt: (lon, lat) => rad.at(lon, lat),
    coldAt: (lon, lat) => {
      if (!coldData) return null;
      const [fx, fy] = toPixel(lon, lat);
      const k = Math.round(fy) * demW + Math.round(fx);
      return coldData.warmerThan[coldData.gray[k] ?? 0];
    },
  });
  missionCache = { key, r };
  return r;
}

// Valores de la misión en el instante s del reproductor
function liveNumbers(s) {
  const r = mission();
  const v = plan.vehicle;
  const H = plan.hours;
  const i = Math.min(s.seg, H.length - 2);
  const span = H[i + 1] - H[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (s.t - H[i]) / span)) : 0;
  const k = s.t / (H.at(-1) || 1);
  return {
    dose: r.cumDose[i] + (r.cumDose[i + 1] - r.cumDose[i]) * f,
    doseFrac: r.dose ? (r.cumDose[i] + (r.cumDose[i + 1] - r.cumDose[i]) * f) / r.dose : 0,
    autoLeft: v.maxHours ? Math.max(0, v.maxHours - s.t) : null,
    autoFrac: v.maxHours ? Math.max(0, 1 - s.t / v.maxHours) : null,
    battery: r.batteryUse !== null ? Math.max(0, 1 - r.batteryUse * k) : null, // aprox.: gasto proporcional al tiempo
    slope: plan.slope[s.idx] ?? 0,
  };
}

const levelOf = (frac) => (frac < 0.25 ? 'bad' : frac < 0.5 ? 'warn' : 'ok');
function liveRow(label, value, frac, cls) {
  return `<div class="live-row"><span>${label}</span><b>${value}</b>
    <em><i class="lv-${cls}" style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></em></div>`;
}
function renderPlanPoint(s) {
  const el = document.getElementById('plan-point');
  if (!el) return;
  const rep = mission();
  const sat = satAt(s.lon, s.lat);
  renderHero({
    img: sat.css,
    caption: `${sat.caption} · posición actual`,
    title: 'Mi ruta',
    meta: `${plan.labels.join(' · ')} · ${plan.vehicleName}`,
    meta2: `${clock(s.t)} · ${latLon({ lat: s.lat, lon: s.lon })}`,
    status: { cls: ['ok', 'warn', 'bad'][rep.level], text: rep.verdict },
    from: 'A · origen',
    to: 'B · destino',
    frac: s.dist / (plan.dist.at(-1) || 1),
    left: `${fmt.km(s.dist)} de ${fmt.km(plan.dist.at(-1))}`,
    right: `llegada en ${formatHours(Math.max(0, plan.hours.at(-1) - s.t))}`,
  });
  const slope = plan.slope[s.idx] ?? 0;
  const cls = tiltClass(slope);
  const total = plan.dist.at(-1);
  const [fx, fy] = toPixel(s.lon, s.lat);
  const k = Math.round(fy) * demW + Math.round(fx);
  const coldPct = coldData ? Math.round(coldData.warmerThan[coldData.gray[k] ?? 0] * 100) : null;
  const rad = radiationGrid();
  const dose = rad.at(s.lon, s.lat);
  const pct = ((dose - rad.min) / (rad.max - rad.min || 1)) * 100;
  const left = Math.max(0, plan.hours.at(-1) - s.t);
  el.innerHTML = `
    <header class="insp-head">
      <div class="insp-top"><div class="insp-sol"><small>T+</small>${clock(s.t).slice(2)}</div></div>
      <div class="insp-meta">Mi ruta · ${plan.vehicleName}</div>
      <div class="insp-meta">${latLon({ lat: s.lat, lon: s.lon })}</div>
    </header>
    <div class="metrics">
      ${metricHTML({ k: 'Elevación', v: num(s.elev), unit: 'm', sub: 'DTM CTX 20 m' })}
      ${metricHTML({ k: 'Recorrido', v: num(s.dist / 1000, 2), unit: 'km', sub: `de ${fmt.km(total)}` })}
      ${metricHTML({ k: 'Pendiente terreno', v: num(slope, 1), unit: '°', sub: `límite ${num(plan.vehicle.maxSlope)}°`, cls })}
      ${metricHTML({ k: 'Llegada en', v: formatHours(left), unit: '', sub: `de ${formatHours(plan.hours.at(-1))}` })}
      ${metricHTML({
        k: 'Frío nocturno',
        v: coldPct === null ? '…' : `${coldPct}`,
        unit: coldPct === null ? '' : '%',
        sub: coldPct === null ? 'cargando THEMIS' : `más frío que el ${coldPct} % de la zona`,
      })}
      ${metricHTML({
        k: 'Radiación est.',
        v: num(dose, 2),
        unit: 'mSv/día',
        sub: 'modelo · ver capa',
        extra: `<div class="meter"><i style="width:${pct}%;background:${rgbCss(rampRgb(RAD_RAMP, pct / 100))}"></i></div>`,
      })}
    </div>`;
}
function updateLive(s) {
  const el = document.getElementById('live');
  if (!el || !s || !planDock) return;
  renderPlanPoint(s);
  const L = liveNumbers(s);
  const rows = [];
  if (L.autoLeft !== null) rows.push(liveRow('Autonomía restante', formatHours(L.autoLeft), L.autoFrac, levelOf(L.autoFrac)));
  if (L.battery !== null) rows.push(liveRow('Batería (aprox.)', `${num(L.battery * 100)} %`, L.battery, levelOf(L.battery)));
  rows.push(liveRow('Dosis acumulada', `${num(L.dose, 3)} mSv`, L.doseFrac, 'accent'));
  el.innerHTML = `<div class="live-head"><span>Telemetría de la misión</span><b class="mono">${clock(s.t)}</b></div>${rows.join('')}`;
}
function renderMissionPanel() {
  if (!planDock) return;
  $('inspector').innerHTML = `<div id="plan-point"></div><div class="live" id="live"></div>${reportHTML(plan, mission())}`;
  $('photos-sec').hidden = true; // las fotos son de las paradas de Perseverance
  updateLive(planDock.sample);
}

// Parte de llegada al terminar la reproducción
let arrivalArmed = false;
let liveT = 0;
function showArrival() {
  document.querySelector('.arrival-wrap')?.remove();
  const w = document.createElement('div');
  w.className = 'arrival-wrap';
  w.innerHTML = arrivalHTML(plan, mission());
  w.addEventListener('click', (e) => {
    if (e.target === w || e.target.closest('[data-arrival-close]')) w.remove();
  });
  document.querySelector('.stage').appendChild(w);
  w.querySelector('[data-arrival-close]')?.focus();
}
function onPlanState(playing) {
  if (playing) {
    arrivalArmed = true;
    document.querySelector('.arrival-wrap')?.remove();
  } else if (arrivalArmed && planDock && planDock.player.t >= planDock.player.total) {
    arrivalArmed = false;
    showArrival();
  }
}

function enterPlanMode() {
  if (!plan) return;
  if (state.playing) togglePlay(); // pausa la ruta de Perseverance
  planViz.setVisible(true);
  planViz.refresh();
  $('profile-wrap').hidden = true;
  $('plan-profile-wrap').hidden = false;
  document.querySelector('.dock').classList.add('plan-mode');
  planDock = mountPlanDock({
    wrap: $('plan-profile-wrap'),
    route: plan,
    colorAt: (p) => COLORS[tiltClass(p.slope)],
    playBtn: $('play'),
    labelEl: $('slider-label'),
    subEl: $('readout-sub'),
    onState: onPlanState,
    onSample(s) {
      const now = performance.now();
      if (now - liveT > 250) { liveT = now; updateLive(s); }
      const v = worldPoint(s.lon, s.lat, ROUTE_LIFT_M * state.exag);
      planViz.vehicle.position.copy(v);
      planViz.done.instanceCount = s.seg;
    },
  });
  $('to-other-view').href = 'index.html#plan';
  history.replaceState(null, '', '#plan');
  renderPlanPanel();
  renderMissionPanel();
  if (state.drive) {
    // A ras de suelo se sigue en la misma vista, ahora sobre la ruta planificada
    planViz.setVisible(false);
    drive.pos = null;
    drive.s = null;
    drive.snapCam = true;
    drive.rate = null;
    applyDriveRate();
  } else {
    frameRoute();
  }
}

function exitPlanMode() {
  arrivalArmed = false;
  document.querySelector('.arrival-wrap')?.remove();
  planDock?.destroy();
  planDock = null;
  planViz?.setVisible(false);
  $('profile-wrap').hidden = false;
  $('plan-profile-wrap').hidden = true;
  document.querySelector('.dock').classList.remove('plan-mode');
  setPlayButton($('play'), false);
  renderPlanPanel();
  select(state.idx, { moveCamera: false });
  if (state.drive) {
    drive.pos = null;
    drive.s = null;
    drive.snapCam = true;
  }
}

$('plan-sec').addEventListener('click', (e) => {
  const act = e.target.closest('[data-plan]')?.dataset.plan;
  if (act === 'frame') { overview(); frameRoute(); }
  else if (act === 'play') planDock?.player.toggle();
});

// ---------- Vistas a ras de suelo: astronauta, coche y POV (rover 3D) ----------
// El modelo oficial de NASA se carga solo al entrar en estas vistas (11,7 MB).
let roverRig = null;
let roverLoading = null;
let roverModule = null;
const drive = {
  mode: null, pos: null, yaw: 0, steer: 0, lastT: null, prevExag: 2, look: new THREE.Vector3(),
  snapCam: true, patch: null, patchBusy: false, hudT: 0, lastSample: null, speedKmh: 0, rate: null,
  base: new THREE.Vector3(), view: { yaw: 0, pitch: 0, dist: 8.2 }, dragging: false, token: 0,
  ribbonAt: null, progress: 0, pathTotal: 0, s: null, ss: 0, pathKey: null, camYaw: 0, camLift: 0, povQ: new THREE.Quaternion(),
  vis: 0, cine: null,
};
const sceneToLonLat = (x, z) => [lonC + x / (cosLat * M_PER_DEG), latC - z / M_PER_DEG];
const groundAt = (x, z) => {
  const [lon, lat] = sceneToLonLat(x, z);
  return (terrainAt(lon, lat) - elevRef) * state.exag;
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// El parche de suelo detallado interpola el relieve de forma suave (bilineal) y la malla general por
// triángulos de 20 m: difieren unos decímetros. Parche y rover van 35 cm por encima para que la malla
// general nunca asome por encima del suelo detallado.
const GROUND_LIFT = 0.35;
const driveGround = (x, z) => groundAt(x, z) + GROUND_LIFT;
// Altura del suelo a escala real (exageración 1), sea cual sea la exageración actual: los parches de suelo
// se construyen así para poder prepararlos desde la vista general (que va a ×2).
const groundAt1 = (x, z) => {
  const [lon, lat] = sceneToLonLat(x, z);
  return terrainAt(lon, lat) - elevRef;
};
// Efectos a ras de suelo (fx.js): polvo de las ruedas y huellas
const dust = createDust(scene);
const tracks = createTracks(scene);
dust.visible = false;
tracks.visible = false;
const wheelTmp = Array.from({ length: 4 }, () => new THREE.Vector3());
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun.target);
const SUN_DIR = sun.position.clone().normalize();

async function ensureRover({ quiet = false } = {}) {
  if (roverRig) return roverRig;
  const chip = $('tex-status');
  if (!quiet) chip.textContent = 'Cargando el modelo de Perseverance (NASA)…';
  roverLoading ??= (async () => {
    roverModule ??= await import('./rover.js');
    const rig = await roverModule.loadRover('assets/rover/perseverance.glb', (k) => {
      if (chip.textContent) chip.textContent = `Cargando el modelo de Perseverance (NASA)… ${Math.round(k * 100)} %`;
    });
    rig.root.visible = false;
    scene.add(rig.root);
    return rig;
  })();
  roverRig = await roverLoading;
  chip.textContent = '';
  return roverRig;
}

// ---- Trayectoria ----
// Ruta activa: polilínea original (raw) y una versión suavizada por la que circula el vehículo.
// La ruta del planificador sale de una rejilla de 20 m (8 direcciones) y la de Perseverance une paradas
// con tramos rectos: seguidas tal cual, el rover iría a trompicones con giros en seco.
const pathCache = {};
const PATH_STEP = 2; // m entre muestras de la trayectoria suavizada
function polyline(ll) {
  const n = ll.length;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const cum = new Float64Array(n);
  ll.forEach(([lon, lat], i) => {
    const v = toLocal(lon, lat, 0);
    x[i] = v.x;
    z[i] = v.z;
    if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  });
  return { x, z, cum, n, total: cum[n - 1] };
}
function activePath() {
  const key = planDock ? 'plan' : 'perse';
  if (pathCache[key]) return pathCache[key];
  const raw = polyline(planDock ? plan.latlngs.map(([lat, lon]) => [lon, lat]) : pts.map((p) => [p.lon, p.lat]));
  // Remuestreo cada 2 m y media gaussiana (σ ≈ 12 m en la ruta planificada, 5 m en la de Perseverance,
  // que tiene giros reales). Los extremos se quedan fijos.
  const m = Math.max(2, Math.ceil(raw.total / PATH_STEP) + 1);
  const rx = new Float64Array(m);
  const rz = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const p = pathAt(raw, Math.min(raw.total, i * PATH_STEP));
    rx[i] = p.x;
    rz[i] = p.z;
  }
  const sigma = (planDock ? 12 : 5) / PATH_STEP;
  const W = Math.ceil(sigma * 2.5);
  const wts = Array.from({ length: W + 1 }, (_, k) => Math.exp(-(k * k) / (2 * sigma * sigma)));
  const x = new Float64Array(m);
  const z = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const w = Math.min(W, i, m - 1 - i);
    let sx = 0;
    let sz = 0;
    let sw = 0;
    for (let k = -w; k <= w; k++) {
      const q = wts[Math.abs(k)];
      sx += rx[i + k] * q;
      sz += rz[i + k] * q;
      sw += q;
    }
    x[i] = sx / sw;
    z[i] = sz / sw;
  }
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  pathCache[key] = { key, raw, x, z, cum, n: m, total: cum[m - 1] };
  return pathCache[key];
}
// Distancia sobre la ruta original → distancia sobre la suavizada (misma muestra, índice = d / 2 m).
function rawToSmooth(P, d) {
  const f = Math.max(0, Math.min(P.n - 1, d / PATH_STEP));
  const i = Math.min(P.n - 2, Math.floor(f));
  return P.cum[i] + (P.cum[i + 1] - P.cum[i]) * (f - i);
}
// Distancia recorrida sobre la polilínea del punto (px, pz), buscando cerca del tramo `hint`.
function pathProgress(L, px, pz, hint) {
  let best = Infinity;
  let bs = 0;
  const lo = Math.max(0, hint - 8);
  const hi = Math.min(L.n - 2, hint + 8);
  for (let i = lo; i <= hi; i++) {
    const ax = L.x[i];
    const az = L.z[i];
    const sx = L.x[i + 1] - ax;
    const sz = L.z[i + 1] - az;
    const L2 = sx * sx + sz * sz;
    const f = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * sx + (pz - az) * sz) / L2)) : 0;
    const d = Math.hypot(ax + sx * f - px, az + sz * f - pz);
    if (d < best) { best = d; bs = L.cum[i] + f * Math.sqrt(L2); }
  }
  return bs;
}
function pathAt(L, s) {
  s = Math.max(0, Math.min(L.total, s));
  let lo = 0;
  let hi = L.n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (L.cum[mid] <= s) lo = mid; else hi = mid;
  }
  const len = L.cum[hi] - L.cum[lo];
  const f = len > 0 ? (s - L.cum[lo]) / len : 0;
  return { x: L.x[lo] + (L.x[hi] - L.x[lo]) * f, z: L.z[lo] + (L.z[hi] - L.z[lo]) * f };
}
const yawAlong = (P, s, back, ahead) => {
  const a = pathAt(P, s - back);
  const b = pathAt(P, s + ahead);
  return Math.hypot(b.x - a.x, b.z - a.z) > 0.2 ? Math.atan2(b.x - a.x, b.z - a.z) : null;
};

// ---- Movimiento a ras de suelo ----
function driveFrame(t) {
  if (!drive.mode) return;
  const rig = drive.mode === 'astro' ? null : roverRig;
  if (drive.mode !== 'astro' && !rig) return;
  const dt = drive.lastT === null ? 0 : Math.min(0.1, (t - drive.lastT) / 1000);
  drive.lastT = t;
  const P = activePath();
  const fresh = drive.pathKey !== P.key || drive.s === null;
  drive.pathKey = P.key;
  // Distancia recorrida sobre la ruta original: la marca el reproductor (Mi ruta) o la parada elegida (Perseverance)
  let target;
  if (planDock) {
    const smp = planDock.sample;
    const T = toLocal(smp.lon, smp.lat, 0);
    target = pathProgress(P.raw, T.x, T.z, smp.seg);
  } else {
    target = P.raw.cum[state.idx];
  }
  const prevS = drive.s;
  if (fresh || planDock || Math.abs(target - drive.s) > 3000) {
    drive.s = target;
  } else {
    // Va por la propia ruta hasta la parada elegida (llega en ~1 s aunque esté lejos)
    const d = target - drive.s;
    drive.s += Math.sign(d) * Math.min(Math.abs(d), Math.max(6, Math.abs(d)) * dt);
  }
  const jump = !fresh && Math.abs(drive.s - prevS) > 40; // salto al buscar en la barra de tiempo
  const ss = rawToSmooth(P, drive.s);
  const p = pathAt(P, ss);
  const ds = drive.pos ? Math.hypot(p.x - drive.pos.x, p.z - drive.pos.y) : 0;
  drive.pos ??= new THREE.Vector2();
  drive.pos.set(p.x, p.z);
  drive.ss = ss;
  drive.progress = drive.s;
  drive.pathTotal = P.raw.total;
  // Rumbo: tangente de la trayectoria suavizada; el astronauta mira algo más lejos
  const targetYaw = yawAlong(P, ss, 2, drive.mode === 'astro' ? 15 : 4) ?? drive.yaw;
  let dyaw;
  if (fresh || jump) {
    dyaw = 0;
    drive.yaw = targetYaw;
    drive.camYaw = targetYaw;
    drive.snapCam = true;
  } else {
    dyaw = wrapAngle(targetYaw - drive.yaw) * Math.min(1, dt * 5);
    drive.yaw = wrapAngle(drive.yaw + dyaw);
  }
  if (rig) {
    // Dirección: curvatura (giro por metro) → ángulo de las ruedas de esquina
    const steerWanted = ds > 0.01 && !jump ? Math.max(-0.5, Math.min(0.5, (dyaw / ds) * 1.1)) : drive.steer * 0.95;
    drive.steer += (steerWanted - drive.steer) * Math.min(1, dt * 6);
    // Las ruedas pisan un microrrelieve de ±4 cm (fx.js): la suspensión trabaja y el cuerpo se mueve
    rig.update({ heightAt: (x, z) => driveGround(x, z) + microRelief(x, z), x: p.x, z: p.z, yaw: drive.yaw, ds: jump ? 0 : ds, steer: drive.steer });
    // Vibración según la velocidad en pantalla (m/s): cabeceo, alabeo y un poco de rebote
    const vis = dt > 0 && !jump ? ds / dt : 0;
    drive.vis += (vis - drive.vis) * (1 - Math.exp(-dt * 4));
    const amp = Math.min(1, drive.vis / 6);
    const tt = t / 1000;
    rig.body.rotation.x += shake(tt, 1) * 0.007 * amp;
    rig.body.rotation.z += shake(tt, 2) * 0.006 * amp;
    rig.root.position.y += shake(tt, 3) * 0.012 * amp;
    drive.base.copy(rig.root.position);
    // Polvo de las ruedas traseras y centrales, y huellas de las centrales
    if (fresh || jump) { tracks.reset(); dust.reset(); }
    if (ds > 0.001 && !jump) {
      const W = roverModule.WHEELS;
      const c = Math.cos(drive.yaw);
      const sn = Math.sin(drive.yaw);
      const at = (v, mx, mz) => {
        const x = p.x + mx * c + mz * sn;
        const z = p.z - mx * sn + mz * c;
        return v.set(x, driveGround(x, z) + 0.03, z); // el parche de suelo ya va elevado GROUND_LIFT
      };
      at(wheelTmp[0], W.rear.x, W.rear.z);
      at(wheelTmp[1], -W.rear.x, W.rear.z);
      at(wheelTmp[2], W.mid.x, W.mid.z);
      at(wheelTmp[3], -W.mid.x, W.mid.z);
      dust.emit(wheelTmp, drive.vis, dt, { x: -sn, z: -c });
      tracks.add(wheelTmp[2], wheelTmp[3], drive.s);
    }
  } else {
    drive.base.set(p.x, driveGround(p.x, p.z), p.z);
  }
  if (planDock) {
    const smp = planDock.sample;
    const prev = drive.lastSample;
    if (prev && smp.t > prev.t) drive.speedKmh = ((smp.dist - prev.dist) / 1000) / (smp.t - prev.t);
    else if (!planDock.player.playing) drive.speedKmh = 0;
    drive.lastSample = smp;
  }
  updateDriveCamera(dt, t);
  dust.update(dt, host.clientHeight, camera.fov);
  updateShadow();
  updatePatch();
  updateRibbon();
  updateMinimap(P);
  if (t - drive.hudT > 250) { drive.hudT = t; renderHud(); }
}

// Cámaras a ras de suelo. drive.view guarda lo que el usuario ha girado con el ratón.
function updateDriveCamera(dt, t = performance.now()) {
  const base = drive.base;
  const amp = Math.min(1, drive.vis / 6);
  const tt = t / 1000;
  const v = drive.view;
  const lookDir = (yaw, pitch) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  if (drive.mode === 'chase') {
    // La cámara sigue un rumbo propio más lento que el del rover: en las curvas el rover gira primero
    // y la cámara le sigue sin dar bandazos.
    drive.camYaw = wrapAngle(drive.camYaw + wrapAngle(drive.yaw - drive.camYaw) * (1 - Math.exp(-dt * (drive.dragging ? 12 : 2))));
    // Posición enganchada al rover (no se queda atrás a ninguna velocidad); solo se suavizan el giro
    // y lo que la cámara tiene que subir para no meterse en el terreno.
    const a = drive.camYaw + Math.PI + v.yaw;
    const e = THREE.MathUtils.clamp(0.38 + v.pitch, 0.05, 1.45);
    const want = base.clone().addScaledVector(lookDir(a, e), v.dist);
    const lift = Math.max(0, groundAt(want.x, want.z) + 1.0 - want.y);
    drive.camLift = drive.snapCam ? lift : drive.camLift + (lift - drive.camLift) * (1 - Math.exp(-dt * 6));
    want.y += Math.max(lift * 0.6, drive.camLift);
    drive.snapCam = false;
    const fwd = new THREE.Vector3(Math.sin(drive.camYaw), 0, Math.cos(drive.camYaw));
    drive.look.copy(base).addScaledVector(fwd, 3 * Math.max(0, Math.cos(v.yaw)));
    drive.look.y += 1.0;
    // Temblor de cámara (como si fuera montada en el propio vehículo de apoyo)
    want.x += shake(tt, 5) * 0.03 * amp;
    want.y += shake(tt, 6) * 0.025 * amp;
    camera.up.set(0, 1, 0);
    if (drive.cine) {
      cineStep(want, dt);
    } else {
      camera.position.copy(want);
      camera.lookAt(drive.look);
    }
  } else if (drive.mode === 'pov') {
    // Navcam: la cámara va solidaria al cuerpo (cabecea y se ladea con él); el ratón gira el mástil.
    // La cabeza del mástil se oculta en esta vista (sería la propia cámara).
    // Se actualiza desde la raíz: si solo se actualizara el cuerpo, la cámara usaría la posición del
    // rover del fotograma anterior y, yendo rápido o al saltar en la barra, quedaría dentro de la cabeza.
    roverRig.root.updateMatrixWorld(true);
    const eye = roverModule.MAST_CAMERA.clone().applyMatrix4(roverRig.body.matrixWorld);
    const bodyQ = roverRig.body.getWorldQuaternion(new THREE.Quaternion());
    // La orientación se suaviza un poco: el relieve de 20 m cambia de pendiente de golpe en el borde
    // de cada celda y la cámara daría tirones. La posición no se suaviza (va siempre en el mástil).
    if (drive.snapCam) {
      drive.povQ.copy(bodyQ);
      drive.snapCam = false;
    } else {
      drive.povQ.slerp(bodyQ, 1 - Math.exp(-dt * 6));
    }
    const q = drive.povQ;
    const dir = lookDir(v.yaw + shake(tt, 7) * 0.003 * amp, -0.1 + v.pitch + shake(tt, 8) * 0.004 * amp).applyQuaternion(q);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    camera.lookAt(eye.clone().add(dir));
  } else {
    // Astronauta de pie sobre la ruta, mirando hacia donde avanza
    const eye = base.clone();
    eye.y += EYE_HEIGHT_M - 0.15;
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(eye.clone().add(lookDir(drive.yaw + v.yaw, -0.1 + v.pitch)));
  }
}

// Vuelo de entrada a la vista de coche: desde donde estuviera la cámara general, una curva que baja por
// detrás del rover hasta engancharse a la cámara de persecución. La niebla y el campo de visión pasan de
// los de la vista general a los de a ras de suelo durante el vuelo.
function cineStep(want, dt) {
  const c = drive.cine;
  c.t += dt;
  const k = Math.min(1, c.t / c.dur);
  const e = easeInOut(k);
  const back = new THREE.Vector3(-Math.sin(drive.camYaw), 0, -Math.cos(drive.camYaw));
  const ctrl = drive.base.clone().addScaledVector(back, c.reach);
  ctrl.y = Math.max(ctrl.y + c.reach * 0.35, groundAt(ctrl.x, ctrl.z) + 20);
  // Bézier cuadrática: origen → por detrás y por encima del rover → posición de persecución
  const u = 1 - e;
  camera.position.set(
    u * u * c.pos.x + 2 * u * e * ctrl.x + e * e * want.x,
    u * u * c.pos.y + 2 * u * e * ctrl.y + e * e * want.y,
    u * u * c.pos.z + 2 * u * e * ctrl.z + e * e * want.z,
  );
  const kl = 1 - (1 - k) ** 3; // la mirada llega antes al rover que la cámara
  camera.lookAt(c.look.clone().lerp(drive.look, kl));
  const lerpLog = (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * e);
  scene.fog.near = lerpLog(c.fog[0], 600);
  scene.fog.far = lerpLog(c.fog[1], 9000);
  camera.near = lerpLog(2, 0.1);
  camera.far = lerpLog(200000, 30000);
  camera.fov = c.fov + (GROUND_FOV.chase - c.fov) * e;
  camera.updateProjectionMatrix();
  if (k >= 1) {
    drive.cine = null;
    scene.fog.near = 600;
    scene.fog.far = 9000;
    c.done?.();
  }
}

function updateShadow() {
  const p = drive.base;
  sun.target.position.copy(p);
  sun.position.copy(p).addScaledVector(SUN_DIR, 80);
}

// --- Ratón a ras de suelo: arrastrar para mirar (o girar alrededor del rover), rueda para zoom ---
const GROUND_FOV = { astro: 65, chase: 55, pov: 70 };
function resetGroundView() {
  drive.view = { yaw: 0, pitch: 0, dist: 8.2 };
  camera.fov = GROUND_FOV[drive.mode] ?? 55;
  camera.updateProjectionMatrix();
}
{
  const dom = renderer.domElement;
  let drag = null;
  dom.addEventListener('pointerdown', (e) => {
    if (!drive.mode || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    drive.dragging = true;
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const v = drive.view;
    if (drive.mode === 'chase') {
      v.yaw -= dx * 0.006;
      v.pitch += dy * 0.005;
    } else {
      // Se "agarra" el paisaje, como en Street View; más fino con zoom
      const s = 0.0035 * (camera.fov / 60);
      v.yaw += dx * s;
      v.pitch = THREE.MathUtils.clamp(v.pitch + dy * s, -1.2, 1.1);
    }
  });
  const end = () => { drag = null; drive.dragging = false; };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);
  dom.addEventListener('wheel', (e) => {
    if (!drive.mode) return;
    e.preventDefault();
    if (drive.mode === 'chase') {
      drive.view.dist = THREE.MathUtils.clamp(drive.view.dist * Math.exp(e.deltaY * 0.001), 3.5, 80);
    } else {
      camera.fov = THREE.MathUtils.clamp(camera.fov * Math.exp(e.deltaY * 0.001), 15, 85);
      camera.updateProjectionMatrix();
    }
  }, { passive: false });
  dom.addEventListener('dblclick', () => { if (drive.mode) resetGroundView(); });
}

// --- Línea de trazada en el suelo, al estilo de los simuladores de carreras ---
// Chevrones finos pintados por delante del vehículo (lo ya recorrido no se pinta). El color sale de la
// inclinación del terreno en cada punto (DTM): verde < 8°, ámbar 8–15°, rojo > 15°, los mismos umbrales
// que el resto de la app. A lo lejos los chevrones se funden en una línea fina.
const RIBBON = { back: 40, ahead: 1800 };
const ribbonMat = new THREE.ShaderMaterial({
  uniforms: { uCur: { value: 0 }, uCenter: { value: 0 } },
  vertexShader: `
    attribute float along;
    attribute float side;
    attribute float halfw;
    attribute vec3 tint;
    varying float vAlong;
    varying float vSide;
    varying float vHalf;
    varying float vDist;
    varying vec3 vTint;
    void main() {
      vAlong = along;
      vSide = side;
      vHalf = halfw;
      vTint = tint;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uCur;
    uniform float uCenter;
    varying float vAlong;
    varying float vSide;
    varying float vHalf;
    varying float vDist;
    varying vec3 vTint;
    void main() {
      float rel = vAlong - uCur;
      // Empieza un poco por delante del vehículo y se va haciendo visible
      float start = smoothstep(2.0, 6.0, rel);
      // Chevron: línea en "V" con la punta hacia delante (los brazos quedan más atrás en los bordes)
      float q = mod(vAlong + abs(vSide) * vHalf * 0.85, 4.5);
      float aa = fwidth(q) * 1.2 + 0.001;
      float chev = 1.0 - smoothstep(0.38 - aa, 0.38 + aa, q);
      chev *= 1.0 - smoothstep(0.92, 1.0, abs(vSide));
      float near = 1.0 - smoothstep(110.0, 240.0, vDist);
      // Línea central fina para lo lejano
      float lw = fwidth(vSide) * 1.5 + 0.06;
      float line = (1.0 - smoothstep(lw, lw * 2.0, abs(vSide))) * smoothstep(70.0, 180.0, vDist);
      float a = max(chev * near * 0.78, line * 0.5) * start;
      a *= 1.0 - smoothstep(${(RIBBON.ahead * 0.65).toFixed(1)}, ${RIBBON.ahead.toFixed(1)}, vAlong - uCenter);
      if (a < 0.01) discard;
      gl_FragColor = vec4(vTint, a);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -8,
  polygonOffsetUnits: -8,
});
const ribbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat);
ribbon.frustumCulled = false;
ribbon.renderOrder = 5;
ribbon.visible = false;
scene.add(ribbon);

const SLOPE_RGB = { ok: new THREE.Color(COLORS.ok), warn: new THREE.Color(COLORS.warn), bad: new THREE.Color(COLORS.bad) };
function slopeColor(deg, out) {
  // Transición suave alrededor de los umbrales (8° y 15°)
  const w = THREE.MathUtils.smoothstep(deg, TILT.warn - 1.5, TILT.warn + 1.5);
  const b = THREE.MathUtils.smoothstep(deg, TILT.bad - 1.5, TILT.bad + 1.5);
  return out.copy(SLOPE_RGB.ok).lerp(SLOPE_RGB.warn, w).lerp(SLOPE_RGB.bad, b);
}

function buildRibbon(P, c) {
  const s0 = Math.max(0, c - RIBBON.back);
  const s1 = Math.min(P.total, c + RIBBON.ahead);
  const S = [];
  for (let s = s0; ;) {
    S.push(s);
    if (s >= s1) break;
    s = Math.min(s1, s + Math.min(25, 0.5 + Math.abs(s - c) * 0.015));
  }
  const pos = new Float32Array(S.length * 6);
  const along = new Float32Array(S.length * 2);
  const side = new Float32Array(S.length * 2);
  const halfw = new Float32Array(S.length * 2);
  const tint = new Float32Array(S.length * 6);
  const col = new THREE.Color();
  S.forEach((s, k) => {
    const p = pathAt(P, s);
    const h = Math.max(1.5, Math.abs(s - c) * 0.015);
    const a = pathAt(P, s - h);
    const b = pathAt(P, s + h);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // Inclinación del terreno en el punto: pendiente a lo largo (subida/bajada) y transversal (ladera)
    const grade = (groundAt(p.x + tx * 6, p.z + tz * 6) - groundAt(p.x - tx * 6, p.z - tz * 6)) / 12;
    const cross = (groundAt(p.x - tz * 6, p.z + tx * 6) - groundAt(p.x + tz * 6, p.z - tx * 6)) / 12;
    slopeColor((Math.atan(Math.hypot(grade, cross)) * 180) / Math.PI, col);
    const hw = 0.9 + Math.abs(s - c) * 0.004; // más ancha a lo lejos para que se siga viendo
    for (const sd of [-1, 1]) {
      const X = p.x - tz * hw * sd;
      const Z = p.z + tx * hw * sd;
      const j = k * 2 + (sd > 0 ? 1 : 0);
      pos[j * 3] = X;
      pos[j * 3 + 1] = driveGround(X, Z) + 0.05 + Math.abs(s - c) * 0.0015;
      pos[j * 3 + 2] = Z;
      along[j] = s;
      side[j] = sd;
      halfw[j] = hw;
      col.toArray(tint, j * 3);
    }
  });
  const idx = [];
  for (let k = 0; k < S.length - 1; k++) {
    const i = k * 2;
    idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('along', new THREE.BufferAttribute(along, 1));
  g.setAttribute('side', new THREE.BufferAttribute(side, 1));
  g.setAttribute('halfw', new THREE.BufferAttribute(halfw, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  g.setIndex(idx);
  ribbon.geometry.dispose();
  ribbon.geometry = g;
  ribbonMat.uniforms.uCenter.value = c;
  drive.ribbonAt = { key: P.key, c };
}

// Banderas de origen/destino: mástil de 2,6 m y un haz de luz que solo se ve de lejos
// (de cerca se desvanece para no tapar la vista).
function makeFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), new THREE.MeshLambertMaterial({ color: '#dcd6cc' }));
  pole.position.y = 1.3;
  pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  flag.position.set(0.45, 2.3, 0);
  flag.castShadow = true;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 140, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = 70;
  g.add(pole, flag, beam);
  g.userData.beam = beam;
  g.visible = false;
  scene.add(g);
  return g;
}
const flags = { a: makeFlag('#2fbf71'), b: makeFlag('#ef5350'), end: makeFlag(COLORS.accent) };
function placeFlag(f, lon, lat) {
  const v = toLocal(lon, lat, 0);
  f.position.set(v.x, driveGround(v.x, v.z), v.z);
  f.visible = true;
}
function updateFlags() {
  Object.values(flags).forEach((f) => { f.visible = false; });
  if (!drive.mode) return;
  if (planDock) {
    placeFlag(flags.a, plan.origin.lon, plan.origin.lat);
    placeFlag(flags.b, plan.dest.lon, plan.dest.lat);
  } else {
    placeFlag(flags.end, pts.at(-1).lon, pts.at(-1).lat);
  }
}

function updateRibbon() {
  const P = activePath();
  const c = drive.ss;
  if (!drive.ribbonAt || drive.ribbonAt.key !== P.key || Math.abs(c - drive.ribbonAt.c) > 150) {
    buildRibbon(P, c);
    updateFlags();
  }
  ribbon.visible = true;
  ribbonMat.uniforms.uCur.value = c;
  for (const f of Object.values(flags)) {
    if (!f.visible) continue;
    const d = camera.position.distanceTo(f.position);
    const beam = f.userData.beam;
    beam.material.opacity = 0.45 * THREE.MathUtils.smoothstep(d, 30, 150);
    const w = Math.max(1, d / 300);
    beam.scale.set(w, 1, w);
  }
}

// --- Minimapa (abajo a la izquierda en las vistas a ras de suelo) ---
const toTex = (x, z) => {
  const [lon, lat] = sceneToLonLat(x, z);
  return [((lon - ext.west) / (ext.east - ext.west)) * texW, ((ext.north - lat) / (ext.north - ext.south)) * texH];
};
const fromTex = (u, v) => {
  const p = toLocal(ext.west + (u / texW) * (ext.east - ext.west), ext.north - (v / texH) * (ext.north - ext.south), 0);
  return [p.x, p.z];
};
// Clic en el minimapa: salta al punto de la ruta más cercano
function pickFromMinimap(x, z) {
  const L = activePath().raw;
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < L.n; i++) {
    const d = (L.x[i] - x) ** 2 + (L.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  if (planDock) planDock.player.seekIndex(bi); else select(bi);
}
const minimap = createMinimap({
  host: document.querySelector('.stage'), texCanvas, toTex, fromTex, onPick: pickFromMinimap,
});
minimap.setVisible(false);
textureDone.then(() => minimap.refresh());
const camDirTmp = new THREE.Vector3();
let minimapKey = null;
function updateMinimap(P) {
  if (minimapKey !== P.key) {
    minimapKey = P.key;
    const L = P.raw;
    const at = (lon, lat) => { const v = toLocal(lon, lat, 0); return { x: v.x, z: v.z }; };
    minimap.setRoute({
      points: Array.from({ length: L.n }, (_, i) => [L.x[i], L.z[i]]),
      cum: L.cum,
      color: planDock ? PLAN_COLOR : COLORS.accent,
      flags: planDock
        ? [{ ...at(plan.origin.lon, plan.origin.lat), color: '#2fbf71' }, { ...at(plan.dest.lon, plan.dest.lat), color: '#ef5350' }]
        : [{ x: L.x[0], z: L.z[0], color: '#ffffff' }, { x: L.x[L.n - 1], z: L.z[L.n - 1], color: COLORS.accent }],
      metersPerTexPx: widthM / texW,
    });
  }
  camera.getWorldDirection(camDirTmp);
  minimap.update({ x: drive.pos.x, z: drive.pos.y, s: drive.s, yaw: drive.yaw, camDir: [camDirTmp.x, camDirTmp.z], fov: camera.fov });
}

// Parche de suelo con HiRISE (~0,3 m/px) alrededor del rover: el relieve general (~4,6 m/px)
// se ve borroso a escala de coche.
const PATCH = { size: 360, seg: 180, tex: 1024 }; // 1024 px → 0,35 m/px (HiRISE es 0,25 m/px)
function updatePatch() {
  const p = drive.base;
  const near = drive.patch && Math.hypot(p.x - drive.patch.cx, p.z - drive.patch.cz) < PATCH.size * 0.22;
  if (near || drive.patchBusy) return;
  loadPatchAt(p.x, p.z);
}
function loadPatchAt(cx, cz) {
  drive.patchBusy = true;
  return buildPatch(cx, cz).then(({ mesh, map, stretch }) => {
    // Un único material para todos los parches: al cambiar de parche solo se cambia la imagen.
    // (Antes cada parche traía su material y, al liberar el anterior, Three desechaba el shader
    // compilado y lo volvía a compilar: ~65 ms de parón cada vez que el suelo se regeneraba.)
    const mat = mesh.material;
    const oldMap = mat.map;
    mat.map = map;
    mat.userData.stretch.value.copy(stretch);
    if (oldMap !== map) oldMap.dispose();
    if (drive.patch) {
      scene.remove(drive.patch.mesh);
      drive.patch.mesh.geometry.dispose();
    }
    drive.patch = { mesh, cx, cz };
    mesh.visible = !!drive.mode;
    scene.add(mesh);
  }).finally(() => { drive.patchBusy = false; });
}

// Máscara circular con borde suave: los parches de detalle se funden con el relieve general
let radialTex = null;
function radialAlpha() {
  if (radialTex) return radialTex;
  const a = document.createElement('canvas');
  a.width = 256;
  a.height = 256;
  const ag = a.getContext('2d');
  const grad = ag.createRadialGradient(128, 128, 70, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#000');
  ag.fillStyle = grad;
  ag.fillRect(0, 0, 256, 256);
  radialTex = new THREE.CanvasTexture(a);
  return radialTex;
}
let patchMat = null;
function patchMaterial(map) {
  if (patchMat) return patchMat;
  const mat = new THREE.MeshLambertMaterial({
    map, alphaMap: radialAlpha(), transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const det = applyGroundDetail(mat, { sizeU: PATCH.size, sizeV: PATCH.size, fine: 3, coarse: 17, fade: [25, 160], normalTile: 3, normalScale: 1 });
  det.uTint.value.copy(MARS_TINT);
  // Contraste de HiRISE en la GPU (antes se recorrían todos los píxeles en el hilo principal).
  // x = ganancia, y = media de la imagen, z = media de referencia (CTX).
  const stretch = { value: new THREE.Vector3(1, 0.5, 0.5) };
  mat.userData.stretch = stretch;
  const detailCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    detailCompile(shader, r);
    shader.uniforms.uStretch = stretch;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uStretch;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float sv = pow(max(diffuseColor.r, 0.0), 1.0 / 2.2);
  float ov = clamp(uStretch.z + (sv - uStretch.y) * uStretch.x, 0.0, 1.0);
  diffuseColor.rgb = vec3(pow(ov, 2.2));
}`);
  };
  mat.customProgramCacheKey = () => 'ground-detail-stretch';
  patchMat = mat;
  return mat;
}

async function buildPatch(cx, cz) {
  const half = PATCH.size / 2;
  const geo = new THREE.PlaneGeometry(PATCH.size, PATCH.size, PATCH.seg, PATCH.seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt1(cx + pos.getX(i), cz + pos.getZ(i)) + GROUND_LIFT);
  geo.computeVertexNormals();
  const [west, north] = sceneToLonLat(cx - half, cz - half);
  const [east, south] = sceneToLonLat(cx + half, cz + half);
  const e = { west, east, north, south };
  const canvas = document.createElement('canvas');
  canvas.width = PATCH.tex;
  canvas.height = PATCH.tex;
  const g = canvas.getContext('2d', { willReadFrequently: false });
  g.fillStyle = '#8c6a55';
  g.fillRect(0, 0, PATCH.tex, PATCH.tex);
  const map = makeTexture(canvas);
  const mesh = new THREE.Mesh(geo, patchMaterial(map));
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  const prog = { done: 0, total: 0 };
  const redraw = () => { map.needsUpdate = true; };
  await drawMosaic({ layer: SITE.tiles.ctx.layer, ext: 'png', z: 13, bounds: SITE.tiles.ctx.bounds }, e, g, { onTile: redraw, prog });
  // Brillo de referencia: el CTX de debajo es la misma imagen que lleva el relieve general,
  // así el parche no se ve como un círculo más claro u oscuro que el terreno de alrededor.
  const ref = thumbStats(canvas);
  await drawMosaic({ layer: SITE.tiles.hirise.layer, ext: 'png', z: 17, bounds: SITE.tiles.hirise.bounds }, e, g, { onTile: redraw, prog });
  // HiRISE de suelo polvoriento tiene muy poco contraste (desviación ~10/255): se estira alrededor del
  // brillo medio del CTX de referencia para que se lean dunas, rocas y huellas sin quemar el suelo.
  const cur = thumbStats(canvas);
  const stretch = new THREE.Vector3(Math.max(ref.sd, 26) / cur.sd, cur.mean / 255, ref.mean / 255);
  map.needsUpdate = true;
  return { mesh, map, stretch };
}

// Media y desviación del gris de un lienzo, sobre una miniatura de 128 × 128 (rápido)
const thumb = document.createElement('canvas');
thumb.width = 128;
thumb.height = 128;
const thumbCtx = thumb.getContext('2d', { willReadFrequently: true });
function thumbStats(src) {
  thumbCtx.drawImage(src, 0, 0, 128, 128);
  const d = thumbCtx.getImageData(0, 0, 128, 128).data;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < d.length; i += 4) { s += d[i]; s2 += d[i] * d[i]; }
  const n = d.length / 4;
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(1, s2 / n - mean * mean)) };
}

// --- Panel de telemetría (común a las tres vistas de suelo) ---
const hud = document.createElement('div');
hud.className = 'drive-hud';
hud.hidden = true;
document.querySelector('.stage').appendChild(hud);
hud.addEventListener('click', (e) => {
  const rate = e.target.closest('[data-rate]')?.dataset.rate;
  if (rate && planDock) {
    drive.rate = Number(rate);
    planDock.player.setRate(drive.rate);
    renderHud();
  }
  const route = e.target.closest('[data-route]')?.dataset.route;
  if (route) setRoute(route);
  if (e.target.closest('[data-exit]')) overview();
  if (e.target.closest('[data-more]')) { drive.hudMore = !drive.hudMore; renderHud(); }
});
const deg = (r) => `${num((r * 180) / Math.PI, 1)}°`;
const GROUND_NAMES = { astro: 'Astronauta · ojos a 1,7 m', chase: 'Vista de coche', pov: 'POV · Navcam' };
function renderHud() {
  const roverOn = drive.mode !== 'astro' && roverRig;
  const P = roverOn ? roverRig.pose : null;
  const heading = ((((Math.PI - drive.yaw) * 180) / Math.PI) % 360 + 360) % 360;
  const p = pts[state.idx];
  const [lon, lat] = sceneToLonLat(drive.base.x, drive.base.z);
  // Pendiente bajo los pies (DTM, ±10 m)
  const gx = (groundAt(drive.base.x + 10, drive.base.z) - groundAt(drive.base.x - 10, drive.base.z)) / 20;
  const gz = (groundAt(drive.base.x, drive.base.z + 10) - groundAt(drive.base.x, drive.base.z - 10)) / 20;
  const slopeHere = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  const bar = (v) => `<i style="width:${Math.min(100, (Math.abs(v) / 0.35) * 100)}%"></i>`;
  const rates = [1, 10, 100, 1000];
  const pct = drive.pathTotal ? Math.min(100, (drive.progress / drive.pathTotal) * 100) : 0;
  const routeNote = planDock
    ? `${plan.labels.join(' · ')} · ${plan.vehicleName}`
    : `Travesía real · sol ${p.sol} · parada ${num(state.idx + 1)} de ${num(pts.length)}`;
  const grid = roverOn
    ? `<div><span>Cabeceo</span><b>${deg(P.pitch)}</b></div>
       <div><span>Alabeo</span><b>${deg(P.roll)}</b></div>`
    : `<div><span>Altitud</span><b>${num(terrainAt(lon, lat))} m</b></div>
       <div><span>Pendiente</span><b>${num(slopeHere, 1)}°</b></div>`;
  hud.innerHTML = `
    <div class="dh-head"><span class="dh-mode">${GROUND_NAMES[drive.mode]}</span>
      <button class="btn" type="button" data-exit>Salir · Esc</button></div>
    <div class="dh-route"><p>${routeNote}</p></div>
    <div class="dh-grid">
      ${grid}
      <div><span>Rumbo</span><b>${num(heading)}°</b></div>
      <div><span>Velocidad</span><b>${planDock ? `${num(drive.speedKmh, 1)} km/h` : '—'}</b></div>
    </div>
    ${planDock ? (() => {
    const L = liveNumbers(planDock.sample);
    const second = L.autoLeft !== null ? ['Autonomía', formatHours(L.autoLeft)] : L.battery !== null ? ['Batería', `${num(L.battery * 100)} %`] : ['Pendiente', `${num(L.slope, 1)}°`];
    return `<div class="dh-grid dh-live"><div><span>Dosis acumulada</span><b>${num(L.dose, 3)} mSv</b></div><div><span>${second[0]}</span><b>${second[1]}</b></div></div>`;
  })() : ''}
    <div class="dh-progress"><span>Recorrido</span><b>${fmt.km(drive.progress)} de ${fmt.km(drive.pathTotal)}</b><em><i style="width:${pct}%"></i></em></div>
    ${roverOn ? `<button class="dh-more" type="button" data-more aria-expanded="${!!drive.hudMore}">${drive.hudMore ? 'Ocultar suspensión' : 'Ver suspensión (rocker-bogie)'}</button>` : ''}
    ${roverOn && drive.hudMore ? `<div class="dh-susp">
      <div><span>Balancín izq.</span><em>${bar(P.rocker.p)}</em><b>${deg(P.rocker.p)}</b></div>
      <div><span>Balancín dcho.</span><em>${bar(P.rocker.n)}</em><b>${deg(P.rocker.n)}</b></div>
      <div><span>Bogie izq.</span><em>${bar(P.bogie.p)}</em><b>${deg(P.bogie.p)}</b></div>
      <div><span>Bogie dcho.</span><em>${bar(P.bogie.n)}</em><b>${deg(P.bogie.n)}</b></div>
    </div>` : ''}
    ${planDock ? `<div class="dh-rate"><span>Velocidad de reproducción</span><div class="seg">${rates.map((r) => `<button type="button" data-rate="${r}" aria-pressed="${drive.rate === r}">×${num(r)}</button>`).join('')}</div></div>`
    : roverOn ? `<p class="dh-note">Medido por el rover en esta parada: cabeceo ${num(p.pitch_deg, 1)}°, alabeo ${num(p.roll_deg, 1)}°. La simulación usa el relieve de 20 m.</p>` : ''}`;
}

// Velocidad de reproducción de la ruta planificada a ras de suelo: visualmente ~15 m/s (5 m/s a pie),
// redondeada a ×1/×10/×100/×1000 del tiempo real.
function applyDriveRate() {
  if (!planDock || !drive.mode) return;
  const vms = (plan.vehicle.vFlat ?? 3) / 3.6;
  const ideal = (drive.mode === 'astro' ? 5 : 15) / vms;
  drive.rate = [1, 10, 100, 1000].reduce((a, b) => (Math.abs(Math.log(b / ideal)) < Math.abs(Math.log(a / ideal)) ? b : a));
  planDock.player.setRate(drive.rate);
}

const GROUND_BUTTON = { astro: 'overview', chase: 'drive', pov: 'pov' };
// Vistas a ras de suelo: astronauta, coche y POV comparten escala real, suelo detallado, cielo y ruta en el suelo.
async function enterDrive(mode, { cinematic = true, long = false, autoplay = false } = {}) {
  if (document.body.classList.contains('touring')) return;
  setViewButton(GROUND_BUTTON[mode]);
  const token = ++drive.token;
  if (mode !== 'astro') {
    await ensureRover();
    if (token !== drive.token) return; // se eligió otra vista mientras cargaba el modelo
  }
  // Vuelo de entrada solo al pasar de la vista general a la de coche
  let cine = null;
  if (!drive.mode && mode === 'chase' && cinematic) {
    // La exageración pasa de ×N a ×1: se conserva la altura de la cámara sobre el suelo
    const e0 = state.exag;
    const keepAlt = (v) => { const g = groundAt1(v.x, v.z); return new THREE.Vector3(v.x, v.y - g * e0 + g, v.z); };
    const pos = keepAlt(camera.position);
    const dist = pos.distanceTo(keepAlt(controls.target));
    cine = {
      t: 0, dur: long ? 4.4 : 2.8, pos, look: keepAlt(controls.target), fov: camera.fov,
      fog: [scene.fog.near, scene.fog.far], reach: THREE.MathUtils.clamp(dist * 0.12, 60, 400),
      done: autoplay ? () => { if (planDock && !planDock.player.playing) planDock.player.play(); } : null,
    };
  }
  if (!drive.mode) {
    tracks.reset();
    dust.reset();
    tracks.visible = true;
    dust.visible = true;
    if (state.astro) setAstroMode(false);
    drive.prevExag = state.exag;
    setExaggeration(1); // a escala real: con el relieve exagerado el rover iría "escalando"
    controls.enabled = false;
    document.body.classList.add('driving');
    $('scene').classList.add('ground');
    rover.visible = false;
    routeLines.forEach((l) => { l.visible = false; });
    planViz?.setVisible(false);
    sky.mesh.visible = true;
    applySkyFog();
    minimap.setVisible(true);
    minimapKey = null;
    scene.fog.near = 600;
    scene.fog.far = 9000;
    camera.near = 0.1;
    camera.far = 30000;
    sun.castShadow = true;
    drive.pos = null;
    drive.s = null;
    drive.lastT = null;
    drive.ribbonAt = null;
    hud.hidden = false;
  }
  drive.mode = mode;
  state.drive = mode;
  drive.snapCam = true;
  if (roverRig) {
    roverRig.root.visible = mode !== 'astro';
    roverRig.povHidden.forEach((o) => { o.visible = mode !== 'pov'; });
  }
  if (drive.rate === null || !planDock?.player.playing) applyDriveRate();
  resetGroundView();
  if (drive.patch) drive.patch.mesh.visible = true;
  updateFlags();
  updateTerrainTint();
  drive.cine = cine;
  if (cine) {
    // El vuelo empieza en la pose de la vista general: niebla y FOV de partida
    scene.fog.near = cine.fog[0];
    scene.fog.far = cine.fog[1];
    camera.near = 2;
    camera.far = 200000;
    camera.fov = cine.fov;
    camera.updateProjectionMatrix();
  } else if (autoplay && planDock && !planDock.player.playing) {
    planDock.player.play();
  }
}

function exitDrive() {
  drive.token++;
  if (!drive.mode) return;
  drive.cine = null;
  tracks.visible = false;
  dust.visible = false;
  drive.mode = null;
  state.drive = null;
  drive.rate = null;
  document.body.classList.remove('driving');
  $('scene').classList.remove('ground');
  hud.hidden = true;
  if (roverRig) {
    roverRig.root.visible = false;
    roverRig.povHidden.forEach((o) => { o.visible = true; });
  }
  if (drive.patch) drive.patch.mesh.visible = false;
  ribbon.visible = false;
  updateFlags();
  sun.castShadow = false;
  if (planDock) {
    planViz.setVisible(true);
    planDock.player.defaultRate();
  }
  camera.near = 2;
  camera.far = 200000;
  camera.fov = 50;
  camera.up.set(0, 1, 0);
  camera.updateProjectionMatrix();
  controls.enabled = true;
  setExaggeration(drive.prevExag);
  setAstroMode(false);
  sky.mesh.visible = false;
  minimap.setVisible(false);
  updateTerrainTint();
}

const profile = buildProfile($('profile-wrap'), pts, { onPick: (i) => select(i), colorAt: tiltColor });

const slider = $('slider');
slider.max = String(pts.length - 1);
slider.addEventListener('input', () => select(Number(slider.value)));
setPlayButton($('play'), false);
$('play').addEventListener('click', togglePlay);
$('exag').addEventListener('input', (e) => setExaggeration(Number(e.target.value)));
$('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
$('overview').addEventListener('click', overview);
$('drive').addEventListener('click', () => enterDrive('chase'));
$('pov').addEventListener('click', () => enterDrive('pov'));
$('layer').addEventListener('change', (e) => setLayer(e.target.value));
renderLegend(state.layer);
document.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('touring') || document.body.classList.contains('presenting')) return; // la presentación tiene sus propias teclas
  if (state.drive && e.key === 'Escape') { overview(); return; }
  if (e.target.closest?.('input, select, textarea')) return;
  if (planDock && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const pl = planDock.player;
    pl.seek(pl.t + (e.key === 'ArrowRight' ? 1 : -1) * pl.total * 0.02);
    return;
  }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
});

// ---------- Hora del día: luz y cielo ----------
// La hora mueve el Sol en todas las vistas; el cielo se ve en las vistas a ras de suelo.
const sky = createSky();
scene.add(sky.mesh);
const timeOfDay = { hour: 16, playing: false, last: null };
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
function applySkyFog() {
  const st = skyState(SUN_DIR.y);
  scene.fog.color.copy(st.fog);
  scene.background = st.fog;
}
function setHour(h) {
  timeOfDay.hour = h;
  sunDirection(h, latC, SUN_DIR);
  const st = skyState(SUN_DIR.y);
  sun.intensity = st.sunIntensity;
  sun.color.copy(st.sunColor);
  hemi.intensity = st.hemiIntensity;
  sky.setSun(SUN_DIR);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, state.drive ? 80 : 10000);
  if (state.drive) applySkyFog();
  $('hour').value = String(h);
  $('hour-label').textContent = fmtHour(h);
}
function toggleDay() {
  timeOfDay.playing = !timeOfDay.playing;
  timeOfDay.last = null;
  if (timeOfDay.playing && timeOfDay.hour >= 19.4) setHour(5.5);
  $('day-play').textContent = timeOfDay.playing ? 'Pausar' : 'Ver un sol';
  $('day-play').setAttribute('aria-pressed', String(timeOfDay.playing));
}
$('hour').addEventListener('input', (e) => {
  if (timeOfDay.playing) toggleDay();
  setHour(Number(e.target.value));
});
$('day-play').addEventListener('click', toggleDay);
setHour(timeOfDay.hour);

setExaggeration(state.exag);
enterPlanMode();
$('loading').hidden = true;

const frameHooks = new Set();
frameHooks.add((t) => driveFrame(t));
// La ficha ocupa la izquierda: el centro de la cámara se desplaza para que lo importante quede en el
// centro de la zona visible (no detrás de la ficha). En el tour y la intro la ficha no se ve.
let viewShift = -1;
let viewShiftT = 0;
frameHooks.add((t) => {
  if (t - viewShiftT < 500) return;
  viewShiftT = t;
  const panel = document.querySelector('.float-right');
  const hidden = document.body.classList.contains('touring') || document.body.classList.contains('intro-on')
    || !panel || getComputedStyle(panel).display === 'none' || document.body.dataset.ui !== 'mix';
  const shift = hidden ? 0 : Math.round(panel.offsetWidth / 2);
  if (shift === viewShift) return;
  viewShift = shift;
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
});
// Seguimiento en las vistas desde arriba: al reproducir con "Seguir al rover", la cámara se desliza
// hasta dejar el vehículo en el centro y lo acompaña (sin cambiar distancia ni ángulo).
let followT = null;
frameHooks.add((t) => {
  const dt = followT === null ? 0 : Math.min(0.1, (t - followT) / 1000);
  followT = t;
  const playing = planDock ? planDock.player.playing : !!state.playing;
  if (!playing || !state.follow || state.drive || state.astro || document.body.classList.contains('touring') || document.body.classList.contains('presenting')) return;
  const d = focusPoint().sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3));
  camera.position.add(d);
  controls.target.add(d);
});
// Un sol completo (de 5:30 a 19:30) en ~24 s
frameHooks.add((t) => {
  if (!timeOfDay.playing) return;
  if (timeOfDay.last !== null) {
    const h = timeOfDay.hour + (Math.min(100, t - timeOfDay.last) / 1000) * (14 / 24);
    setHour(Math.min(19.5, h));
    if (h >= 19.5) toggleDay();
  }
  timeOfDay.last = t;
});
frameHooks.add(() => { if (sky.mesh.visible) sky.mesh.position.copy(camera.position); });

// ---------- Navegación de la vista General ----------
const navSph = new THREE.Spherical();
const navTmp = new THREE.Vector3();
const navFree = () => !state.drive && !state.astro && !document.body.classList.contains('touring') && !document.body.classList.contains('presenting');
function orbitNow() {
  navSph.setFromVector3(navTmp.copy(camera.position).sub(controls.target));
  return { r: navSph.radius, phi: navSph.phi, theta: navSph.theta, target: controls.target.clone() };
}
let navTween = null;
function tweenOrbit(to, dur = 650) {
  const from = orbitNow();
  navTween = { from, to: { ...from, ...to }, t0: performance.now(), dur };
}
// Altura del suelo (escena, con la exageración) bajo un punto x, z; null fuera del DTM
function sceneGround(x, z) {
  const h = terrainAt(lonC + x / (cosLat * M_PER_DEG), latC - z / M_PER_DEG);
  return Number.isFinite(h) ? (h - elevRef) * state.exag : null;
}
let navT = null;
frameHooks.add((t) => {
  const dt = navT === null ? 0 : Math.min(0.1, (t - navT) / 1000);
  navT = t;
  if (!navFree()) return;
  if (navTween) {
    const k = Math.min(1, (performance.now() - navTween.t0) / navTween.dur);
    const e = 1 - (1 - k) ** 3;
    const { from: a, to: b } = navTween;
    const dTheta = Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta));
    controls.target.copy(a.target).lerp(b.target, e);
    navSph.set(a.r * (b.r / a.r) ** e, a.phi + (b.phi - a.phi) * e, a.theta + dTheta * e);
    camera.position.copy(controls.target).add(navTmp.setFromSpherical(navSph));
    if (k >= 1) navTween = null;
    return;
  }
  // El pivote no se sale del mapa y vuelve suavemente al suelo tras desplazarse (gira sobre el terreno, no en el aire)
  const lim = { x: widthM / 2 + 8000, z: heightM / 2 + 8000 };
  navTmp.set(
    THREE.MathUtils.clamp(controls.target.x, -lim.x, lim.x) - controls.target.x,
    0,
    THREE.MathUtils.clamp(controls.target.z, -lim.z, lim.z) - controls.target.z,
  );
  const g = sceneGround(controls.target.x, controls.target.z);
  if (g !== null) navTmp.y = (g - controls.target.y) * (1 - Math.exp(-dt * 4));
  controls.target.add(navTmp);
  camera.position.add(navTmp);
});
// Brújula y rótulo de la zona
const needle = $('nav-needle');
let needleDeg = null;
frameHooks.add(() => {
  const free = navFree();
  zone.group.visible = !state.drive;
  const deg = Math.round(THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()));
  if (deg !== needleDeg) { needleDeg = deg; needle.style.transform = `rotate(${deg}deg)`; }
  navTmp.copy(zone.corner);
  navTmp.y *= state.exag;
  navTmp.project(camera);
  const on = free && navTmp.z < 1 && Math.abs(navTmp.x) < 1 && Math.abs(navTmp.y) < 1;
  zone.label.hidden = !on;
  if (on) zone.label.style.transform = `translate(${Math.round((navTmp.x + 1) / 2 * host.clientWidth)}px, ${Math.round((1 - navTmp.y) / 2 * host.clientHeight)}px) translateX(-50%)`;
});
function zoomBy(f) {
  const r = THREE.MathUtils.clamp(orbitNow().r * f, controls.minDistance, controls.maxDistance);
  tweenOrbit({ r }, 450);
}
// Encuadre de toda la zona de estudio con el norte arriba (descontando la ficha de la izquierda)
function homeView() {
  if (state.drive) exitDrive();
  setViewButton('overview');
  const w = host.clientWidth - 2 * Math.max(0, viewShift);
  const h = host.clientHeight;
  const vfov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hfov = Math.atan(Math.tan(vfov) * (w / h));
  const r = Math.max((widthM * 0.56) / Math.tan(hfov), (heightM * 0.8) / Math.tan(vfov));
  const target = new THREE.Vector3(0, ((hMin + hMax) / 2 - elevRef) * state.exag, 0);
  tweenOrbit({ r, phi: 0.62, theta: 0, target }, 900);
}
$('nav-in').addEventListener('click', () => zoomBy(0.55));
$('nav-out').addEventListener('click', () => zoomBy(1.8));
$('nav-north').addEventListener('click', () => tweenOrbit({ theta: 0 }));
$('nav-home').addEventListener('click', homeView);
// Ayuda de uso: aparece en la vista General hasta que se mueve el mapa por primera vez
const navHint = $('nav-hint');
navHint.innerHTML = matchMedia('(pointer: coarse)').matches
  ? '<b>Un dedo</b> mover · <b>Dos dedos</b> girar y acercar'
  : '<b>Arrastrar</b> mover · <b>Botón derecho</b> girar · <b>Rueda</b> acercar';
let hintTimer = 0;
function showNavHint() {
  if (document.body.dataset.navUsed) return;
  navHint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { navHint.hidden = true; }, 9000);
}
controls.addEventListener('start', () => {
  navTween = null;
  document.body.dataset.navUsed = '1';
  navHint.hidden = true;
});
$('overview').addEventListener('click', showNavHint);
setTimeout(() => { if (navFree() && !document.body.classList.contains('intro-on')) showNavHint(); }, 2500);

renderer.setAnimationLoop((t) => {
  frameHooks.forEach((fn) => fn(t));
  if (!state.drive) controls.update(); // en coche/POV la cámara la lleva el rover
  renderer.render(scene, camera);
});

// ---------- Precarga de las vistas a ras de suelo ----------
// En cuanto la vista está lista se carga en segundo plano todo lo que necesita "Coche": el modelo del
// rover, el suelo HiRISE del inicio de la ruta y los shaders (compilados de antemano). Así pulsar
// Coche es inmediato en vez de tardar unos segundos.
let preloadPromise = null;
function preloadDrive() {
  preloadPromise ??= (async () => {
    await ensureRover({ quiet: true });
    if (!drive.patch && !drive.patchBusy) {
      const P = activePath();
      loadPatchAt(P.x[0], P.z[0]); // el suelo del inicio de la ruta (se descarga en paralelo)
    }
    // Compilar los materiales de las vistas a ras de suelo con la luz que tendrán (sombras activas)
    const objs = [roverRig.root, sky.mesh, ribbon, dust.points, drive.patch?.mesh].filter(Boolean);
    const was = objs.map((o) => o.visible);
    const shadow = sun.castShadow;
    objs.forEach((o) => { o.visible = true; });
    sun.castShadow = true;
    const done = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
    objs.forEach((o, k) => { o.visible = was[k]; });
    sun.castShadow = shadow;
    await done;
  })().catch((err) => { console.warn('Precarga del rover:', err); preloadPromise = null; });
  return preloadPromise;
}

// ---------- Detalle al acercarse en la vista general ----------
// La imagen general va a ~5 m/px: de cerca se ve borrosa. Al acercar la cámara se monta un parche de
// 1,6 km con HiRISE (~0,8 m/px) y CTX alrededor del punto que se mira, dentro del grupo del relieve
// (así sigue la exageración vertical). Se desvanece por los bordes y solo se ve con la capa Satélite.
const DETAIL = { size: 1600, seg: 200, tex: 2048, near: 3400 };
const detail = { mesh: null, cx: 0, cz: 0, busy: false, mat: null };
function detailMaterial(map) {
  if (detail.mat) return detail.mat;
  const mat = new THREE.MeshLambertMaterial({
    map, alphaMap: radialAlpha(), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  applyGroundDetail(mat, { sizeU: DETAIL.size, sizeV: DETAIL.size, fine: 6, coarse: 40, fade: [50, 350], fadeCoarse: [150, 700], normalScale: 0 });
  mat.customProgramCacheKey = () => 'ground-detail-general';
  detail.mat = mat;
  return mat;
}
async function buildDetail(cx, cz) {
  const half = DETAIL.size / 2;
  const geo = new THREE.PlaneGeometry(DETAIL.size, DETAIL.size, DETAIL.seg, DETAIL.seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt1(cx + pos.getX(i), cz + pos.getZ(i)) + 0.6);
  geo.computeVertexNormals();
  const [west, north] = sceneToLonLat(cx - half, cz - half);
  const [east, south] = sceneToLonLat(cx + half, cz + half);
  const e = { west, east, north, south };
  const canvas = document.createElement('canvas');
  canvas.width = DETAIL.tex;
  canvas.height = DETAIL.tex;
  const g = canvas.getContext('2d');
  const map = makeTexture(canvas);
  const prog = { done: 0, total: 0 };
  await drawMosaic({ layer: SITE.tiles.ctx.layer, ext: 'png', z: 13, bounds: SITE.tiles.ctx.bounds }, e, g, { prog });
  await drawMosaic({ layer: SITE.tiles.hirise.layer, ext: 'png', z: 16, bounds: SITE.tiles.hirise.bounds }, e, g, { prog });
  map.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, detailMaterial(map));
  mesh.position.set(cx, 0, cz);
  mesh.renderOrder = 1;
  return { mesh, map };
}
frameHooks.add(() => {
  const close = camera.position.distanceTo(controls.target) < DETAIL.near;
  const on = !state.drive && state.layer === 'sat' && close;
  if (detail.mesh) detail.mesh.visible = on;
  if (!on || detail.busy) return;
  const tg = controls.target;
  if (Math.abs(tg.x) > widthM / 2 || Math.abs(tg.z) > heightM / 2) return; // fuera del DTM no hay detalle
  if (detail.mesh && Math.hypot(tg.x - detail.cx, tg.z - detail.cz) < DETAIL.size * 0.22) return;
  detail.busy = true;
  const cx = tg.x;
  const cz = tg.z;
  buildDetail(cx, cz).then(({ mesh, map }) => {
    const mat = mesh.material;
    const old = mat.map;
    mat.map = map;
    if (old !== map) old.dispose();
    if (detail.mesh) { world.remove(detail.mesh); detail.mesh.geometry.dispose(); }
    Object.assign(detail, { mesh, cx, cz });
    world.add(mesh);
  }).catch((err) => console.warn('Detalle HiRISE:', err)).finally(() => { detail.busy = false; });
});

// ---------- Presentación (común con el mapa: present.js) e intro ----------
const stage = document.querySelector('.stage');
const onFrame = (fn) => { frameHooks.add(fn); return () => frameHooks.delete(fn); };
// Depuración: 3d.html#debug expone el estado interno en window.__ares
if (/debug/.test(location.hash) || window.__aresDebug) window.__ares = { scene, camera, renderer, drive, dust, tracks, state, get rig() { return roverRig; } };
const presentApi = {
  THREE, camera, controls, state, plan, stage, onFrame,
  get planDock() { return planDock; },
  worldPoint, setLayer, setExaggeration, overview, homeView, frameRoute, tweenOrbit,
  enterDrive, exitDrive: () => overview(), setHour, toggleDay, showArrival, mission,
  preloadRover: () => preloadDrive(),
  center: () => new THREE.Vector3(0, ((hMin + hMax) / 2 - elevRef) * state.exag, 0),
  radiation: () => radiationGrid(),
  zoneSize: { w: widthM, h: heightM },
  get timeOfDay() { return timeOfDay; },
};
const presentReady = Promise.race([textureDone, new Promise((r) => { setTimeout(r, 6000); })]);
if (wantsDrive) {
  // Viene del mapa al crear una ruta: telón negro con el nombre de la ruta, vuelo hasta detrás del rover y arranca
  const cover = document.createElement('div');
  cover.className = 'cine-cover';
  cover.innerHTML = `<span class="cine-kicker">Al volante</span><h2>${plan.labels.join(' · ')}</h2>
    <p class="mono">${fmt.km(plan.stats.distance_m)} · ${formatHours(plan.stats.hours)} · +${num(plan.stats.ascent_m)} m</p>`;
  stage.append(cover);
  const P = activePath();
  const s0 = worldPoint(...sceneToLonLat(P.x[0], P.z[0]));
  controls.target.copy(s0);
  camera.position.copy(s0).add(new THREE.Vector3(-2500, 3200, 2600));
  controls.update();
  // Basta con el modelo para empezar: el suelo y los shaders se terminan de preparar durante el vuelo,
  // con la cámara aún alta (el rover se ve pequeño y un tirón no se nota)
  preloadDrive();
  ensureRover({ quiet: true }).then(async () => {
    await enterDrive('chase', { long: true, autoplay: true });
    cover.classList.add('out');
    setTimeout(() => cover.remove(), 900);
  });
} else {
  // Precarga cuando la página ya está pintada (no compite con la carga inicial)
  setTimeout(() => preloadDrive(), wantsIntro ? 2500 : 800);
}
import('./present.js').then(({ startPresentation }) => startPresentation({ page: '3d', api: presentApi, ready: presentReady }));
if (wantsIntro) {
  try { sessionStorage.setItem('ares:intro', '1'); } catch { /* sin almacenamiento: se verá cada vez */ }
  import('./intro.js').then(({ runIntro }) => runIntro({
    THREE, camera, controls, stage, onFrame,
    onTour: () => document.querySelector('[data-present]')?.click(),
    meta: `Cráter Jezero · ${num(Math.abs(latC), 1)}° N ${num(lonC, 1)}° E · relieve real de ${dem.resolution_m} m · ruta de ${fmt.km(plan.stats.distance_m)}`,
  }));
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
resolveTextureDone();
