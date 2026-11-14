// Presentación de ARES (~4 min) para exponer el proyecto en directo: recorre el mapa 2D y la vista 3D
// enseñando las capas, la creación de una ruta punto a punto, las alternativas, el modelo 3D del rover,
// cómo se calculan pendiente, frío, radiación y el informe de misión.
//  · Modo automático: cada escena dura lo indicado y pasa sola (se puede pausar).
//  · Modo paso a paso: la escena hace su animación y espera a que el presentador avance.
//  · Teclas: → / Av Pág / Intro siguiente · ← / Re Pág anterior · Espacio pausa (auto) o avanza (paso a paso)
//    · A cambia de modo · N notas del presentador · Esc salir. Funcionan con un mando de presentaciones.
// Las escenas del mapa y las del 3D están en páginas distintas: al cambiar de página se guarda el punto
// en sessionStorage y la otra página continúa la presentación al cargar.
import { num, fmt } from './shared.js';
import { formatHours } from './route-player.js';

const KEY = 'ares:present';
const ABORT = Symbol('abort');
const TOTAL_MS = 240000;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const rad = (d) => (d * Math.PI) / 180;
const wait0 = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---------------------------------------------------------------- Guion
// page: dónde ocurre · dur: duración en modo automático (ms) · kicker: rótulo corto
// points: lo que ve el público · notes: lo que puede decir el presentador · run: la acción en pantalla
const SCENES = [
  {
    page: '2d', dur: 13000, kicker: 'ARES', title: 'Planning a drive across Mars',
    points: [
      'A crew on Mars needs to know where to go, how long it will take and what risks they face.',
      'ARES answers that on the real terrain of Jezero Crater, using open NASA and USGS data.',
    ],
    chips: [['Jezero', '18.4° N · 77.4° E'], ['19 × 9 km', 'study area'], ['100%', 'in the browser']],
    notes: 'Set up the problem: planning a safe traverse. Jezero is where Perseverance landed in 2021; it was a lake 3.5 billion years ago.',
    async run(c) {
      const { api } = c;
      api.planner.clear();
      c.layers(true);
      api.setLayer('ctx');
      api.map.setView([18.44, 77.38], 8, { animate: false });
      await c.wait(600);
      api.fit(boundsOf(api.demBounds), 3);
      await c.wait(3200);
    },
  },
  {
    page: '2d', dur: 18000, kicker: 'Layers', title: 'What the orbiters see',
    points: [
      'Always underneath: MOLA, laser altimetry of the whole planet from Mars Global Surveyor (463 m/px).',
      'CTX, from Mars Reconnaissance Orbiter: the whole area at 6 m/px.',
      'HiRISE: the most powerful camera in orbit, 25 cm/px. You can make out one-meter boulders.',
    ],
    chips: [['463 m/px', 'MOLA'], ['6 m/px', 'CTX'], ['25 cm/px', 'HiRISE']],
    notes: 'The layers are always in view at the top left, one at a time over the MOLA terrain. We zoom in and switch orbiters: each one sees finer detail.',
    async run(c) {
      const { api } = c;
      api.planner.clear(); // también descarta un cálculo en curso
      c.layers(true);
      api.setLayer('ctx');
      c.spot('.layerbar', 'Layers');
      api.map.setView([18.44, 77.38], 7, { animate: false });
      await c.wait(3500);
      api.flyTo(18.47, 77.33, 13, 2.5);
      await c.wait(5500);
      api.setLayer('hirise');
      api.flyTo(18.4954, 77.3467, 16.5, 3);
      await c.wait(5000);
    },
  },
  {
    page: '2d', dur: 18000, kicker: 'Terrain', title: 'Elevation and slope, computed right here',
    points: [
      '20 m digital terrain model (USGS), built from CTX stereo pairs to guide the landing.',
      'Slope is the gradient of that model at a ~60 m scale, computed in the browser.',
      'Green < 8° · amber 8–15° · red > 15°: the same thresholds across the whole app.',
    ],
    chips: [['20 m', 'per cell'], ['460,000', 'cells'], ['+600 m', 'floor to rim']],
    notes: 'Everything that follows (routes, risks, 3D) comes from this terrain model. The layers are computed in the browser itself from the raw data.',
    async run(c) {
      const { api } = c;
      api.planner.clear(); // también descarta un cálculo en curso
      c.layers(true);
      api.setLayer('elev');
      c.spot('.layerbar', 'Elevation');
      api.fit(boundsOf(api.demBounds), 2);
      await c.wait(7500);
      api.setLayer('slope');
      c.spot('.layerbar', 'Slope');
      await c.wait(6000);
    },
  },
  {
    page: '2d', dur: 13000, kicker: 'Night cold', title: 'Where the night bites hardest',
    points: [
      'Nighttime infrared from THEMIS (Mars Odyssey): sand and dust lose their heat faster than rock.',
      'We give a relative value, "colder than X% of the area", not degrees: there is no measured temperature at every point.',
    ],
    chips: [['100 m/px', 'THEMIS night'], ['percentile', 'relative']],
    notes: 'We are honest about the data: absolute temperature is only measured by the MEDA weather station, on a handful of sols. What we do know is which areas cool down the most.',
    async run(c) {
      const { api } = c;
      api.planner.clear(); // también descarta un cálculo en curso
      c.layers(true);
      api.setLayer('cold');
      c.spot('.layerbar', 'Night cold');
      await c.wait(9000);
    },
  },
  {
    page: '2d', dur: 24000, kicker: 'Route by points', title: 'Click A, click B',
    points: [
      'Mark the start and the destination on the map: the routes are computed instantly.',
      'A* search over all 460,000 cells of 20 m, in 8 directions.',
      'Three alternatives at once, each on its own thread (Web Workers).',
    ],
    chips: [['A → B', 'delta → crater rim'], ['…', 'compute time']],
    notes: 'We go from the ancient river delta to the western crater rim: almost 6 km and over 600 m of climb. The vehicle is a NASA SEV-type pressurized rover.',
    async run(c) {
      const { api } = c;
      api.setLayer('hirise');
      api.planner.clear();
      c.layers(false);
      const { origin, dest } = api.defaultPlan;
      api.fit([[origin.lat, origin.lon], [dest.lat, dest.lon]], 1.5);
      await c.wait(2200);
      await c.click(api.toScreen(origin.lat, origin.lon), 'A');
      api.planner.setPoint('origin', origin.lat, origin.lon);
      await c.wait(1400);
      const result = api.planner.nextResult();
      await c.click(api.toScreen(dest.lat, dest.lon), 'B');
      api.planner.setPoint('dest', dest.lat, dest.lon);
      await Promise.race([result, c.wait(6000)]);
      const ms = /(\d[\d.,]*) ms/.exec(document.getElementById('plan-status')?.textContent ?? '')?.[1];
      c.setChips([['A → B', 'delta → crater rim'], [ms ? `${ms} ms` : '<1 s', '3 routes computed']]);
      fitRoutes(api);
      c.spot('#plan-routes-sec', 'Alternatives');
      await c.wait(4000);
    },
  },
  {
    page: '2d', dur: 21000, kicker: 'Alternatives', title: 'Fast, safe or efficient',
    points: [
      'Fastest: least time. Speed drops with slope and rough terrain.',
      'Safest: penalizes slopes and roughness, even if it ends up longer.',
      'Least energy: rolling resistance plus hauling 3,000 kg of vehicle uphill. Never above 18°.',
    ],
    chips: [],
    notes: 'Just like Google Maps: the selected route in blue, the others in gray. Each card shows time, distance, elevation gain, max slope and battery.',
    async run(c) {
      const { api } = c;
      c.layers(false);
      await ensureRoute(c);
      fitRoutes(api);
      const cards = () => [...document.querySelectorAll('#plan-results .route-card')];
      const order = ['fast', 'safe', 'energy'];
      for (const key of order) {
        const k = api.planner.routes.findIndex((r) => r.objectives.includes(key));
        if (k < 0) continue;
        api.planner.selectRoute(k);
        const r = api.planner.routes[k];
        c.setChips([[formatHours(r.hours), r.labels.join(' · ')], [fmt.km(r.distance_m), 'distance'], [`${num(r.max_slope_deg, 1)}°`, 'max slope']]);
        await c.wait(80);
        c.spot(cards()[k], r.labels.join(' · '));
        await c.wait(5600);
      }
      const safe = api.planner.routes.findIndex((r) => r.objectives.includes('safe'));
      if (safe >= 0) api.planner.selectRoute(safe);
      c.spot(null);
    },
  },
  {
    page: '2d', dur: 10000, kicker: 'Playback', title: 'The route, minute by minute',
    points: [
      'The profile at the bottom is the timeline: route elevation, colored by slope.',
      'T+ is the mission clock; the panel on the left follows the vehicle.',
    ],
    chips: [],
    notes: 'Now we jump to 3D with this same route.',
    async run(c) {
      const { api } = c;
      c.layers(false);
      await ensureRoute(c);
      const pl = api.planDock?.player;
      c.spot('.dock', 'Timeline');
      if (pl) { pl.seek(0); pl.setRate(pl.total * 3600 / 9); pl.play(); }
      await c.wait(8500);
      pl?.pause();
      pl?.defaultRate();
    },
  },
  {
    page: '3d', dur: 18000, kicker: '3D terrain', title: 'The real terrain, in 3D',
    points: [
      'The mesh is the 20 m terrain model, with elevation exaggerated ×2 so it reads better.',
      'The white rectangle is our study area. Outside it: MOLA terrain and blurred imagery.',
      'It navigates like a map: drag, rotate and zoom.',
    ],
    chips: [['×2', 'exaggeration'], ['19 × 9 km', 'area'], ['MOLA', 'surroundings']],
    notes: 'Everything is rendered in the browser with Three.js. The blue route is the one we just computed.',
    async run(c) {
      const { api } = c;
      api.preloadRover?.();
      setup3d(c, { layer: 'sat', exag: 2, hour: 16 });
      api.homeView();
      await c.wait(1200);
      const cc = api.center();
      const r = Math.max(api.zoneSize.w, api.zoneSize.h) * 0.85;
      await c.orbit(cc, { dist: r, elev: [42, 34], az: [0, 40] }, 15000);
    },
  },
  {
    page: '3d', dur: 18000, kicker: 'Radiation', title: 'The dose that reaches the ground',
    points: [
      'Starting point: 0.64 mSv/day, measured by the RAD detector on Curiosity.',
      'Lower dose where terrain blocks the sky (valleys); higher where there is less atmosphere overhead (high ground).',
      'It is a model, not a measurement. The route adds up its dose segment by segment.',
    ],
    chips: [],
    notes: 'Mars has no global magnetic field and a very thin atmosphere: about 100 times the natural dose on Earth. We compute the visible sky in 16 directions out to 3 km.',
    async run(c) {
      const { api } = c;
      setup3d(c, { layer: 'rad', exag: 2, hour: 16 });
      const r = api.radiation();
      c.setChips([[`${num(r.min, 2)}–${num(r.max, 2)}`, 'mSv/day across the area'], ['≈100×', 'the dose on Earth']]);
      c.spot('.layerbar', 'Radiation');
      const mid = routeMid(api);
      await c.fly(c.around(mid, { dist: 9000, elev: 38, az: 200 }), mid, 3500);
      await c.orbit(mid, { dist: 9000, elev: 38, az: [200, 250] }, 12000);
    },
  },
  {
    page: '3d', dur: 22000, kicker: 'Rover', title: 'Behind the wheel, on the route',
    points: [
      'Official NASA 3D model of Perseverance, at true scale.',
      'Simulated rocker-bogie suspension: every wheel rests on the terrain; live pitch and roll.',
      'The wheels ride over micro-relief: the body shakes, kicks up dust and leaves tracks.',
    ],
    chips: [['1:1', 'true scale'], ['6', 'wheels on the ground'], ['0.2 s', 'to take the wheel']],
    notes: 'The camera swoops down behind the rover. The model is NASA\'s robotic rover; the mission vehicle is pressurized, but it shows how a vehicle moves over this terrain. Everything is preloaded, so taking the wheel is instant.',
    async run(c) {
      const { api } = c;
      setup3d(c, { layer: 'sat', hour: 16, keepDrive: true });
      const pl = api.planDock?.player;
      pl?.pause();
      pl?.seek(pl.total * 0.12);
      await api.enterDrive('chase');
      c.spot('.drive-hud', 'Telemetry');
      pl?.play();
      await c.wait(19000);
    },
  },
  {
    page: '3d', dur: 13000, kicker: 'POV', title: 'Through the rover\'s camera',
    points: [
      'View from the mast Navcam, with the robotic arm in front.',
      'The nearby ground is HiRISE at 25 cm/px plus procedural detail; the minimap shows where you are on the route.',
    ],
    chips: [['25 cm/px', 'HiRISE'], ['360 m', 'detailed ground']],
    notes: 'The detailed ground regenerates around the rover as it drives, with no stutter.',
    async run(c) {
      const { api } = c;
      setup3d(c, { hour: 16, keepDrive: true });
      await api.enterDrive('pov');
      c.spot('.minimap', 'Minimap');
      if (!api.planDock?.player.playing) api.planDock?.player.play();
      await c.wait(11000);
    },
  },
  {
    page: '3d', dur: 14000, kicker: 'Light', title: 'A Martian sunset',
    points: [
      'The Sun is computed for Jezero\'s latitude and the chosen time of day.',
      'At sunset the sky turns blue around the Sun: dust scatters blue light forward.',
    ],
    chips: [['18.4° N', 'latitude'], ['blue', 'sunset']],
    notes: 'It is the opposite of Earth: the daytime sky is butterscotch and the sunset is blue.',
    async run(c) {
      const { api } = c;
      setup3d(c, { keepDrive: true });
      await api.enterDrive('chase'); // la ruta va hacia el oeste: de cara al Sol que se pone
      api.planDock?.player.pause();
      await c.anim(11000, (k) => api.setHour(16 + 2.9 * ease(k)));
    },
  },
  {
    page: '3d', dur: 21000, kicker: 'Mission report', title: 'GO or NO-GO?',
    points: [
      'Brings together time, range, battery, slopes, night cold and dose for the whole route.',
      'Accumulated dose against NASA\'s career limit (600 mSv).',
      'A GO / CAUTION / NO-GO verdict, with the reasons.',
    ],
    chips: [],
    notes: 'This is the bottom line for the crew: can they drive this route with this vehicle and come back to tell the tale.',
    async run(c) {
      const { api } = c;
      setup3d(c, { layer: 'sat', exag: 2, hour: 16 });
      const rep = api.mission();
      c.setChips([[rep.verdict, 'verdict'], [`${num(rep.dose, 2)} mSv`, 'route dose'], [rep.batteryUse !== null ? `${num(rep.batteryUse * 100)}%` : '—', 'battery']]);
      api.frameRoute();
      await c.wait(400);
      const el = document.querySelector('.float-right .mission');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await c.wait(700);
      c.spot(el, 'Report');
      const mid = routeMid(api);
      await c.orbit(mid, { dist: 7000, elev: 40, az: [190, 230] }, 17000);
    },
  },
  {
    page: '3d', dur: 12000, kicker: 'ARES', title: 'Thank you',
    points: [
      'Satellite layers, A → B routes with three alternatives, 3D with the rover and a mission report.',
      'All built on open NASA and USGS data, and all running in the browser.',
    ],
    chips: [['NASA', 'MRO · MGS · Odyssey · Mars 2020'], ['USGS', 'terrain model'], ['0', 'servers of our own']],
    notes: 'Wrap up and take questions. The app stays open for free exploration.',
    final: true,
    async run(c) {
      const { api } = c;
      setup3d(c, { layer: 'sat', exag: 2, hour: 17.2 });
      document.querySelector('.float-right')?.scrollTo({ top: 0, behavior: 'smooth' });
      const cc = api.center();
      const r = Math.max(api.zoneSize.w, api.zoneSize.h);
      await c.fly(c.around(cc, { dist: r, elev: 30, az: 230 }), cc, 4000);
      await c.orbit(cc, { dist: r, elev: 30, az: [230, 260] }, 7000);
    },
  },
];

// Encuadra todas las alternativas calculadas
function fitRoutes(api) {
  const all = api.planner.routes.flatMap((r) => r.latlngs ?? []);
  if (all.length) api.fit(all, 1.2);
}
function boundsOf(b) { return [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]; }

// En 2D: la ruta tiene que existir (si se entra directamente en una escena posterior)
async function ensureRoute(c) {
  const { api } = c;
  if (api.planner.routes.length) return;
  const res = api.planner.nextResult();
  api.planner.restore(api.defaultPlan);
  await Promise.race([res, c.wait(6000)]);
}

// En 3D: estado de partida de la escena (permite saltar a cualquiera)
function setup3d(c, { layer, exag, hour, keepDrive = false } = {}) {
  const { api } = c;
  if (!keepDrive && api.state.drive) api.exitDrive();
  api.controls.enabled = false;
  if (layer && api.state.layer !== layer) api.setLayer(layer);
  if (exag && !api.state.drive && Math.abs(api.state.exag - exag) > 0.01) api.setExaggeration(exag);
  if (hour !== undefined) {
    if (api.timeOfDay.playing) api.toggleDay();
    api.setHour(hour);
  }
}
function routeMid(api) {
  const ll = api.plan.latlngs;
  const lats = ll.map((p) => p[0]);
  const lons = ll.map((p) => p[1]);
  return api.worldPoint((Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2);
}

// ---------------------------------------------------------------- Arranque
export function startPresentation({ page, api, ready }) {
  document.querySelectorAll('[data-present]').forEach((b) => b.addEventListener('click', () => openStart(page)));
  const saved = read();
  if (!saved) return;
  if (Date.now() - saved.at > 120000 || SCENES[saved.i]?.page !== page) { clear(); return; }
  document.body.classList.add('presenting');
  const show = new Show(page, api, saved.mode, saved.elapsed);
  show.ui.cover(SCENES[saved.i]);
  Promise.resolve(ready).then(() => show.start(saved.i));
}

function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } }
function write(v) { try { sessionStorage.setItem(KEY, JSON.stringify({ ...v, at: Date.now() })); } catch { /* sin almacenamiento */ } }
function clear() { try { sessionStorage.removeItem(KEY); } catch { /* nada */ } }

const pageUrl = (p) => (p === '3d' ? '3d.html#plan' : 'index.html');

function openStart(page) {
  document.querySelector('.pres-start')?.remove();
  const total = SCENES.reduce((a, s) => a + s.dur, 0);
  const el = document.createElement('div');
  el.className = 'pres-start';
  el.innerHTML = `<div class="pres-start-box" role="dialog" aria-modal="true" aria-label="Presentation">
      <span class="pres-kicker">Presentation · ${SCENES.length} scenes · ~${Math.round(total / 60000)} min</span>
      <h2>ARES in four minutes</h2>
      <p>Layers, point-to-point routing, alternatives, 3D terrain with the rover, radiation, light and the mission report.
        It moves from the map to 3D on its own.</p>
      <div class="pres-start-btns">
        <button class="btn primary" type="button" data-mode="auto">Automatic</button>
        <button class="btn" type="button" data-mode="manual">Step by step</button>
        <button class="btn pres-cancel" type="button" data-mode="cancel">Cancel</button>
      </div>
      <p class="pres-keys"><b>→</b> / <b>Page Down</b> next · <b>←</b> back · <b>Space</b> pause or advance · <b>A</b> switch mode · <b>N</b> notes · <b>Esc</b> exit</p>
    </div>`;
  document.body.append(el);
  el.querySelector('[data-mode="auto"]').focus();
  el.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (!mode && e.target !== el) return;
    el.remove();
    if (!mode || mode === 'cancel') return;
    write({ i: 0, mode, elapsed: 0 });
    if (page === SCENES[0].page) location.reload();
    else location.href = pageUrl(SCENES[0].page);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.remove(); });
}

// ---------------------------------------------------------------- Motor
class Show {
  constructor(page, api, mode, elapsed = 0) {
    this.page = page;
    this.api = api;
    this.mode = mode === 'manual' ? 'manual' : 'auto';
    this.elapsed = elapsed; // ms de presentación (sin pausas), acumulados entre páginas
    this.paused = false;
    this.idx = -1;
    this.token = null;
    this.anims = new Set();
    this.sceneT = 0;
    this.last = null;
    this.ui = buildUI(this);
    const loop = (t) => {
      if (this.closed) return;
      // Tiempo real, con tope de 1 s por fotograma (equipos lentos o pestaña recién recuperada)
      const dt = this.last === null ? 0 : Math.min(1000, t - this.last);
      this.last = t;
      if (!this.paused) {
        this.elapsed += dt;
        this.sceneT += dt;
        for (const a of [...this.anims]) a.step(dt);
      }
      this.ui.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // --- utilidades para las escenas (todas se detienen en pausa y se cancelan al cambiar de escena) ---
  ctx() {
    const show = this;
    const token = this.token;
    const ctx = {
      api: this.api,
      anim(ms, fn) {
        return new Promise((resolve, reject) => {
          let t = 0;
          const a = {
            step(dt) {
              if (token.aborted) { show.anims.delete(a); reject(ABORT); return; }
              t += dt;
              const k = Math.min(1, t / ms);
              fn(k);
              if (k >= 1) { show.anims.delete(a); resolve(); }
            },
          };
          show.anims.add(a);
        });
      },
      wait: (ms) => ctx.anim(ms, () => {}),
      spot: (target, label) => show.ui.spot(target, label),
      setChips: (chips) => show.ui.chips(chips),
      // Barra de capas abierta o plegada
      layers(open) {
        const bar = document.querySelector('.layerbar');
        if (bar && bar.classList.contains('collapsed') === open) bar.querySelector('.lb-toggle')?.click();
      },
      async click(pt, letter) {
        await show.ui.cursorTo(pt);
        if (token.aborted) throw ABORT;
        show.ui.ripple(pt, letter);
      },
      // Cámara 3D (como el tour): punto a dist m de c, elev° sobre el horizonte, az° desde el norte
      around(c, { dist, elev, az }) {
        const V = show.api.THREE.Vector3;
        const e = rad(elev);
        const a = rad(az);
        return c.clone().add(new V(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, -Math.cos(a) * Math.cos(e) * dist));
      },
      place(pos, target) { show.api.camera.position.copy(pos); show.api.controls.target.copy(target); },
      fly(pos, target, ms, arc = 0.2) {
        const { camera, controls } = show.api;
        const p0 = camera.position.clone();
        const t0 = controls.target.clone();
        const mid = p0.clone().lerp(pos, 0.5);
        mid.y += p0.distanceTo(pos) * arc;
        return ctx.anim(ms, (k) => {
          const e = ease(k);
          const a = p0.clone().lerp(mid, e);
          const b = mid.clone().lerp(pos, e);
          camera.position.copy(a.lerp(b, e));
          controls.target.lerpVectors(t0, target, e);
        });
      },
      orbit(c, { dist, elev, az }, ms) {
        const lerp = (r, e) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * e : r);
        const start = show.api.camera.position.clone();
        const startT = show.api.controls.target.clone();
        return ctx.anim(ms, (k) => {
          const e = 0.5 - Math.cos(Math.PI * k) / 2;
          const pos = ctx.around(c, { dist: lerp(dist, e), elev: lerp(elev, e), az: lerp(az, e) });
          const blend = Math.min(1, k * 6); // entra suave desde donde estuviera la cámara
          show.api.camera.position.copy(start.clone().lerp(pos, ease(blend)));
          show.api.controls.target.copy(startT.clone().lerp(c, ease(blend)));
        });
      },
    };
    return ctx;
  }

  start(i) {
    document.body.classList.add('presenting');
    this.ui.open();
    this.go(i);
  }

  async go(i) {
    if (i < 0 || i >= SCENES.length) return;
    if (this.token) this.token.aborted = true;
    this.anims.clear();
    const sc = SCENES[i];
    if (sc.page !== this.page) {
      write({ i, mode: this.mode, elapsed: this.elapsed });
      this.ui.cover(sc);
      this.api.planDock?.player.pause();
      await wait0(450);
      location.href = pageUrl(sc.page);
      return;
    }
    const token = { aborted: false };
    this.token = token;
    this.idx = i;
    this.sceneT = 0;
    this.paused = false;
    write({ i, mode: this.mode, elapsed: this.elapsed });
    this.ui.scene(i, sc);
    try {
      await sc.run(this.ctx());
      if (token.aborted) return;
      if (sc.final) { this.ui.end(); return; }
      if (this.mode === 'auto') {
        await this.ctx().wait(Math.max(0, sc.dur - this.sceneT));
        if (!token.aborted) this.go(i + 1);
      } else {
        this.ui.waiting(true);
      }
    } catch (err) {
      if (err !== ABORT) { console.error(err); this.ui.waiting(true); }
    }
  }

  next() { if (this.idx < SCENES.length - 1) this.go(this.idx + 1); }
  prev() { if (this.idx > 0) this.go(this.idx - 1); }
  togglePause() {
    if (this.mode !== 'auto') { this.next(); return; }
    this.paused = !this.paused;
    const pl = this.api.planDock?.player;
    if (this.paused) { this.resumePlayer = !!pl?.playing; pl?.pause(); } else if (this.resumePlayer) pl?.play();
    this.ui.paused(this.paused);
  }
  toggleMode() {
    this.mode = this.mode === 'auto' ? 'manual' : 'auto';
    if (this.paused) this.togglePause();
    write({ i: this.idx, mode: this.mode, elapsed: this.elapsed });
    this.ui.mode(this.mode);
    // Al pasar a automático con la escena ya terminada, sigue sola
    if (this.mode === 'auto' && this.ui.isWaiting()) this.next();
  }
  exit() {
    if (this.token) this.token.aborted = true;
    this.closed = true;
    this.anims.clear();
    clear();
    this.ui.close();
    document.body.classList.remove('presenting');
    if (this.page === '3d') {
      this.api.controls.enabled = true;
      if (this.api.state.drive) this.api.exitDrive();
      this.api.setHour?.(16);
    }
  }
}

// ---------------------------------------------------------------- Interfaz
function buildUI(show) {
  const total = SCENES.length;
  const root = document.createElement('div');
  root.className = `pres pres-${show.page}`;
  root.hidden = true;
  root.innerHTML = `
    <div class="pres-prog" aria-hidden="true">${SCENES.map(() => '<i><b></b></i>').join('')}</div>
    <div class="pres-spot" hidden><span></span></div>
    <div class="pres-cursor" hidden></div>
    <section class="pres-card" aria-live="polite">
      <div class="pres-head"><span class="pres-kicker"></span><span class="pres-time mono"></span></div>
      <h2 class="pres-title"></h2>
      <ul class="pres-points"></ul>
      <div class="pres-chips"></div>
      <p class="pres-notes" hidden></p>
      <div class="pres-ctrl">
        <button class="pres-btn" data-act="prev" aria-label="Previous scene">${ICONS.prev}</button>
        <button class="pres-btn" data-act="pause" aria-label="Pause">${ICONS.pause}</button>
        <button class="pres-btn" data-act="next" aria-label="Next scene">${ICONS.next}</button>
        <button class="pres-mode" data-act="mode" title="Switch mode (A)"></button>
        <span class="pres-wait" hidden>→ next</span>
        <span class="pres-spacer"></span>
        <button class="pres-mode" data-act="notes" title="Speaker notes (N)">Notes</button>
        <button class="pres-mode" data-act="exit" title="Exit (Esc)">Exit</button>
      </div>
    </section>
    <div class="pres-cover" hidden><span class="pres-kicker"></span><h2></h2></div>`;
  document.body.append(root);
  const $q = (s) => root.querySelector(s);
  let spotEl = null;
  let waiting = false;
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') show.prev();
    else if (act === 'next') show.next();
    else if (act === 'pause') show.togglePause();
    else if (act === 'mode') show.toggleMode();
    else if (act === 'notes') toggleNotes();
    else if (act === 'exit') show.exit();
  });
  const toggleNotes = () => { $q('.pres-notes').hidden = !$q('.pres-notes').hidden; };
  const onKey = (e) => {
    if (root.hidden || e.target.closest?.('input, textarea, select')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); show.next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); show.prev(); }
    else if (k === ' ') { e.preventDefault(); show.togglePause(); }
    else if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); show.exit(); }
    else if (k === 'a' || k === 'A') show.toggleMode();
    else if (k === 'n' || k === 'N') toggleNotes();
  };
  window.addEventListener('keydown', onKey, true);
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  const ui = {
    open() { root.hidden = false; $q('.pres-cover').hidden = true; ui.mode(show.mode); },
    close() {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
    },
    cover(sc) {
      root.hidden = false;
      const c = $q('.pres-cover');
      c.hidden = false;
      c.querySelector('.pres-kicker').textContent = sc.page === '3d' ? 'Switching to 3D' : 'Back to the map';
      c.querySelector('h2').textContent = sc.title;
    },
    scene(i, sc) {
      $q('.pres-cover').hidden = true;
      const card = $q('.pres-card');
      card.classList.remove('in', 'end');
      void card.offsetWidth;
      card.classList.add('in');
      $q('.pres-kicker').textContent = `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')} · ${sc.kicker}`;
      $q('.pres-title').textContent = sc.title;
      $q('.pres-points').innerHTML = sc.points.map((p) => `<li>${p}</li>`).join('');
      $q('.pres-notes').textContent = sc.notes ?? '';
      ui.chips(sc.chips ?? []);
      ui.spot(null);
      ui.waiting(false);
      $q('[data-act="prev"]').disabled = i === 0;
      $q('[data-act="next"]').disabled = i === total - 1;
      root.querySelectorAll('.pres-prog i').forEach((el, k) => {
        el.classList.toggle('done', k < i);
        el.classList.toggle('now', k === i);
      });
      ui.paused(false);
    },
    chips(list) {
      $q('.pres-chips').innerHTML = list.map(([v, l]) => `<div class="pres-chip"><b>${v}</b><span>${l}</span></div>`).join('');
    },
    spot(target, label) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      spotEl = el && el.getClientRects().length ? el : null;
      const s = $q('.pres-spot');
      s.hidden = !spotEl;
      s.querySelector('span').textContent = label ?? '';
      s.querySelector('span').hidden = !label;
      ui.frame();
    },
    async cursorTo(pt) {
      const c = $q('.pres-cursor');
      if (c.hidden) {
        c.style.transition = 'none';
        c.style.transform = `translate(${pt.x + 140}px, ${pt.y + 120}px)`;
        c.hidden = false;
        void c.offsetWidth;
        c.style.transition = '';
      }
      c.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      await wait0(950);
    },
    ripple(pt, letter) {
      const r = document.createElement('div');
      r.className = 'pres-ripple';
      r.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      r.innerHTML = letter ? `<b>${letter}</b>` : '';
      root.append(r);
      setTimeout(() => r.remove(), 1200);
    },
    waiting(on) {
      waiting = on;
      $q('.pres-wait').hidden = !on || show.mode !== 'manual';
      const sc = SCENES[show.idx];
      if (on && show.mode === 'auto' && sc) root.querySelectorAll('.pres-prog i')[show.idx]?.classList.add('done');
    },
    isWaiting: () => waiting,
    paused(p) {
      const b = $q('[data-act="pause"]');
      b.innerHTML = p ? ICONS.play : ICONS.pause;
      b.setAttribute('aria-label', p ? 'Resume' : 'Pause');
      root.classList.toggle('is-paused', p);
    },
    mode(m) {
      $q('[data-act="mode"]').textContent = m === 'auto' ? 'Auto' : 'Step by step';
      $q('[data-act="pause"]').hidden = m !== 'auto';
      $q('.pres-wait').hidden = !(waiting && m === 'manual');
    },
    end() {
      waiting = true;
      $q('.pres-card').classList.add('end');
      $q('.pres-wait').hidden = true;
      root.querySelectorAll('.pres-prog i').forEach((el) => el.classList.add('done'));
    },
    frame() {
      // Progreso de la escena actual y reloj
      const sc = SCENES[show.idx];
      if (sc) {
        const bar = root.querySelectorAll('.pres-prog i')[show.idx]?.firstElementChild;
        if (bar) bar.style.width = `${Math.min(100, (show.sceneT / sc.dur) * 100)}%`;
      }
      $q('.pres-time').textContent = `${mmss(show.elapsed)} / ${mmss(TOTAL_MS)}`;
      // El recuadro sigue al elemento resaltado (puede moverse o hacer scroll)
      if (spotEl) {
        const r = spotEl.getBoundingClientRect();
        const s = $q('.pres-spot');
        s.style.transform = `translate(${r.left - 6}px, ${r.top - 6}px)`;
        s.style.width = `${r.width + 12}px`;
        s.style.height = `${r.height + 12}px`;
      }
    },
  };
  return ui;
}

const ICONS = {
  prev: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h2v10H3zM12 2v10L5.5 7z" fill="currentColor"/></svg>',
  next: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2h2v10H9zM2 2v10l6.5-5z" fill="currentColor"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>',
};
