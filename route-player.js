// Ruta planificada compartida entre vistas (2D ↔ 3D) y su reproducción en la barra de tiempo.
import { num, fmt, buildProfile, setPlayButton } from './shared.js';

export const PLAN_COLOR = '#4ea1ff';
const KEY = 'ares:plan';

// La ruta elegida se guarda en el navegador para que la otra vista la pueda mostrar.
export function savePlan(plan) {
  try {
    if (plan) localStorage.setItem(KEY, JSON.stringify(plan));
    else localStorage.removeItem(KEY);
  } catch { /* sin almacenamiento: la ruta solo vive en esta vista */ }
}
export function loadPlan() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function formatHours(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;
  return `${num(h)} h`;
}
// Reloj de misión: T+ h:mm (o d h si pasa de 48 h)
export function clock(h) {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = String(totalMin % 60).padStart(2, '0');
  return `T+${hh}:${mm}`;
}

export function routePoints(route) {
  return route.latlngs.map(([lat, lon], k) => ({
    lat, lon, dist_total_m: route.dist[k], elev_m: route.elev[k], hours: route.hours[k], slope: route.slope[k],
  }));
}

// Avanza por la ruta según el tiempo estimado del vehículo, comprimido en unos segundos de animación.
export class RoutePlayer {
  constructor(route, { onUpdate, onState }) {
    this.route = route;
    this.total = route.hours.at(-1) || 1e-6;
    // 12–40 s de animación según la longitud (≈ 2 ms por metro)
    this.duration = Math.min(40000, Math.max(12000, route.dist.at(-1) * 2));
    this.t = 0;
    this.playing = false;
    this.onUpdate = onUpdate;
    this.onState = onState;
  }

  get speedup() { return (this.total * 3600 * 1000) / this.duration; }

  sample(t) {
    const { hours, dist, elev, latlngs } = this.route;
    let lo = 0;
    let hi = hours.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (hours[mid] <= t) lo = mid; else hi = mid - 1;
    }
    const i = lo;
    const j = Math.min(i + 1, hours.length - 1);
    const span = hours[j] - hours[i];
    const f = span > 0 ? Math.min(1, (t - hours[i]) / span) : 0;
    const mix = (a, b) => a + (b - a) * f;
    return {
      t,
      k: t / this.total,
      idx: f < 0.5 ? i : j,
      lat: mix(latlngs[i][0], latlngs[j][0]),
      lon: mix(latlngs[i][1], latlngs[j][1]),
      elev: mix(elev[i], elev[j]),
      dist: mix(dist[i], dist[j]),
      seg: i,
    };
  }

  seek(t) {
    this.t = Math.min(this.total, Math.max(0, t));
    this.onUpdate(this.sample(this.t));
  }
  seekIndex(i) { this.seek(this.route.hours[i]); }

  play() {
    if (this.t >= this.total) this.t = 0;
    this.playing = true;
    this.onState?.(true);
    let last = null;
    const loop = (now) => {
      if (!this.playing) return;
      if (last !== null) this.t += (Math.min(250, now - last) / this.duration) * this.total;
      last = now;
      if (this.t >= this.total) {
        this.t = this.total;
        this.onUpdate(this.sample(this.t));
        this.pause();
        return;
      }
      this.onUpdate(this.sample(this.t));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onState?.(false);
  }
  toggle() { if (this.playing) this.pause(); else this.play(); }
}

// Monta la ruta en la barra de tiempo inferior: perfil propio, play y lectura T+.
export function mountPlanDock({ wrap, route, colorAt, playBtn, labelEl, subEl, onSample, onState }) {
  wrap.innerHTML = '';
  const pts = routePoints(route);
  const total = route.dist.at(-1);
  let player = null;
  const profile = buildProfile(wrap, pts, {
    onPick: (i) => player.seekIndex(i),
    colorAt: (i) => colorAt(pts[i]),
    color: PLAN_COLOR,
    tip: (p) => `${clock(p.hours)} · ${fmt.m(p.elev_m)} · ${fmt.km(p.dist_total_m)}`,
  });
  player = new RoutePlayer(route, {
    onUpdate: (s) => {
      profile.mark(s.idx);
      labelEl.textContent = clock(s.t);
      subEl.textContent = `${fmt.km(s.dist)} de ${fmt.km(total)} · ${fmt.m(s.elev)} · ×${num(player.speedup)}`;
      onSample(s);
    },
    onState: (p) => {
      setPlayButton(playBtn, p);
      // Botones "Reproducir" de los paneles: mismo estado que el play de la barra
      document.querySelectorAll('[data-act="play"], [data-plan="play"]').forEach((b) => {
        const label = b.lastChild;
        if (label?.nodeType === Node.TEXT_NODE) label.textContent = p ? 'Pausar' : 'Reproducir';
        else b.textContent = p ? 'Pausar' : 'Reproducir';
      });
      onState?.(p);
    },
  });
  setPlayButton(playBtn, false);
  player.seek(0);
  return {
    player,
    destroy() {
      player.pause();
      wrap.innerHTML = '';
    },
  };
}
