// Rover Perseverance articulado a partir del modelo 3D oficial de NASA (assets/rover/perseverance.glb).
// El modelo trae las 6 ruedas en una sola malla y la suspensión en otra: aquí se separan por triángulos
// y se montan como un mecanismo rocker-bogie (balancín + bogie a cada lado, con diferencial en el cuerpo),
// ruedas que giran y patas de dirección delanteras y traseras.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Geometría del modelo (metros, eje +Z hacia delante, +X a la izquierda del rover, Y arriba).
// Medida a partir de las propias mallas del GLB.
export const WHEEL_R = 0.262;
export const WHEELS = { front: { x: 1.062, z: 1.095 }, mid: { x: 1.184, z: -0.09 }, rear: { x: 1.062, z: -1.165 } };
const WHEEL_Y = 0.263;
const ROCKER_PIVOT = { x: 0.85, y: 0.93, z: 0.175 }; // unión balancín–cuerpo (diferencial)
const BOGIE_PIVOT = { x: 1.0, y: 0.70, z: -0.55 }; // unión bogie–balancín
const DIFF_HALF = ROCKER_PIVOT.x;
const CORNER_R = 0.22; // radio horizontal de la pata de dirección alrededor del eje de la rueda
const MAX_ANGLE = 0.6; // rad, tope de articulación
// Navcam en el mástil (nodo "head" + "NavCams" del modelo)
export const MAST_CAMERA = new THREE.Vector3(-0.555, 1.99, 0.92); // un poco por delante de la carcasa

const clamp = (v, a) => Math.max(-a, Math.min(a, v));

export async function loadRover(url, onProgress) {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => onProgress?.(e.total ? e.loaded / e.total : 0));
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const wheelsNode = model.getObjectByName('Wheels_objs');
  const suspNode = model.getObjectByName('suspension');
  if (!wheelsNode || !suspNode) throw new Error('The model is missing the expected Wheels_objs/suspension meshes');

  // --- Reparto de triángulos ---
  const sideOf = (x) => (x >= 0 ? 'p' : 'n');
  const sign = { p: 1, n: -1 };
  const wheelCenter = (side, slot) => new THREE.Vector3(sign[side] * WHEELS[slot].x, WHEEL_Y, WHEELS[slot].z);
  const zs = [WHEELS.front.z, WHEELS.mid.z, WHEELS.rear.z];
  const wheelSlot = (z) => (z > (zs[0] + zs[1]) / 2 ? 'front' : z < (zs[1] + zs[2]) / 2 ? 'rear' : 'mid');

  const classifyWheel = (x, y, z) => `wheel-${sideOf(x)}-${wheelSlot(z)}`;
  const classifySusp = (x, y, z) => {
    const side = sideOf(x);
    if (Math.abs(x) < 0.6) return 'body'; // barra del diferencial: va con el cuerpo
    for (const slot of ['front', 'rear']) {
      const w = wheelCenter(side, slot);
      if (Math.hypot(x - w.x, z - w.z) < CORNER_R && y > 0.15) return `corner-${side}-${slot}`;
    }
    if (z < -0.3 || (z < 0.15 && y < 0.6)) return `bogie-${side}`; // brazo trasero + horquilla de la rueda central
    return `rocker-${side}`;
  };

  const parts = new Map(); // clave → [{ geometry, material }]
  const split = (node, classify) => {
    node.traverse((m) => {
      if (!m.isMesh) return;
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      const pos = g.attributes.position;
      const buckets = new Map();
      for (let t = 0; t < pos.count; t += 3) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        const key = classify(cx, cy, cz);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
      }
      for (const [key, tris] of buckets) {
        const out = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) {
          const n = attr.itemSize;
          const arr = new Float32Array(tris.length * 3 * n);
          tris.forEach((t, k) => {
            for (let v = 0; v < 3; v++) for (let c = 0; c < n; c++) arr[(k * 3 + v) * n + c] = attr.getComponent(t + v, c);
          });
          out.setAttribute(name, new THREE.BufferAttribute(arr, n));
        }
        if (!parts.has(key)) parts.set(key, []);
        parts.get(key).push({ geometry: out, material: m.material });
      }
      g.dispose();
    });
    node.removeFromParent();
  };
  split(wheelsNode, classifyWheel);
  split(suspNode, classifySusp);

  // --- Jerarquía articulada ---
  const root = new THREE.Group();
  root.name = 'rover';
  const body = new THREE.Group();
  root.add(body);
  body.add(model); // el resto del modelo (cuerpo, mástil, brazo…) va fijo al cuerpo

  // Crea un pivote en `pt` (coordenadas del modelo) dentro de `parent` (cuyo pivote está en parentPt)
  // y le cuelga las piezas `keys`, desplazadas para que giren alrededor del pivote.
  const pivot = (parent, pt, parentPt, keys) => {
    const o = new THREE.Group();
    o.position.copy(pt).sub(parentPt);
    parent.add(o);
    for (const key of keys) {
      for (const { geometry, material } of parts.get(key) ?? []) {
        geometry.translate(-pt.x, -pt.y, -pt.z);
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        o.add(mesh);
      }
    }
    return o;
  };
  const ORIGIN = new THREE.Vector3();
  for (const { geometry, material } of parts.get('body') ?? []) body.add(new THREE.Mesh(geometry, material));

  const rig = {};
  for (const side of ['p', 'n']) {
    const s = sign[side];
    const rp = new THREE.Vector3(s * ROCKER_PIVOT.x, ROCKER_PIVOT.y, ROCKER_PIVOT.z);
    const bp = new THREE.Vector3(s * BOGIE_PIVOT.x, BOGIE_PIVOT.y, BOGIE_PIVOT.z);
    const wf = wheelCenter(side, 'front');
    const wm = wheelCenter(side, 'mid');
    const wr = wheelCenter(side, 'rear');
    const rocker = pivot(body, rp, ORIGIN, [`rocker-${side}`]);
    const cornerF = pivot(rocker, wf, rp, [`corner-${side}-front`]);
    const wheelF = pivot(cornerF, wf, wf, [`wheel-${side}-front`]);
    const bogie = pivot(rocker, bp, rp, [`bogie-${side}`]);
    const wheelM = pivot(bogie, wm, bp, [`wheel-${side}-mid`]);
    const cornerR = pivot(bogie, wr, bp, [`corner-${side}-rear`]);
    const wheelR = pivot(cornerR, wr, wr, [`wheel-${side}-rear`]);
    rig[side] = { rocker, bogie, cornerF, cornerR, wheels: [wheelF, wheelM, wheelR] };
  }
  model.traverse((m) => { if (m.isMesh) m.castShadow = true; });

  let spin = 0;
  const pose = { pitch: 0, roll: 0, rocker: { p: 0, n: 0 }, bogie: { p: 0, n: 0 } };

  return {
    root,
    body,
    pose,
    // Se oculta en la vista POV: la cabeza del mástil es la propia cámara.
    povHidden: ['head'].map((n) => model.getObjectByName(n)).filter(Boolean),
    /**
     * Coloca el rover. heightAt(x, z) → altura del suelo (coordenadas de la escena).
     * x, z: centro del rover; yaw: giro alrededor de Y (el frente del modelo es +Z);
     * ds: metros recorridos desde el fotograma anterior; steer: giro de las ruedas de esquina (rad).
     */
    update({ heightAt, x, z, yaw, ds = 0, steer = 0 }) {
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const H = (mx, mz) => heightAt(x + mx * c + mz * sn, z - mx * sn + mz * c);
      const sideState = {};
      for (const side of ['p', 'n']) {
        const s = sign[side];
        const hf = H(s * WHEELS.front.x, WHEELS.front.z);
        const hm = H(s * WHEELS.mid.x, WHEELS.mid.z);
        const hr = H(s * WHEELS.rear.x, WHEELS.rear.z);
        // Bogie: apoya en la rueda central y la trasera
        const phi = Math.atan2(hm - hr, WHEELS.mid.z - WHEELS.rear.z);
        const hb = hr + ((hm - hr) * (BOGIE_PIVOT.z - WHEELS.rear.z)) / (WHEELS.mid.z - WHEELS.rear.z);
        // Balancín: une el pivote del bogie con la rueda delantera
        const theta = Math.atan2(hf - hb, WHEELS.front.z - BOGIE_PIVOT.z);
        const hp = hb + ((hf - hb) * (ROCKER_PIVOT.z - BOGIE_PIVOT.z)) / (WHEELS.front.z - BOGIE_PIVOT.z);
        sideState[side] = { phi, theta, hp };
      }
      // Diferencial: el cuerpo toma la media de los dos balancines; el alabeo sale de la diferencia de alturas.
      const pitch = (sideState.p.theta + sideState.n.theta) / 2;
      const roll = Math.atan2(sideState.p.hp - sideState.n.hp, 2 * DIFF_HALF);
      root.position.set(x, (sideState.p.hp + sideState.n.hp) / 2, z);
      root.rotation.set(0, yaw, 0);
      body.rotation.set(-pitch, 0, roll, 'YXZ');
      spin += ds / WHEEL_R;
      for (const side of ['p', 'n']) {
        const st = sideState[side];
        const r = rig[side];
        r.rocker.rotation.x = -clamp(st.theta - pitch, MAX_ANGLE);
        r.bogie.rotation.x = -clamp(st.phi - st.theta, MAX_ANGLE);
        r.cornerF.rotation.y = clamp(steer, 0.55);
        r.cornerR.rotation.y = -clamp(steer, 0.55);
        r.wheels.forEach((w) => { w.rotation.x = spin; });
        pose.rocker[side] = st.theta - pitch;
        pose.bogie[side] = st.phi - st.theta;
      }
      pose.pitch = pitch;
      pose.roll = roll;
    },
  };
}
