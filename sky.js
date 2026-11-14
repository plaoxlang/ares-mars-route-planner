// Cielo de Marte según la hora: de día color caramelo (polvo en suspensión), al atardecer un halo
// azul alrededor del Sol (el polvo dispersa el azul hacia delante, como fotografió Curiosity) y de noche
// estrellas. Es una aproximación visual, no un modelo de transferencia radiativa.
import * as THREE from 'three';

// Dirección del Sol (ejes de la escena: +X este, +Y arriba, −Z norte) a la hora solar local `hour`
// en la latitud `latDeg`. Declinación fija de +25° (verano del hemisferio norte, Ls ≈ 90°):
// el Sol sale por el noreste y se pone por el noroeste, como en las tardes de Jezero en esa estación.
export const SUN_DECLINATION_DEG = 25;
export function sunDirection(hour, latDeg, out = new THREE.Vector3()) {
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const d = (SUN_DECLINATION_DEG * Math.PI) / 180;
  const l = (latDeg * Math.PI) / 180;
  const east = -Math.cos(d) * Math.sin(H);
  const north = Math.sin(d) * Math.cos(l) - Math.cos(d) * Math.sin(l) * Math.cos(H);
  const up = Math.sin(d) * Math.sin(l) + Math.cos(d) * Math.cos(l) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

const C = (hex) => new THREE.Color(hex);
const DAY_HORIZON = C('#d9b28c');
const DAY_ZENITH = C('#a77d5e');
const DUSK = C('#3a2f2b');
const NIGHT = C('#07080b');
const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

// Luz y color de niebla para una altura del Sol (y = seno de la elevación)
export function skyState(sunY) {
  const day = smooth(sunY, -0.02, 0.3);
  const lit = smooth(sunY, -0.12, 0.04);
  const fog = DUSK.clone().lerp(DAY_HORIZON, day).lerp(NIGHT, 1 - lit);
  return {
    fog,
    sunIntensity: 2.0 * smooth(sunY, -0.01, 0.12),
    sunColor: C('#ffb98a').lerp(C('#fff1e0'), smooth(sunY, 0.02, 0.3)),
    hemiIntensity: 0.12 + 1.18 * lit * (0.45 + 0.55 * day),
  };
}

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uDayH: { value: DAY_HORIZON }, uDayZ: { value: DAY_ZENITH }, uDusk: { value: DUSK }, uNight: { value: NIGHT },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // siempre en el fondo
      }`,
    fragmentShader: `
      uniform vec3 uSun;
      uniform vec3 uDayH;
      uniform vec3 uDayZ;
      uniform vec3 uDusk;
      uniform vec3 uNight;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vDir);
        float h = max(dir.y, 0.0);
        float sy = uSun.y;
        float day = smoothstep(-0.02, 0.3, sy);
        float lit = smoothstep(-0.12, 0.04, sy);
        float c = max(dot(dir, uSun), 0.0);
        vec3 dayCol = mix(uDayH, uDayZ, pow(h, 0.6));
        vec3 duskCol = mix(uDusk, uNight, pow(h, 0.5) * 0.8);
        vec3 col = mix(duskCol, dayCol, day);
        col = mix(uNight, col, lit);
        // Halo del Sol: cálido de día, azul al atardecer
        float near = pow(c, 10.0);
        float wide = pow(c, 3.0);
        col += vec3(1.0, 0.86, 0.7) * near * 0.35 * day;
        float dusk = (1.0 - day) * smoothstep(-0.14, -0.01, sy);
        col += vec3(0.32, 0.52, 0.86) * (near * 1.1 + wide * 0.25) * dusk;
        // Disco solar (más pequeño que desde la Tierra: Marte está 1,5 veces más lejos)
        col += vec3(1.0, 0.97, 0.92) * smoothstep(0.99996, 0.99999, c) * smoothstep(-0.03, 0.02, sy) * 2.0;
        // Estrellas de noche
        vec3 g = floor(dir * 420.0);
        float st = step(0.9975, hash(g)) * (0.5 + 0.5 * hash(g + 1.7));
        col += vec3(st) * (1.0 - smoothstep(-0.16, -0.04, sy)) * smoothstep(0.0, 0.08, dir.y);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(1000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = false;
  return {
    mesh,
    setSun(dir) { mat.uniforms.uSun.value.copy(dir); },
  };
}
