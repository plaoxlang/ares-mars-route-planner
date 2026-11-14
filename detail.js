// Detalle de suelo procedimental: regolito, grano y gravilla a escala de centímetros.
// La imagen real más fina de Jezero es HiRISE (25 cm/px) y el relieve es un DTM de 20 m: a la altura
// de la cámara de un rover eso se ve como una mancha. Esta textura se multiplica sobre la foto real
// y añade un mapa de normales para que la luz rasante saque grano. Es solo aspecto: no cambia
// ni el relieve ni la imagen de satélite, ni lo que "siente" la suspensión del rover.
import * as THREE from 'three';

const N = 512; // píxeles de la tesela (se repite sin costuras)

// Generador pseudoaleatorio con semilla: el suelo es el mismo en cada carga.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de gradiente (Perlin) periódico, cerrado sobre sí mismo para que la tesela no tenga juntas.
// (El ruido de valor deja pliegues alineados con la rejilla que, en el mapa de normales, se ven como una retícula.)
function addNoise(out, period, amp, rand) {
  const gx = new Float32Array(period * period);
  const gy = new Float32Array(period * period);
  for (let i = 0; i < gx.length; i++) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (ix, iy, dx, dy) => {
    const k = (iy % period) * period + (ix % period);
    return gx[k] * dx + gy[k] * dy;
  };
  for (let y = 0; y < N; y++) {
    const fy = (y / N) * period;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const v = fade(ty);
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * period;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const u = fade(tx);
      const a = dot(x0, y0, tx, ty) + (dot(x0 + 1, y0, tx - 1, ty) - dot(x0, y0, tx, ty)) * u;
      const b = dot(x0, y0 + 1, tx, ty - 1) + (dot(x0 + 1, y0 + 1, tx - 1, ty - 1) - dot(x0, y0 + 1, tx, ty - 1)) * u;
      out[y * N + x] += (a + (b - a) * v) * amp * 1.6;
    }
  }
}

function buildFields() {
  const rand = rng(20210218); // aterrizaje de Perseverance
  const height = new Float32Array(N * N);
  const albedo = new Float32Array(N * N);
  // Dos escalas en canales separados: si el grano fino llevara también manchas grandes, al repetirse
  // la tesela cada pocos metros esas manchas formarían filas visibles.
  // R (fino): regolito de alta frecuencia + gravilla. G (moteado): polvo claro / arena oscura a gran escala.
  const fineH = new Float32Array(N * N);
  for (const [p, a] of [[16, 0.32], [32, 0.2], [64, 0.12], [128, 0.07], [256, 0.04]]) addNoise(fineH, p, a, rand);
  for (const [p, a] of [[4, 0.3], [8, 0.25]]) addNoise(height, p, a, rand); // ondulación suave, solo para normales
  for (let i = 0; i < N * N; i++) { height[i] += fineH[i]; albedo[i] = fineH[i] * 0.3; }
  const tone = new Float32Array(N * N);
  for (const [p, a] of [[3, 0.6], [6, 0.35], [12, 0.2], [24, 0.1]]) addNoise(tone, p, a, rand);
  const cluster = new Float32Array(N * N);
  for (const [p, a] of [[8, 0.6], [16, 0.3]]) addNoise(cluster, p, a, rand);

  // Gravilla: muchas piedras pequeñas y pocas grandes (distribución de tamaños tipo potencia),
  // agrupadas en manchas (donde el "tono" es alto) y casi ausentes en las zonas de arena.
  const pebbles = 2600;
  for (let k = 0; k < pebbles; k++) {
    const cx = rand() * N;
    const cy = rand() * N;
    const m = cluster[Math.floor(cy) * N + Math.floor(cx)];
    if (rand() > 0.12 + Math.max(0, m) * 1.4) continue;
    const r = 0.9 + 10 * rand() ** 4.5;
    const shade = (rand() - 0.42) * 0.38 * (0.6 + rand() * 0.8); // unas más oscuras (basalto) y otras más claras
    const sq = 0.7 + rand() * 0.6; // piedras algo alargadas
    const R = Math.ceil(r * 1.6) + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx * sq, dy / sq) / r;
        if (d >= 1.25) continue;
        const x = (Math.floor(cx) + dx + N) % N;
        const y = (Math.floor(cy) + dy + N) % N;
        const i = y * N + x;
        if (d < 1) {
          height[i] += Math.sqrt(1 - d * d) * r * 0.09;
          albedo[i] += shade * (1 - d * 0.25);
        } else {
          albedo[i] -= 0.03 * (1.25 - d) * 4; // leve sombra de contacto alrededor de la piedra
        }
      }
    }
  }
  return { height, albedo, tone };
}

function normalize01(a) {
  let s = 0;
  let s2 = 0;
  for (const v of a) { s += v; s2 += v * v; }
  const mean = s / a.length;
  const sd = Math.sqrt(Math.max(1e-9, s2 / a.length - mean * mean));
  return { mean, sd };
}

let cache = null;
export function groundDetail() {
  if (cache) return cache;
  const { height, albedo, tone } = buildFields();

  // Centrados en 0,5: multiplicar por 2·valor deja la foto igual de brillante de media.
  const st = normalize01(albedo);
  const sm = normalize01(tone);
  const to8 = (v) => Math.max(0, Math.min(255, v * 255));
  const alb = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    alb[i * 4] = to8(0.5 + ((albedo[i] - st.mean) / st.sd) * 0.13);
    alb[i * 4 + 1] = to8(0.5 + ((tone[i] - sm.mean) / sm.sd) * 0.13);
    alb[i * 4 + 2] = 128;
    alb[i * 4 + 3] = 255;
  }
  // Normales (espacio tangente) a partir del gradiente de la altura, cerrado en los bordes.
  const nrm = new Uint8Array(N * N * 4);
  const H = (x, y) => height[((y + N) % N) * N + ((x + N) % N)];
  const k = 2.2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k;
      const dy = (H(x, y + 1) - H(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      nrm[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      nrm[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255; // convención OpenGL (Y+ = v+)
      nrm[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  cache = { albedo: tex(alb), normal: tex(nrm) };
  return cache;
}

/**
 * Añade el detalle a un MeshLambertMaterial con `map`.
 * sizeU/sizeV: metros que cubre el UV 0–1 del material; fine/coarse: metros de cada tesela de detalle;
 * fade: [inicio, fin] en metros de cámara en los que el detalle fino se desvanece (evita el moiré lejano).
 * Devuelve los uniforms para poder ajustar la intensidad (p. ej. 0 en capas de datos).
 */
export function applyGroundDetail(material, { sizeU, sizeV, fine = 4, coarse = 23, fade = [40, 400], fadeCoarse = [1e5, 1e6], strength = 1, normalTile = fine, normalScale = 0.8 }) {
  const d = groundDetail();
  const uniforms = {
    uDetail: { value: d.albedo },
    uRepFine: { value: new THREE.Vector2(sizeU / fine, sizeV / fine) },
    uRepCoarse: { value: new THREE.Vector2(sizeU / coarse, sizeV / coarse) },
    uFade: { value: new THREE.Vector2(fade[0], fade[1]) },
    uFadeCoarse: { value: new THREE.Vector2(fadeCoarse[0], fadeCoarse[1]) },
    uDetStrength: { value: strength },
    // Tinte ocre opcional (vistas a ras de suelo): la imagen de satélite es en escala de grises.
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  };
  if (normalScale > 0) {
    const n = d.normal.clone();
    n.needsUpdate = true;
    n.repeat.set(sizeU / normalTile, sizeV / normalTile);
    material.normalMap = n;
    material.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
uniform vec2 uRepFine;
uniform vec2 uRepCoarse;
uniform vec2 uFade;
uniform vec2 uFadeCoarse;
uniform float uDetStrength;
uniform vec3 uTint;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{
  float camDist = length(vViewPosition);
  float fineK = 1.0 - smoothstep(uFade.x, uFade.y, camDist);
  // Grano fino a dos ángulos y escalas distintas: la repetición de la tesela deja de verse.
  vec2 uvF = vMapUv * uRepFine;
  float a = (texture2D(uDetail, uvF).r - 0.5) * 0.6
          + (texture2D(uDetail, mat2(0.6, -0.8, 0.8, 0.6) * uvF * 0.71 + vec2(0.13, 0.52)).r - 0.5) * 0.5;
  // Moteado grande (canal G), girado y desplazado respecto al fino.
  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * (vMapUv * uRepCoarse) + vec2(0.37, 0.71);
  float b = texture2D(uDetail, uvB).g - 0.5;
  float coarseK = 1.0 - smoothstep(uFadeCoarse.x, uFadeCoarse.y, camDist);
  float det = 1.0 + (a * fineK * 1.3 + b * 0.9 * coarseK) * 2.0 * uDetStrength;
  diffuseColor.rgb *= clamp(det, 0.4, 1.6) * uTint;
}
#endif`);
  };
  material.customProgramCacheKey = () => 'ground-detail';
  material.needsUpdate = true;
  return uniforms;
}
