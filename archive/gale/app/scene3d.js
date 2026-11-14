// Vista 3D del terreno de Gale con la ruta de Curiosity.
// Relieve: teselas DEM de Mars Trek (gris de 8 bits proporcional a la altura), calibradas
// con las alturas reales de las paradas. Textura: CTX + HiRISE de Mars Trek.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  TREK, M_PER_DEG, tiltClass, TILT_LABEL, colors, fmt, $, loadJson, indexFromHash,
  THEMIS_NIGHT, COLD_RAMP, rampCss, colorizeCold, loadWeather, weatherRows, setupWeatherPanel,
  hexRgb, rampRgb,
} from './shared.js';

const DEM = { layer: 'Gale_DEM_SMG_1m', ext: 'png', z: 12 };
const TEXTURES = [
  { layer: 'Gale_CTX_BlockAdj_dd', ext: 'png', z: 12, label: 'CTX' },
  { layer: 'curiosity_hirise_mosaic', ext: 'png', z: 13, label: 'HiRISE' },
];
const DEM_BOUNDS = { west: 137.1225, east: 137.7298, south: -4.9255, north: -4.2490 };
const PAD_DEG = 0.012;
const MAX_SEGMENTS = 640; // resolución máxima de la malla por lado
const SMOOTH_RADIUS_PX = 3; // suavizado para ocultar los escalones de 8 bits
const ROUTE_LIFT_M = 6; // la ruta flota un poco sobre el terreno para que se vea
const EYE_HEIGHT_M = 1.8;

const COLORS = colors();
const state = { idx: 0, exag: 2, follow: true, astro: false, playing: null, layer: 'sat' };

// ---------- Carga ----------
const progress = { done: 0, total: 0 };
function setLoading(title, detail) {
  $('loading-title').textContent = title;
  $('loading-detail').textContent = detail ?? '';
  $('loading-bar').style.width = progress.total ? `${(100 * progress.done) / progress.total}%` : '0';
}

async function loadTile(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  } finally {
    progress.done += 1;
  }
}

const tileUrl = (src, z, r, c) => TREK(src.layer, src.ext).replace('{z}', z).replace('{y}', r).replace('{x}', c);

function tileRange(ext, z) {
  const d = 180 / 2 ** z;
  return {
    d,
    c0: Math.floor((ext.west + 180) / d),
    c1: Math.floor((ext.east + 180) / d - 1e-9),
    r0: Math.floor((90 - ext.north) / d),
    r1: Math.floor((90 - ext.south) / d - 1e-9),
  };
}

// Pinta en ctx las teselas de una capa que cubren ext, colocándolas por coordenadas
// (sirve aunque ext no esté alineado a la rejilla de esa capa).
async function drawMosaic(src, ext, ctx, onTile) {
  const t = tileRange(ext, src.z);
  const sx = ctx.canvas.width / (ext.east - ext.west);
  const sy = ctx.canvas.height / (ext.north - ext.south);
  const jobs = [];
  for (let r = t.r0; r <= t.r1; r++) {
    for (let c = t.c0; c <= t.c1; c++) {
      const x = (c * t.d - 180 - ext.west) * sx;
      const y = (ext.north - (90 - r * t.d)) * sy;
      jobs.push(loadTile(tileUrl(src, src.z, r, c)).then((bmp) => {
        if (bmp) ctx.drawImage(bmp, x, y, t.d * sx, t.d * sy);
        onTile?.();
      }));
    }
  }
  progress.total += jobs.length;
  await Promise.all(jobs);
}

// ---------- Datos de ruta ----------
const [elev, weather] = await Promise.all([
  loadJson('data/export/elevation_waypoints.json'),
  loadWeather(),
]);
const pts = elev.points;
renderStats(elev.meta.summary);

// Clima REMS por parada, umbrales de aviso y modo de color de la ruta.
const climate = setupWeatherPanel({
  pts,
  weather,
  onChange() {
    recolorRoute();
    climate.renderStopAlerts(state.idx);
  },
});

// Extensión: caja de la ruta con margen, recortada a la cobertura del DEM y alineada a teselas.
const raw = {
  west: Math.max(DEM_BOUNDS.west, Math.min(...pts.map((p) => p.lon)) - PAD_DEG),
  east: Math.min(DEM_BOUNDS.east, Math.max(...pts.map((p) => p.lon)) + PAD_DEG),
  south: Math.max(DEM_BOUNDS.south, Math.min(...pts.map((p) => p.lat)) - PAD_DEG),
  north: Math.min(DEM_BOUNDS.north, Math.max(...pts.map((p) => p.lat)) + PAD_DEG),
};
const tr = tileRange(raw, DEM.z);
const ext = {
  west: tr.c0 * tr.d - 180,
  east: (tr.c1 + 1) * tr.d - 180,
  north: 90 - tr.r0 * tr.d,
  south: 90 - (tr.r1 + 1) * tr.d,
};
const lonC = (ext.west + ext.east) / 2;
const latC = (ext.south + ext.north) / 2;
const cosLat = Math.cos((latC * Math.PI) / 180);
const widthM = (ext.east - ext.west) * cosLat * M_PER_DEG;
const heightM = (ext.north - ext.south) * M_PER_DEG;

// ---------- Relieve ----------
setLoading('Cargando relieve…', 'Teselas DEM HiRISE de Mars Trek');
const demW = (tr.c1 - tr.c0 + 1) * 256;
const demH = (tr.r1 - tr.r0 + 1) * 256;
const demCtx = new OffscreenCanvas(demW, demH).getContext('2d', { willReadFrequently: true });
const progressTimer = setInterval(() => setLoading('Cargando relieve…', `${progress.done}/${progress.total} teselas`), 200);
await drawMosaic(DEM, ext, demCtx);
clearInterval(progressTimer);

const px = demCtx.getImageData(0, 0, demW, demH).data;
const gray = new Float32Array(demW * demH);
for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4 + 3] === 0 ? NaN : px[i * 4];

const toPixel = (lon, lat) => [
  ((lon - ext.west) / (ext.east - ext.west)) * demW,
  ((ext.north - lat) / (ext.north - ext.south)) * demH,
];

// Calibración lineal gris → metros con las paradas que caen dentro.
const calib = (() => {
  const xs = [];
  const ys = [];
  for (const p of pts) {
    const [x, y] = toPixel(p.lon, p.lat).map(Math.floor);
    if (x < 0 || y < 0 || x >= demW || y >= demH) continue;
    const g = gray[y * demW + x];
    if (Number.isNaN(g)) continue;
    xs.push(g);
    ys.push(p.elev_m);
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const a = sxy / sxx;
  const b = my - a * mx;
  const rmse = Math.sqrt(xs.reduce((s, x, i) => s + (a * x + b - ys[i]) ** 2, 0) / n);
  return { a, b, n, rmse };
})();

$('calib').textContent = `Calibración con ${calib.n} paradas: 1 nivel de gris ≈ ${calib.a.toFixed(1)} m; `
  + `error medio ±${calib.rmse.toFixed(1)} m antes de suavizar. Válido para ver el relieve general, no para detalle de metros.`;

// Alturas en metros + suavizado normalizado (ignora huecos sin datos).
const heights = (() => {
  const h = new Float32Array(gray.length);
  for (let i = 0; i < h.length; i++) h[i] = Number.isNaN(gray[i]) ? NaN : calib.a * gray[i] + calib.b;
  let out = h;
  for (let pass = 0; pass < 2; pass++) out = boxBlur(out, demW, demH, SMOOTH_RADIUS_PX);
  let min = Infinity;
  for (const v of out) if (!Number.isNaN(v) && v < min) min = v;
  for (let i = 0; i < out.length; i++) if (Number.isNaN(out[i])) out[i] = min;
  return out;
})();

// Media móvil separable (ventana deslizante, coste independiente del radio) que ignora huecos NaN.
function boxBlur(src, w, h, r) {
  const sum = new Float32Array(w * h);
  const cnt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    let c = 0;
    for (let k = 0; k <= Math.min(w - 1, r); k++) {
      const v = src[row + k];
      if (!Number.isNaN(v)) { s += v; c += 1; }
    }
    for (let x = 0; x < w; x++) {
      sum[row + x] = s;
      cnt[row + x] = c;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w && !Number.isNaN(src[row + add])) { s += src[row + add]; c += 1; }
      if (rem >= 0 && !Number.isNaN(src[row + rem])) { s -= src[row + rem]; c -= 1; }
    }
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k <= Math.min(h - 1, r); k++) { s += sum[k * w + x]; c += cnt[k * w + x]; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = c ? s / c : NaN;
      const add = y + r + 1;
      const rem = y - r;
      if (add < h) { s += sum[add * w + x]; c += cnt[add * w + x]; }
      if (rem >= 0) { s -= sum[rem * w + x]; c -= cnt[rem * w + x]; }
    }
  }
  return out;
}

const blurPasses = (src, r, passes) => {
  let out = src;
  for (let i = 0; i < passes; i++) out = boxBlur(out, demW, demH, r);
  return out;
};

function sampleHeight(fx, fy) {
  const x = Math.min(Math.max(fx, 0), demW - 1.001);
  const y = Math.min(Math.max(fy, 0), demH - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * demW + x0;
  return (heights[i] * (1 - tx) + heights[i + 1] * tx) * (1 - ty)
    + (heights[i + demW] * (1 - tx) + heights[i + demW + 1] * tx) * ty;
}
const terrainAt = (lon, lat) => sampleHeight(...toPixel(lon, lat));

let elevRef = Infinity;
for (const v of heights) if (v < elevRef) elevRef = v;

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
scene.background = new THREE.Color('#1a110e');
scene.fog = new THREE.Fog('#1a110e', 25000, 60000);

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
const hiTiles = tileRange(ext, TEXTURES.at(-1).z);
let texW = (hiTiles.c1 - hiTiles.c0 + 1) * 256;
let texH = (hiTiles.r1 - hiTiles.r0 + 1) * 256;
const texScale = Math.min(1, maxTex / Math.max(texW, texH));
texW = Math.floor(texW * texScale);
texH = Math.floor(texH * texScale);
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
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const ELEV_RAMP = ['#1b2a8a', '#1f78c8', '#28b4a0', '#7bc85a', '#e3d45a', '#e8903c', '#c8503c', '#f2efe9'].map(hex);
const rampColor = (t) => {
  const s = Math.min(0.9999, Math.max(0, t)) * (ELEV_RAMP.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  return ELEV_RAMP[i].map((v, k) => v + (ELEV_RAMP[i + 1][k] - v) * f);
};
let hMin = Infinity;
let hMax = -Infinity;
for (const v of heights) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }

// Pendiente y sombreado por píxel (se calcula al pedirlo). El DEM es de 8 bits: cada nivel
// son ~18 m, y en pendientes suaves esos escalones aparecen como bandas falsas de pendiente.
// Por eso las derivadas se calculan sobre un relieve mucho más suavizado que la malla.
const SLOPE_SMOOTH = { r: 16, passes: 3 }; // ≈ gaussiana de σ ~16 px (~160 m)
const SHADE_SMOOTH = { r: 6, passes: 3 };
let derivs = null;
function terrainDerivs() {
  if (derivs) return derivs;
  const pxX = widthM / demW;
  const pxY = heightM / demH;
  const forSlope = blurPasses(heights, SLOPE_SMOOTH.r, SLOPE_SMOOTH.passes);
  const forShade = blurPasses(heights, SHADE_SMOOTH.r, SHADE_SMOOTH.passes);
  const az = (315 * Math.PI) / 180; // luz desde el noroeste, como los mapas de sombreado clásicos
  const alt = (45 * Math.PI) / 180;
  const sun = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
  const slope = new Float32Array(demW * demH);
  const shade = new Float32Array(demW * demH);
  const idx = (x, y) => Math.min(demH - 1, Math.max(0, y)) * demW + Math.min(demW - 1, Math.max(0, x));
  const grad = (hm, x, y) => [
    (hm[idx(x + 1, y)] - hm[idx(x - 1, y)]) / (2 * pxX),
    (hm[idx(x, y - 1)] - hm[idx(x, y + 1)]) / (2 * pxY), // y de la imagen crece hacia el sur
  ];
  for (let y = 0; y < demH; y++) {
    for (let x = 0; x < demW; x++) {
      const i = y * demW + x;
      const [sE, sN] = grad(forSlope, x, y);
      slope[i] = (Math.atan(Math.hypot(sE, sN)) * 180) / Math.PI;
      const [dE, dN] = grad(forShade, x, y);
      const k = 3; // realza el sombreado sobre un relieve ya suavizado
      const n = [-dE * k, -dN * k, 1];
      const len = Math.hypot(...n);
      shade[i] = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / len);
    }
  }
  derivs = { slope, shade };
  return derivs;
}

function pixelLayer(colorAt) {
  const c = document.createElement('canvas');
  c.width = demW;
  c.height = demH;
  const g = c.getContext('2d');
  const img = g.createImageData(demW, demH);
  for (let i = 0; i < demW * demH; i++) {
    const [r, gg, b] = colorAt(i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return makeTexture(c);
}

const SLOPE_COLORS = { ok: hex(COLORS.ok), warn: hex(COLORS.warn), bad: hex(COLORS.bad) };
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

// ---------- Radiación estimada (modelo, no medida) ----------
// Dosis = medida media de RAD en Gale × (cielo visible / cielo visible en el aterrizaje)
//         × efecto de la altitud (menos atmósfera encima → algo más de dosis).
// No incluye el ciclo solar ni tormentas solares (SPE), que cambian la dosis en el tiempo.
const RAD = {
  base_mSv_day: 0.64, // RAD/Curiosity en superficie, Gale (Hassler et al., 2014, Science): 0,64 ± 0,12 mSv/día
  scaleHeight_m: 11100, // altura de escala de la atmósfera de Marte
  columnSensitivity: 0.4, // supuesto: % de cambio de dosis por % de cambio de columna atmosférica (ajustable)
  horizonRadius_m: 3000, // hasta dónde se busca relieve que tape el cielo
  dirs: 16,
  step: 6, // la rejilla se calcula cada 6 px del DEM (~60 m) y se interpola
};
const RAD_RAMP = ['#1d4f4a', '#2f8f6f', '#9ccf5a', '#f2d45a', '#f28a3c', '#d9435a'].map(hexRgb);

let radCache = null;
function radiationGrid() {
  if (radCache) return radCache;
  const { step } = RAD;
  const gw = Math.ceil(demW / step);
  const gh = Math.ceil(demH / step);
  const pxX = widthM / demW;
  const pxY = heightM / demH;
  const dists = [];
  for (let d = 30; d <= RAD.horizonRadius_m; d *= 1.25) dists.push(d);
  const dirs = Array.from({ length: RAD.dirs }, (_, k) => {
    const a = (2 * Math.PI * k) / RAD.dirs;
    return [Math.sin(a) / pxX, -Math.cos(a) / pxY]; // píxeles por metro hacia (este, norte)
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

  const [rx, ry] = toPixel(pts[0].lon, pts[0].lat); // referencia: lugar de aterrizaje
  const ref = { svf: svfAt(rx, ry), h: sampleHeight(rx, ry) };
  const dose = (svf, h) => RAD.base_mSv_day * (svf / ref.svf)
    * Math.exp((RAD.columnSensitivity * (h - ref.h)) / RAD.scaleHeight_m);

  const grid = new Float32Array(gw * gh);
  let min = Infinity;
  let max = -Infinity;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(gx * step, demW - 1);
      const y = Math.min(gy * step, demH - 1);
      const v = dose(svfAt(x, y), sampleHeight(x, y));
      grid[gy * gw + gx] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  // Interpolación bilineal en coordenadas de píxel del DEM.
  const sample = (x, y) => {
    const fx = Math.min(Math.max(x / step, 0), gw - 1.001);
    const fy = Math.min(Math.max(y / step, 0), gh - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i = y0 * gw + x0;
    const i1 = Math.min(i + 1, grid.length - 1);
    const i2 = Math.min(i + gw, grid.length - 1);
    const i3 = Math.min(i + gw + 1, grid.length - 1);
    return (grid[i] * (1 - tx) + grid[i1] * tx) * (1 - ty) + (grid[i2] * (1 - tx) + grid[i3] * tx) * ty;
  };
  radCache = { grid, gw, gh, min, max, sample, at: (lon, lat) => sample(...toPixel(lon, lat)) };
  return radCache;
}

const LAYERS = {
  sat: { texture },
  color: {
    async build() {
      colorLayer.viking = document.createElement('canvas');
      colorLayer.viking.width = 256;
      colorLayer.viking.height = Math.round((256 * texH) / texW);
      await drawMosaic(VIKING, ext, colorLayer.viking.getContext('2d'));
      colorLayer.canvas = document.createElement('canvas');
      colorLayer.canvas.width = texW;
      colorLayer.canvas.height = texH;
      const t = makeTexture(colorLayer.canvas);
      LAYERS.color.texture = t;
      composeColor();
      return t;
    },
  },
  elev: {
    build() {
      const { shade } = terrainDerivs();
      return pixelLayer((i) => {
        const s = 0.55 + 0.45 * shade[i];
        return rampColor((heights[i] - hMin) / (hMax - hMin)).map((v) => v * s);
      });
    },
  },
  slope: {
    build() {
      const { slope, shade } = terrainDerivs();
      return pixelLayer((i) => {
        const s = 0.6 + 0.4 * shade[i];
        return SLOPE_COLORS[tiltClass(slope[i])].map((v) => v * s);
      });
    },
  },
  cold: {
    // THEMIS IR nocturno (~100 m/px) reescalado a la rejilla del relieve, coloreado y sombreado.
    async build() {
      const c = document.createElement('canvas');
      c.width = demW;
      c.height = demH;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      await drawMosaic(THEMIS_NIGHT, ext, g);
      const img = g.getImageData(0, 0, demW, demH);
      colorizeCold(img.data);
      const { shade } = terrainDerivs();
      return pixelLayer((i) => {
        const s = 0.65 + 0.35 * shade[i];
        return [img.data[i * 4] * s, img.data[i * 4 + 1] * s, img.data[i * 4 + 2] * s];
      });
    },
  },
  rad: {
    build() {
      const r = radiationGrid();
      const { shade } = terrainDerivs();
      const span = r.max - r.min || 1;
      return pixelLayer((i) => {
        const x = i % demW;
        const y = Math.floor(i / demW);
        const s = 0.7 + 0.3 * shade[i];
        return rampRgb(RAD_RAMP, (r.sample(x, y) - r.min) / span).map((v) => v * s);
      });
    },
  },
};

async function setLayer(key) {
  const layer = LAYERS[key];
  state.layer = key;
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
    const stops = ELEV_RAMP.map((c) => `rgb(${c.join(',')})`).join(',');
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${stops})"></div>
      <div class="ramp-labels mono"><span>${fmt.m(hMin)}</span><span>${fmt.m(hMax)}</span></div>
      <p>Altura del modelo respecto al areoide, con sombreado del relieve.</p>`;
  } else if (key === 'slope') {
    el.innerHTML = `<div class="legend"><i class="sw ok"></i>&lt; 8° <i class="sw warn"></i>8–15° <i class="sw bad"></i>&gt; 15°</div>
      <p>Pendiente media del terreno a escala de ~300 m (el relieve de 8 bits no da para más). Orienta sobre laderas y cañones; las pendientes locales (rocas, escalones) pueden ser bastante mayores.</p>`;
  } else if (key === 'rad') {
    const r = radiationGrid();
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(RAD_RAMP)})"></div>
      <div class="ramp-labels mono"><span>${r.min.toFixed(2)}</span><span>${r.max.toFixed(2)} mSv/día</span></div>
      <p><strong>Estimación, no medida.</strong> Base: ${RAD.base_mSv_day} mSv/día medidos por RAD (Curiosity) en Gale,
      ajustada por el cielo visible (el relieve bloquea parte de la radiación) y por la altitud (menos atmósfera encima).
      No incluye el ciclo solar ni tormentas solares.</p>`;
  } else if (key === 'cold') {
    el.innerHTML = `<div class="ramp" style="background:linear-gradient(to right,${rampCss(COLD_RAMP)})"></div>
      <div class="ramp-labels"><span>más frío de noche</span><span>más templado</span></div>
      <p>THEMIS IR nocturno (~100 m/px). Relativo, no son grados: la arena y el polvo se enfrían más que la roca. Puede haber cortes entre franjas tomadas en noches distintas.</p>`;
  } else if (key === 'color') {
    el.innerHTML = '<p>Detalle de HiRISE/CTX con el color de Viking (~300 m/px). Color aproximado, no es una foto en color real.</p>';
  } else {
    el.innerHTML = '<p>MRO HiRISE (~25 cm/px de origen) sobre MRO CTX (~6 m/px). Escala de grises.</p>';
  }
}

// Ruta: apoyada sobre el terreno, coloreada por inclinación o temperatura (tarjeta de clima).
const routePos = [];
for (const p of pts) {
  const v = toLocal(p.lon, p.lat, terrainAt(p.lon, p.lat) + ROUTE_LIFT_M);
  routePos.push(v.x, v.y, v.z);
}
const routeGeo = new LineGeometry();
routeGeo.setPositions(routePos);
function routeColors() {
  const tmp = new THREE.Color();
  return pts.flatMap((_, i) => tmp.set(climate.colorAt(i)).toArray());
}
function recolorRoute() {
  routeGeo.setColors(routeColors());
}
routeGeo.setColors(routeColors());
const routeMat = new LineMaterial({ linewidth: 3, vertexColors: true });
world.add(new Line2(routeGeo, routeMat));

const doneGeo = new LineGeometry();
doneGeo.setPositions(routePos.map((v, i) => (i % 3 === 1 ? v + 2 : v)));
const doneMat = new LineMaterial({ color: COLORS.accent, linewidth: 6 });
const doneLine = new Line2(doneGeo, doneMat);
world.add(doneLine);

// Marcador del rover (fuera de world para no deformarlo con la exageración).
const rover = new THREE.Group();
// Visible a través del relieve (depthTest off) para no perderlo en la vista general.
const markerMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthTest: false,
});
const head = new THREE.Mesh(new THREE.SphereGeometry(35, 24, 16), markerMat('#ffffff'));
head.renderOrder = 10;
rover.add(head);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 900, 12), markerMat(COLORS.accent, 0.7));
beam.renderOrder = 9;
beam.position.y = 450;
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
const SKY = { space: new THREE.Color('#1a110e'), mars: new THREE.Color('#c79f7f') };

function setAstroMode(on) {
  state.astro = on;
  rover.visible = !on;
  beacon.visible = on;
  routeLines.forEach((l) => { l.visible = !on; });
  scene.background = on ? SKY.mars : SKY.space;
  scene.fog.color.copy(on ? SKY.mars : SKY.space);
  scene.fog.near = on ? 400 : 25000;
  scene.fog.far = on ? 9000 : 60000;
  $('astro').setAttribute('aria-pressed', String(on));
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
  const p = pts[state.idx];
  const target = worldPoint(p.lon, p.lat);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(2500, 3500 * Math.max(1, state.exag / 2), 4500));
  controls.update();
}

// Vista cenital: cámara vertical con el norte arriba, como un mapa 2D.
function topView() {
  setAstroMode(false);
  const p = pts[state.idx];
  const target = state.follow ? worldPoint(p.lon, p.lat) : new THREE.Vector3(0, ((hMin + hMax) / 2 - elevRef) * state.exag, 0);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const fit = state.follow ? 6000 : Math.max(heightM, widthM / camera.aspect);
  const dist = (fit / 2 / Math.tan(halfFov)) * 1.05;
  controls.target.copy(target);
  camera.position.set(target.x, target.y + dist, target.z + 1); // +1 m al sur: evita el polo de OrbitControls
  controls.update();
}

function astronautView() {
  setAstroMode(true);
  const i = state.idx;
  const p = pts[i];
  const q = i < pts.length - 1 ? pts[i + 1] : pts[i - 1]; // mirar hacia la siguiente parada
  const eye = worldPoint(p.lon, p.lat, EYE_HEIGHT_M + 2);
  const ahead = worldPoint(q.lon, q.lat);
  const dir = ahead.clone().sub(eye).setY(0);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  dir.normalize();
  const look = eye.clone().addScaledVector(dir, 300);
  look.y = worldPoint(p.lon + (q.lon - p.lon) * 3, p.lat + (q.lat - p.lat) * 3).y + EYE_HEIGHT_M;
  camera.position.copy(eye);
  controls.target.copy(look);
  controls.update();
  beacon.position.copy(ahead);
}

function select(i, { moveCamera = true } = {}) {
  const prevTarget = rover.position.clone();
  state.idx = i;
  const p = pts[i];
  $('slider').value = String(i);
  $('slider-label').textContent = `Parada ${i + 1}/${pts.length} · Sol ${p.sol}`;
  $('to-other-view').href = `index.html#i=${i}`;
  history.replaceState(null, '', `#i=${i}`);

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
  $('exag-label').textContent = `${v}×`;
  const p = pts[state.idx];
  rover.position.copy(worldPoint(p.lon, p.lat, ROUTE_LIFT_M * v));
  if (state.astro) astronautView();
}

function renderStop(p, i) {
  const prev = pts[i - 1];
  const climb = prev ? p.elev_m - prev.elev_m : 0;
  const model = terrainAt(p.lon, p.lat);
  const cls = tiltClass(p.tilt_deg);
  const rows = [
    ['Sol', p.sol],
    ['Elevación real', fmt.m(p.elev_m)],
    ['Modelo 3D', `${fmt.m(model)} (${model - p.elev_m >= 0 ? '+' : ''}${(model - p.elev_m).toFixed(0)} m)`],
    ['Δ desde anterior', `${climb >= 0 ? '+' : ''}${climb.toFixed(1)} m en ${fmt.m(p.dist_from_prev_m)}`],
    ['Recorrido total', fmt.km(p.dist_total_m)],
    ['Inclinación', `${fmt.deg(p.tilt_deg)} <span class="badge ${cls}">${TILT_LABEL[cls]}</span>`],
    ['Radiación (est.)', `${radiationGrid().at(p.lon, p.lat).toFixed(2)} mSv/día`],
    ...weatherRows(climate.wx[i]),
  ];
  $('stop-details').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  climate.renderStopAlerts(i);
}

function renderStats(s) {
  const items = [
    [fmt.km(s.distance_m), 'recorrido'],
    [fmt.m(s.elev_end_m - s.elev_start_m), 'desnivel neto'],
    [fmt.m(s.cumulative_gain_m), 'subida acumulada'],
  ];
  $('stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
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
  if (state.idx >= pts.length - 1) select(0);
  btn.textContent = '❚❚';
  btn.setAttribute('aria-pressed', 'true');
  state.playing = setInterval(() => {
    if (state.idx >= pts.length - 1) return togglePlay();
    select(state.idx + 1);
  }, 80);
}

const slider = $('slider');
slider.max = String(pts.length - 1);
slider.addEventListener('input', () => select(Number(slider.value)));
$('play').addEventListener('click', togglePlay);
$('exag').addEventListener('input', (e) => setExaggeration(Number(e.target.value)));
$('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
$('astro').addEventListener('click', astronautView);
$('overview').addEventListener('click', overview);
$('top').addEventListener('click', topView);
$('layer').addEventListener('change', (e) => setLayer(e.target.value));
renderLegend(state.layer);
document.addEventListener('keydown', (e) => {
  if (e.target === slider) return;
  if (e.key === 'ArrowRight') select(Math.min(state.idx + 1, pts.length - 1));
  if (e.key === 'ArrowLeft') select(Math.max(state.idx - 1, 0));
});

setExaggeration(state.exag);
select(indexFromHash(pts.length - 1), { moveCamera: false });
overview();
$('loading').hidden = true;

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

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
progress.done = 0;
progress.total = 0;
const texTimer = setInterval(() => {
  texStatus.textContent = `Cargando imagen: ${progress.done}/${progress.total} teselas`;
}, 250);
for (const src of TEXTURES) {
  // eslint-disable-next-line no-await-in-loop
  await drawMosaic(src, ext, texCtx, markDirty);
}
clearInterval(texTimer);
texStatus.textContent = '';
markDirty();
