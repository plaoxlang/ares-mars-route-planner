// Relieve de la zona de trabajo: carga el DTM (generado por scripts/jezero/fetch-dem.mjs),
// lo muestrea y calcula pendiente y sombreado. Lo usan la vista 2D y la 3D.
import { M_PER_DEG, loadJson } from './shared.js';

export async function loadDem(base) {
  const [meta, buf] = await Promise.all([
    loadJson(`${base}.json`),
    fetch(`${base}.bin`).then((r) => {
      if (!r.ok) throw new Error(`${base}.bin: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const { width, height } = meta;
  const raw = new Int16Array(buf); // little-endian, como todos los navegadores actuales
  const heights = new Float32Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] === meta.nodata ? NaN : raw[i] * meta.scale;
    heights[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (let i = 0; i < heights.length; i++) if (Number.isNaN(heights[i])) heights[i] = min;

  const latC = (meta.north + meta.south) / 2;
  const pxX = ((meta.east - meta.west) / width) * M_PER_DEG * Math.cos((latC * Math.PI) / 180);
  const pxY = ((meta.north - meta.south) / height) * M_PER_DEG;

  // Coordenadas de píxel (centro del píxel = entero) a partir de lon/lat.
  const toPixel = (lon, lat) => [
    ((lon - meta.west) / (meta.east - meta.west)) * width - 0.5,
    ((meta.north - lat) / (meta.north - meta.south)) * height - 0.5,
  ];
  const sample = (fx, fy) => bilinear(heights, width, height, fx, fy);
  return {
    ...meta,
    heights,
    min,
    max,
    pxX,
    pxY,
    toPixel,
    sample,
    at: (lon, lat) => sample(...toPixel(lon, lat)),
  };
}

export function bilinear(grid, w, h, fx, fy) {
  const x = Math.min(Math.max(fx, 0), w - 1.001);
  const y = Math.min(Math.max(fy, 0), h - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const i = y0 * w + x0;
  return (grid[i] * (1 - tx) + grid[i + 1] * tx) * (1 - ty)
    + (grid[i + w] * (1 - tx) + grid[i + w + 1] * tx) * ty;
}

// Media móvil separable (ventana deslizante: coste independiente del radio).
export function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    let c = 0;
    for (let k = 0; k <= Math.min(w - 1, r); k++) { s += src[row + k]; c += 1; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / c;
      if (x + r + 1 < w) { s += src[row + x + r + 1]; c += 1; }
      if (x - r >= 0) { s -= src[row + x - r]; c -= 1; }
    }
  }
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k <= Math.min(h - 1, r); k++) { s += tmp[k * w + x]; c += 1; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / c;
      if (y + r + 1 < h) { s += tmp[(y + r + 1) * w + x]; c += 1; }
      if (y - r >= 0) { s -= tmp[(y - r) * w + x]; c -= 1; }
    }
  }
  return out;
}

export function blurPasses(src, w, h, r, passes) {
  let out = src;
  for (let i = 0; i < passes; i++) out = boxBlur(out, w, h, r);
  return out;
}

// Pendiente (grados) y sombreado (0–1, luz del noroeste a 45°) por píxel.
// El DTM CTX tiene algo de ruido a escala de píxel: se suaviza ligeramente (≈60 m).
export function terrainDerivatives(dem, { smoothR = 1, passes = 1, shadeGain = 2 } = {}) {
  const { width: w, height: h, pxX, pxY } = dem;
  const hm = blurPasses(dem.heights, w, h, smoothR, passes);
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const sun = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
  const slope = new Float32Array(w * h);
  const shade = new Float32Array(w * h);
  const idx = (x, y) => Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dE = (hm[idx(x + 1, y)] - hm[idx(x - 1, y)]) / (2 * pxX);
      const dN = (hm[idx(x, y - 1)] - hm[idx(x, y + 1)]) / (2 * pxY); // y de la imagen crece hacia el sur
      const i = y * w + x;
      slope[i] = (Math.atan(Math.hypot(dE, dN)) * 180) / Math.PI;
      const n = [-dE * shadeGain, -dN * shadeGain, 1];
      const len = Math.hypot(...n);
      shade[i] = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / len);
    }
  }
  return { slope, shade };
}

// Lienzo del tamaño del DTM pintado píxel a píxel. colorAt(i) → [r, g, b] o [r, g, b, a].
export function pixelCanvas(w, h, colorAt) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const [r, gg, b, a = 255] = colorAt(i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}
