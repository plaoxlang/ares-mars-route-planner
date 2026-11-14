// Minimapa de las vistas a ras de suelo: la ruta entera sobre la imagen de satélite, el tramo ya
// recorrido, el vehículo con su rumbo y el cono de lo que ve la cámara. Un clic salta a ese punto.
// Trabaja en píxeles de la textura del terreno (texCanvas): toTex(x, z) convierte desde la escena.

const W = 240;
const H = 190;
const PAD = 18; // px de margen alrededor de la ruta

export function createMinimap({ host, texCanvas, toTex, fromTex, onPick }) {
  const el = document.createElement('div');
  el.className = 'minimap';
  el.innerHTML = `
    <canvas width="${W}" height="${H}" aria-label="Minimapa de la ruta. Haz clic para ir a ese punto."></canvas>
    <div class="minimap-foot"><span class="minimap-title">Mapa de la ruta</span><span class="minimap-scale mono"></span></div>`;
  host.appendChild(el);
  const canvas = el.querySelector('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const bg = document.createElement('canvas');
  bg.width = W * dpr;
  bg.height = H * dpr;
  const bgg = bg.getContext('2d');
  bgg.scale(dpr, dpr);

  let route = null; // { pts: [[u,v]...], cum, color, flags, view: {x0,y0,s} }
  let lastBg = 0;
  let refreshing = true;
  // Clic: píxel del minimapa → píxel de textura → punto de la escena
  canvas.addEventListener('click', (e) => {
    if (!route) return;
    const r = canvas.getBoundingClientRect();
    const u = route.view.x0 + (e.clientX - r.left) / route.view.s;
    const v = route.view.y0 + (e.clientY - r.top) / route.view.s;
    onPick?.(...fromTex(u, v));
  });

  // Encaje de la ruta en el minimapa (píxeles de textura → píxeles del minimapa)
  const toMap = (u, v) => [(u - route.view.x0) * route.view.s, (v - route.view.y0) * route.view.s];

  function drawBackground() {
    const { x0, y0, s } = route.view;
    bgg.fillStyle = '#1a1512';
    bgg.fillRect(0, 0, W, H);
    bgg.save();
    bgg.filter = 'sepia(0.35) brightness(0.8) contrast(1.1)';
    bgg.drawImage(texCanvas, x0, y0, W / s, H / s, 0, 0, W, H);
    bgg.restore();
    // Ruta completa
    bgg.lineJoin = 'round';
    bgg.lineCap = 'round';
    bgg.strokeStyle = 'rgba(0,0,0,0.55)';
    bgg.lineWidth = 4.5;
    tracePath(bgg, route.pts.length);
    bgg.stroke();
    bgg.strokeStyle = route.color;
    bgg.lineWidth = 2.2;
    tracePath(bgg, route.pts.length);
    bgg.stroke();
    for (const f of route.flags) {
      const [x, y] = toMap(...f.uv);
      bgg.fillStyle = f.color;
      bgg.strokeStyle = '#0a0c0f';
      bgg.lineWidth = 1.5;
      bgg.beginPath();
      bgg.arc(x, y, 4.5, 0, Math.PI * 2);
      bgg.fill();
      bgg.stroke();
    }
    lastBg = performance.now();
  }
  function tracePath(ctx, n) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [x, y] = toMap(...route.pts[i]);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
  }

  return {
    el,
    /** points: [[x, z]...] en la escena; cum: distancia acumulada; flags: [{ x, z, color }] */
    setRoute({ points, cum, color, flags, metersPerTexPx }) {
      const pts = points.map(([x, z]) => toTex(x, z));
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (const [u, v] of pts) {
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }
      const s = Math.min((W - 2 * PAD) / Math.max(1, maxU - minU), (H - 2 * PAD) / Math.max(1, maxV - minV));
      const x0 = (minU + maxU) / 2 - W / 2 / s;
      const y0 = (minV + maxV) / 2 - H / 2 / s;
      route = {
        pts, cum, color, flags: flags.map((f) => ({ uv: toTex(f.x, f.z), color: f.color })), view: { x0, y0, s },
      };
      // Escala: una barra "redonda" de ~60 px
      const mPerPx = metersPerTexPx / s;
      const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000].find((m) => m / mPerPx >= 45) ?? 10000;
      el.querySelector('.minimap-scale').textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
      el.style.setProperty('--scale-w', `${nice / mPerPx}px`);
      drawBackground();
    },
    /** x, z: posición; s: distancia recorrida sobre la ruta; yaw: rumbo; camDir: [dx, dz]; fov en grados */
    update({ x, z, s, yaw, camDir, fov }) {
      if (!route) return;
      // Mientras la imagen del terreno sigue cargando, se repinta el fondo de vez en cuando (no al terminar)
      if (refreshing && performance.now() - lastBg > 4000) drawBackground();
      g.drawImage(bg, 0, 0, W, H);
      // Tramo recorrido en blanco
      let n = 0;
      while (n < route.cum.length - 1 && route.cum[n + 1] <= s) n++;
      const [px, py] = toMap(...toTex(x, z));
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2.2;
      g.lineJoin = 'round';
      tracePath(g, n + 1);
      g.lineTo(px, py);
      g.stroke();
      // Cono de visión de la cámara
      if (camDir) {
        const a = Math.atan2(camDir[1], camDir[0]);
        const half = ((fov ?? 60) * Math.PI) / 360;
        const grad = g.createRadialGradient(px, py, 0, px, py, 34);
        grad.addColorStop(0, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(px, py);
        g.arc(px, py, 34, a - half, a + half);
        g.closePath();
        g.fill();
      }
      // Vehículo: flecha según el rumbo (+x este → derecha, +z sur → abajo)
      g.save();
      g.translate(px, py);
      g.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)));
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#0a0c0f';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-5, 4.5);
      g.lineTo(-2.5, 0);
      g.lineTo(-5, -4.5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    },
    setVisible(on) { el.hidden = !on; },
    // La imagen del terreno ya está completa: último repintado y se deja de repintar periódicamente
    refresh() { refreshing = false; if (route) drawBackground(); },
  };
}
