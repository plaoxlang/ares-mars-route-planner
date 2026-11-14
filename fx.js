// Efectos de las vistas a ras de suelo: microrrelieve bajo las ruedas, polvo y huellas.
// Son solo aspecto. El DTM de 20 m es casi un plano a escala de rover: sin estos detalles el rover
// "flota" sobre una ladera lisa. Con ellos la suspensión trabaja, el cuerpo vibra y el suelo se marca.
import * as THREE from 'three';

// ---------- Microrrelieve ----------
// Ruido de valor (determinista: el mismo punto da siempre la misma altura) en dos escalas:
// ondulaciones de ~1,8 m y piedras de ~0,5 m. Amplitud total ±6 cm.
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}
export function microRelief(x, z) {
  return valueNoise(x / 1.8, z / 1.8) * 0.04 + valueNoise(x / 0.5 + 31.7, z / 0.5 - 12.3) * 0.02;
}

// Vibración del cuerpo y de la cámara: suma de senos de frecuencias no múltiplos (no se repite)
export function shake(t, seed = 0) {
  return Math.sin(t * 57.1 + seed) * 0.5 + Math.sin(t * 83.7 + seed * 2.3) * 0.3 + Math.sin(t * 131.3 + seed * 4.1) * 0.2;
}

// ---------- Polvo ----------
// Partículas que levantan las ruedas: suben un poco, se abren, crecen y se desvanecen.
export function createDust(scene, { max = 600 } = {}) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max); // 0 = libre
  const total = new Float32Array(max);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#e3c39c') }, uScale: { value: 400 } },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      varying float vAlpha;
      uniform float uScale;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(0.1, -mv.z);
        // Pegado a la cámara el polvo sería una mancha enorme: se limita el tamaño y se desvanece de cerca
        gl_PointSize = min(size * uScale / dist, 140.0);
        vAlpha = alpha * smoothstep(2.0, 6.0, dist);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  let next = 0;
  let acc = 0;
  return {
    points,
    /** Emite polvo en cada punto de from (Vector3[]) con un ritmo según la velocidad (m/s) */
    emit(from, speed, dt, back) {
      acc += dt * Math.min(140, speed * 18);
      while (acc >= 1) {
        acc -= 1;
        const p = from[(Math.random() * from.length) | 0];
        const i = next;
        next = (next + 1) % max;
        pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
        pos[i * 3 + 1] = p.y + 0.05;
        pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
        const s = 0.25 + Math.random() * 0.5 + speed * 0.02;
        vel[i * 3] = back.x * s * 0.6 + (Math.random() - 0.5) * 0.5;
        vel[i * 3 + 1] = 0.25 + Math.random() * 0.45;
        vel[i * 3 + 2] = back.z * s * 0.6 + (Math.random() - 0.5) * 0.5;
        total[i] = life[i] = 1.4 + Math.random() * 1.6;
      }
    },
    update(dt, viewportH, fov) {
      mat.uniforms.uScale.value = viewportH / (2 * Math.tan((fov * Math.PI) / 360));
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) { alpha[i] = 0; continue; }
        life[i] -= dt;
        const k = 1 - Math.max(0, life[i]) / total[i]; // 0 → 1 a lo largo de su vida
        vel[i * 3 + 1] -= 0.12 * dt; // la gravedad de Marte apenas lo baja; el aire fino lo frena
        const drag = Math.exp(-dt * 1.2);
        vel[i * 3] *= drag;
        vel[i * 3 + 2] *= drag;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        size[i] = 0.35 + k * 2.2;
        alpha[i] = Math.sin(Math.min(1, k * 4) * Math.PI / 2) * (1 - k) * 0.6;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
      geo.attributes.alpha.needsUpdate = true;
    },
    reset() { life.fill(0); alpha.fill(0); geo.attributes.alpha.needsUpdate = true; },
    set visible(v) { points.visible = v; },
  };
}

// ---------- Huellas ----------
// Dos cintas (una por lado) con el dibujo de las ruedas, pegadas al suelo y que se desvanecen detrás.
function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(6, 0, 52, 128);
  // Garras en chevrón, como las ruedas de aluminio de Perseverance
  g.fillStyle = 'rgba(255,255,255,1)';
  for (let y = -16; y < 128; y += 16) {
    g.beginPath();
    g.moveTo(6, y + 10);
    g.lineTo(32, y);
    g.lineTo(58, y + 10);
    g.lineTo(58, y + 15);
    g.lineTo(32, y + 5);
    g.lineTo(6, y + 15);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function createTracks(scene, { maxPoints = 600, width = 0.42, fadeM = 260 } = {}) {
  const map = treadTexture();
  const mat = new THREE.MeshBasicMaterial({
    color: '#2a1a10', alphaMap: map, transparent: true, depthWrite: false, vertexColors: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  });
  const make = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(maxPoints * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPoints * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, geo, pts: [] };
  };
  const sides = [make(), make()];
  let gap = false;
  const tmp = new THREE.Vector3();
  function rebuild(s) {
    const { geo, pts } = s;
    const P = geo.attributes.position.array;
    const U = geo.attributes.uv.array;
    const C = geo.attributes.color.array;
    const n = pts.length;
    const head = n ? pts[n - 1].d : 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[Math.min(n - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      tmp.set(q.x - o.x, 0, q.z - o.z);
      if (tmp.lengthSq() < 1e-6) tmp.set(0, 0, 1);
      tmp.normalize();
      const nx = -tmp.z * width * 0.5;
      const nz = tmp.x * width * 0.5;
      P.set([p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz], i * 6);
      const v = p.d / 1.2; // una repetición del dibujo cada 1,2 m
      U.set([0, v, 1, v], i * 4);
      const a = p.hide ? 0 : Math.max(0, 1 - (head - p.d) / fadeM) * Math.min(1, (head - p.d) / 1.5 + 0.35) * 0.9;
      C.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
    }
    geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return {
    /** Añade el punto de contacto de cada lado (Vector3) si la rueda ha avanzado lo suficiente */
    add(left, right, dist) {
      const jump = gap;
      gap = false;
      [left, right].forEach((p, k) => {
        const s = sides[k];
        const last = s.pts.at(-1);
        if (!jump && last && Math.hypot(p.x - last.x, p.z - last.z) < 0.35) return;
        if (jump && last) {
          // Tras un salto: dos puntos invisibles para no unir las huellas viejas con las nuevas
          s.pts.push({ ...last, hide: true }, { x: p.x, y: p.y, z: p.z, d: last.d + 0.01, hide: true });
          if (s.pts.length > maxPoints) s.pts.splice(0, s.pts.length - maxPoints);
          rebuild(s);
          return;
        }
        const d = last ? last.d + Math.hypot(p.x - last.x, p.z - last.z) : dist;
        s.pts.push({ x: p.x, y: p.y, z: p.z, d });
        if (s.pts.length > maxPoints) s.pts.shift();
        rebuild(s);
      });
    },
    reset() { gap = false; sides.forEach((s) => { s.pts.length = 0; s.geo.setDrawRange(0, 0); }); },
    /** El vehículo ha saltado (barra de tiempo, minimapa): las huellas de antes se quedan donde estaban */
    jump() { gap = true; },
    set visible(v) { sides.forEach((s) => { s.mesh.visible = v; }); },
  };
}

// ---------- Rocas ----------
// Rocas 3D alrededor del vehículo: guijarros, piedras y algún bloque, con facetas, varios tonos de basalto
// y óxido, medio enterradas y con su sombra de contacto. Se colocan por celdas de 8 m con una semilla fija
// por celda: al avanzar no cambian de sitio. Dejan libre la ruta (el rover pasa entre ellas).
function rockGeometry(seed) {
  const r = (() => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const g = new THREE.IcosahedronGeometry(1, 1); // pocas caras: aristas marcadas, como roca partida
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  // Bultos: unas cuantas direcciones que empujan hacia fuera o hacia dentro
  const bumps = Array.from({ length: 6 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), (r() - 0.4) * 0.9]);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const [d, a] of bumps) k += a * Math.max(0, v.dot(d)) ** 2;
    v.multiplyScalar(k * (0.88 + r() * 0.24)); // irregular: ningún vértice a la misma distancia
    v.y = v.y > 0 ? v.y * 0.8 : v.y * 0.35; // base plana, como apoyada
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createRocks(scene, { heightAt, clearance, cell = 8, radius = 64 } = {}) {
  const VARIANTS = 4;
  const CAP = 1600;
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0, flatShading: true });
  const meshes = Array.from({ length: VARIANTS }, (_, k) => {
    const m = new THREE.InstancedMesh(rockGeometry(1234 + k * 977), mat, CAP);
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  });
  // Sombra de contacto (mancha oscura difusa bajo cada roca): ancla las rocas al suelo a cualquier distancia
  const sc = document.createElement('canvas');
  sc.width = 64;
  sc.height = 64;
  const sg = sc.getContext('2d');
  const grad = sg.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 64, 64);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: '#1a0f08', alphaMap: new THREE.CanvasTexture(sc), transparent: true, opacity: 0.55, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
  });
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, CAP * VARIANTS);
  shadows.count = 0;
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  scene.add(shadows);

  // Basalto oscuro, roca oxidada y alguna más clara cubierta de polvo
  const TONES = ['#3d302a', '#4a3a31', '#5b4335', '#6e4c39', '#7d5a43', '#352c28', '#8b6a52', '#a07d60'].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const col = new THREE.Color();
  let center = null;
  let visible = false;

  function rebuild(cx, cz) {
    const counts = new Array(VARIANTS).fill(0);
    let ns = 0;
    const c0x = Math.floor((cx - radius) / cell);
    const c1x = Math.floor((cx + radius) / cell);
    const c0z = Math.floor((cz - radius) / cell);
    const c1z = Math.floor((cz + radius) / cell);
    for (let i = c0x; i <= c1x; i++) {
      for (let j = c0z; j <= c1z; j++) {
        const mx = (i + 0.5) * cell - cx;
        const mz = (j + 0.5) * cell - cz;
        if (mx * mx + mz * mz > radius * radius) continue;
        let seed = (hash(i, j) * 2147483646 + 1) | 0;
        const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const n = 12 + Math.floor(r() * 16);
        for (let k = 0; k < n; k++) {
          // Tamaño: muchos guijarros, algunas piedras y pocos bloques
          const u = r();
          const s = u < 0.74 ? 0.04 + r() * 0.11 : u < 0.95 ? 0.16 + r() * 0.26 : 0.5 + r() * 0.75;
          const x = (i + r()) * cell;
          const z = (j + r()) * cell;
          if (clearance && clearance(x, z) < 1.9 + s) continue; // la ruta queda despejada
          const v = Math.floor(r() * VARIANTS);
          if (counts[v] >= CAP) continue;
          const sx = s * (0.8 + r() * 0.5);
          const sy = s * (0.75 + r() * 0.45);
          const sz = s * (0.8 + r() * 0.5);
          p.set(x, heightAt(x, z) - sy * 0.18, z); // algo enterradas
          e.set((r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.35);
          q.setFromEuler(e);
          sv.set(sx, sy, sz);
          m4.compose(p, q, sv);
          meshes[v].setMatrixAt(counts[v], m4);
          col.copy(TONES[Math.floor(r() * TONES.length)]).multiplyScalar(0.85 + r() * 0.3);
          meshes[v].setColorAt(counts[v], col);
          counts[v]++;
          // Sombra de contacto, algo mayor que la roca
          p.y = heightAt(x, z) + 0.01;
          q.identity();
          sv.set(sx * 2.6, 1, sz * 2.6);
          m4.compose(p, q, sv);
          shadows.setMatrixAt(ns++, m4);
        }
      }
    }
    meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    shadows.count = ns;
    shadows.instanceMatrix.needsUpdate = true;
  }

  return {
    meshes,
    /** Recoloca las rocas si el vehículo se ha alejado del último centro */
    update(x, z, force = false) {
      if (!visible) return;
      if (!force && center && Math.hypot(x - center[0], z - center[1]) < 6) return;
      center = [x, z];
      rebuild(x, z);
    },
    reset() { center = null; },
    set visible(v) {
      visible = v;
      meshes.forEach((m) => { m.visible = v; });
      shadows.visible = v;
      if (!v) center = null;
    },
    get visible() { return visible; },
  };
}
