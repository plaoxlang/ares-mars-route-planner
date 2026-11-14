// Tour guiado por Jezero: vuelos de cámara, capas, etiquetas sobre el terreno y narración.
// Se carga bajo demanda desde scene3d.js, que le pasa su API (cámara, capas, ruta…).
import { num, fmt, SITE } from './shared.js';

const rad = (d) => (d * Math.PI) / 180;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2); // easeInOutCubic
const ABORT = Symbol('abort');

export function offerTour(api) {
  const ui = buildUI(api);
  ui.showIntro(() => runTour(api, ui));
}

export function runTour(api, ui = buildUI(api)) {
  const tour = new Tour(api, ui);
  tour.start();
}

// ---------- Puntos de interés sacados de los datos ----------
function pointsOfInterest(pts) {
  const lowest = pts.reduce((a, p) => (p.elev_m < a.elev_m ? p : a));
  const highest = pts.reduce((a, p) => (p.elev_m > a.elev_m ? p : a));
  const steepest = pts.reduce((a, p) => (p.tilt_deg > a.tilt_deg ? p : a));
  // Mayor desnivel ganado en 1 km de recorrido
  let climb = { gain: -Infinity, from: 0, to: 0 };
  for (let i = 0; i < pts.length; i++) {
    let j = i;
    while (j < pts.length - 1 && pts[j].dist_total_m - pts[i].dist_total_m < 1000) j++;
    const gain = pts[j].elev_m - pts[i].elev_m;
    if (gain > climb.gain) climb = { gain, from: i, to: j };
  }
  return {
    landing: pts[0],
    lowest,
    highest,
    steepest,
    climb,
    climbMid: pts[Math.round((climb.from + climb.to) / 2)],
    last: pts.at(-1),
    deltaStart: pts.find((p) => p.sol >= 700) ?? pts[0],
    deltaTop: pts.find((p) => p.sol >= 1200) ?? pts.at(-1),
  };
}

// ---------- Guion ----------
function chapters(api) {
  const { pts, stats } = api;
  const poi = pointsOfInterest(pts);
  const r = api.radiation();
  const km = num(stats.distance_m / 1000, 1);
  const label = (p, title, sub) => ({ lon: p.lon, lat: p.lat, title, sub });

  return [
    {
      title: 'Bienvenido a Jezero',
      text: `Este cráter de unos 45 kilómetros fue un lago hace más de 3.500 millones de años. Desde febrero de 2021, el rover Perseverance lo recorre buscando rastros de vida antigua. Lo que ves es su ruta real: ${km} kilómetros sobre el relieve medido desde órbita.`,
      chips: [[`${km} km`, 'recorridos'], [num(pts.length), 'paradas'], [`${pts[0].sol}–${pts.at(-1).sol}`, 'soles']],
      layer: 'sat', exag: 2.5, stop: pts.length - 1,
      async shot(t) {
        const c = api.center();
        t.place(t.around(c, { dist: 24000, elev: 70, az: 205 }), c);
        await t.spiral(c, { dist: [24000, 10500], elev: [70, 30], az: [205, 250] }, 11000);
      },
    },
    {
      title: 'Octavia E. Butler Landing',
      text: `Aquí tocó suelo Perseverance el 18 de febrero de 2021, en el fondo del cráter. NASA bautizó el lugar en honor a la escritora de ciencia ficción. La primera parada registrada es del sol ${poi.landing.sol}, a ${num(poi.landing.elev_m)} metros respecto al nivel de referencia de Marte.`,
      chips: [[fmt.m(poi.landing.elev_m), 'altitud'], ['18-02-2021', 'aterrizaje']],
      layer: 'sat', exag: 2.5, stop: 0,
      labels: [label(poi.landing, 'Aterrizaje', `sol ${poi.landing.sol}`)],
      async shot(t) {
        const p = t.P(poi.landing);
        await t.fly(t.around(p, { dist: 2600, elev: 32, az: 150 }), p, 6000);
        await t.orbit(p, { dist: 2600, elev: 32, az: [150, 205] }, 9000);
      },
    },
    {
      title: 'Dos ojos en órbita',
      text: 'La imagen del suelo viene de dos cámaras del Mars Reconnaissance Orbiter. CTX cubre toda la zona a 6 metros por píxel; HiRISE, la más potente que orbita Marte, llega a 25 centímetros y permite distinguir rocas de un metro. Vamos a volar a ras de suelo hacia el delta.',
      chips: [['6 m/px', 'CTX'], ['25 cm/px', 'HiRISE']],
      layer: 'sat', exag: 2.5, stop: 0,
      async shot(t) {
        const from = t.P(pts[20]);
        const to = t.P(poi.deltaStart);
        await t.fly(t.around(from, { dist: 1100, elev: 12, az: 120 }), from, 4500);
        await t.track(from, to, { dist: 1100, elev: [12, 22], az: [120, 160] }, 12000);
      },
    },
    {
      title: 'Un relieve de 800 metros',
      text: `Esta capa colorea la altura con un modelo digital del terreno de 20 metros, creado para guiar el aterrizaje. Del punto más bajo de la ruta, a ${num(poi.lowest.elev_m)} metros, al más alto, en el borde del cráter, hay ${num(poi.highest.elev_m - poi.lowest.elev_m)} metros de desnivel. El modelo coincide con las alturas medidas por el rover con un error de unos 3 metros.`,
      chips: [[fmt.m(poi.lowest.elev_m), 'punto más bajo'], [fmt.m(poi.highest.elev_m), 'punto más alto'], [`+${num(poi.highest.elev_m - poi.lowest.elev_m)} m`, 'desnivel']],
      layer: 'elev', exag: 2.5, stop: 0,
      labels: [label(poi.lowest, 'Punto más bajo', fmt.m(poi.lowest.elev_m)), label(poi.highest, 'Punto más alto', fmt.m(poi.highest.elev_m))],
      async shot(t) {
        const c = api.center();
        await t.fly(t.around(c, { dist: 14000, elev: 55, az: 180 }), c, 4500);
        await t.exaggerate(2.5, 3.5, 3000);
        await t.track(t.P(poi.lowest), t.P(poi.highest), { dist: 7500, elev: [40, 28], az: [170, 130] }, 11000);
      },
    },
    {
      title: 'Por dónde se puede caminar',
      text: `La pendiente es lo primero que mira quien planifica una excursión. En verde, menos de 8 grados: terreno cómodo. En ámbar, de 8 a 15: exigente con traje y equipo. En rojo, más de 15: mejor evitarlo. El tramo más duro de la ruta gana ${num(poi.climb.gain)} metros en un solo kilómetro, al subir al borde del cráter.`,
      chips: [[`+${num(poi.climb.gain)} m`, 'en 1 km'], [`${num(poi.steepest.tilt_deg, 1)}°`, 'inclinación máx. del rover']],
      layer: 'slope', exag: 2.5, stop: poi.climb.to,
      labels: [label(poi.climbMid, 'Subida más dura', `+${num(poi.climb.gain)} m en 1 km`), label(poi.steepest, 'Inclinación máxima', `${num(poi.steepest.tilt_deg, 1)}° · sol ${poi.steepest.sol}`)],
      async shot(t) {
        const p = t.P(poi.climbMid);
        await t.fly(t.around(p, { dist: 3200, elev: 24, az: 105 }), p, 5000);
        await t.orbit(p, { dist: 3200, elev: 24, az: [105, 175] }, 11000);
      },
    },
    {
      title: 'Dónde aprieta el frío',
      text: 'De noche, el suelo de Marte cae por debajo de los 80 grados bajo cero, pero no todo se enfría igual. Esta capa sale del infrarrojo nocturno de la sonda Mars Odyssey: la arena y el polvo, en azul, pierden el calor antes; la roca, en naranja, lo guarda más tiempo. Es una medida relativa, no en grados.',
      chips: [['100 m/px', 'THEMIS noche'], ['relativo', 'sin grados']],
      layer: 'cold', exag: 2.5, stop: poi.climb.to,
      async shot(t) {
        const c = api.center();
        await t.fly(t.around(c, { dist: 13000, elev: 50, az: 150 }), c, 5000);
        await t.spiral(c, { dist: [13000, 10000], elev: [50, 38], az: [150, 215] }, 12000);
      },
    },
    {
      title: 'La radiación que llega al suelo',
      text: `Marte no tiene un campo magnético global y su atmósfera es muy fina. El detector RAD de Curiosity midió unos 0,64 milisieverts al día en superficie, unas cien veces la dosis natural media en la Tierra. Esta capa es una estimación: los valles reciben menos porque el relieve tapa parte del cielo, y las zonas altas, un poco más.`,
      chips: [[`${num(r.min, 2)}–${num(r.max, 2)}`, 'mSv/día estimados'], ['≈100×', 'dosis natural en la Tierra']],
      layer: 'rad', exag: 2.5, stop: poi.climb.to,
      async shot(t) {
        const p = t.P(poi.highest);
        await t.fly(t.around(p, { dist: 5200, elev: 28, az: 125 }), p, 5000);
        await t.orbit(p, { dist: 5200, elev: 28, az: [125, 60] }, 11000);
      },
    },
    {
      title: `${km} kilómetros en medio minuto`,
      text: 'Así ha avanzado Perseverance, parada a parada. Fíjate en cómo cruza el fondo del cráter, sube al delta y trepa después al borde.',
      chips: [['—', 'sol'], ['—', 'km'], ['—', 'altitud']],
      live: true,
      layer: 'sat', exag: 2, stop: 0,
      async shot(t) {
        await t.fly(t.around(t.P(pts[0]), { dist: 3800, elev: 34, az: 160 }), t.P(pts[0]), 4000);
        await t.chase(34000);
      },
    },
    {
      title: 'A pie de borde',
      text: `Aquí está Perseverance ahora, en el borde del cráter, a ${num(poi.last.elev_m)} metros. Este es el punto de vista de un astronauta: el mapa que acabas de recorrer es lo que llevaría consigo para planificar cada paso. Explora ahora por tu cuenta.`,
      chips: [[`sol ${poi.last.sol}`, `≈ ${SITE.solDate(poi.last.sol)}`], [fmt.m(poi.last.elev_m), 'altitud actual']],
      layer: 'sat', exag: 2, stop: pts.length - 1,
      final: true,
      async shot(t) {
        const pose = api.astroPose(pts.length - 1);
        await t.fly(pose.pos, pose.target, 6000, 0.5);
        api.setAstroMode(true, { showBeacon: false });
        await t.lookAround(pose.pos, pose.target, 9000);
        api.setAstroMode(false);
        const c = api.center();
        await t.fly(t.around(c, { dist: 15000, elev: 42, az: 200 }), c, 6000, 0.3);
      },
    },
  ];
}

// ---------- Motor ----------
class Tour {
  constructor(api, ui) {
    this.api = api;
    this.ui = ui;
    this.V = api.THREE.Vector3;
    this.list = chapters(api);
    this.idx = 0;
    this.paused = false;
    this.token = null;
    this.anims = new Set();
    this.labels = [];
    this.voice = ui.voiceAvailable;
    this.last = null;
    this.offFrame = api.onFrame((t) => this.frame(t));
  }

  // --- Ciclo de fotogramas: reloj propio que se detiene en pausa ---
  frame(t) {
    if (this.last !== null && t < this.last) return; // marca de tiempo antigua: se ignora
    // Tiempo real, con tope de 1 s por fotograma (equipos lentos o pestaña recién recuperada).
    const dt = this.last === null ? 0 : Math.min(1000, Math.max(0, t - this.last));
    this.last = t;
    if (!this.paused) for (const a of [...this.anims]) a.step(dt);
    this.ui.placeLabels(this.labels, this.api);
  }

  animate(duration, fn) {
    const token = this.token;
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      const a = {
        step: (dt) => {
          if (token.aborted) { this.anims.delete(a); reject(ABORT); return; }
          elapsed += dt;
          const k = Math.min(1, elapsed / duration);
          fn(k, dt);
          if (k >= 1) { this.anims.delete(a); resolve(); }
        },
      };
      this.anims.add(a);
    });
  }

  // Animación sin fin hasta que se cumpla la promesa until (mantiene la cámara viva mientras habla).
  drift(until) {
    const { camera, controls } = this.api;
    const token = this.token;
    let done = false;
    until.then(() => { done = true; }, () => { done = true; });
    return new Promise((resolve, reject) => {
      const a = {
        step: (dt) => {
          if (token.aborted) { this.anims.delete(a); reject(ABORT); return; }
          if (done) { this.anims.delete(a); resolve(); return; }
          if (this.api.state.astro) return;
          const off = camera.position.clone().sub(controls.target);
          off.applyAxisAngle(new this.V(0, 1, 0), (dt / 1000) * 0.035);
          camera.position.copy(controls.target).add(off);
        },
      };
      this.anims.add(a);
    });
  }

  // --- Utilidades de encuadre ---
  P(p) { return this.api.worldPoint(p.lon, p.lat); }

  // Punto a dist metros de c, elev grados sobre el horizonte, az grados desde el norte (horario).
  around(c, { dist, elev, az }) {
    const e = rad(elev);
    const a = rad(az);
    return c.clone().add(new this.V(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, -Math.cos(a) * Math.cos(e) * dist));
  }

  place(pos, target) {
    this.api.camera.position.copy(pos);
    this.api.controls.target.copy(target);
  }

  fly(pos, target, duration, arc = 0.22) {
    const { camera, controls } = this.api;
    const p0 = camera.position.clone();
    const t0 = controls.target.clone();
    const mid = p0.clone().lerp(pos, 0.5);
    mid.y += p0.distanceTo(pos) * arc;
    return this.animate(duration, (k) => {
      const e = ease(k);
      const a = p0.clone().lerp(mid, e);
      const b = mid.clone().lerp(pos, e);
      camera.position.copy(a.lerp(b, e));
      controls.target.lerpVectors(t0, target, e);
    });
  }

  orbit(c, { dist, elev, az }, duration) {
    return this.animate(duration, (k) => {
      const e = 0.5 - Math.cos(Math.PI * k) / 2;
      this.place(this.around(c, { dist, elev, az: az[0] + (az[1] - az[0]) * e }), c);
    });
  }

  spiral(c, { dist, elev, az }, duration) {
    const lerp = (r, e) => r[0] + (r[1] - r[0]) * e;
    return this.animate(duration, (k) => {
      const e = ease(k);
      this.place(this.around(c, { dist: lerp(dist, e), elev: lerp(elev, e), az: lerp(az, e) }), c);
    });
  }

  track(from, to, { dist, elev, az }, duration) {
    const lerp = (r, e) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * e : r);
    return this.animate(duration, (k) => {
      const e = ease(k);
      const c = from.clone().lerp(to, e);
      this.place(this.around(c, { dist, elev: lerp(elev, e), az: lerp(az, e) }), c);
    });
  }

  exaggerate(a, b, duration) {
    return this.animate(duration, (k) => this.api.setExaggeration(Math.round((a + (b - a) * ease(k)) * 10) / 10));
  }

  // Mirar alrededor desde los ojos del astronauta (giro suave a izquierda y derecha).
  lookAround(eye, target, duration) {
    const off = target.clone().sub(eye);
    return this.animate(duration, (k) => {
      const yaw = Math.sin(k * Math.PI * 2) * rad(28);
      this.place(eye, eye.clone().add(off.clone().applyAxisAngle(new this.V(0, 1, 0), yaw)));
    });
  }

  // Recorre la ruta con la cámara siguiendo al rover.
  chase(duration) {
    const { pts } = this.api;
    let target = this.P(pts[0]);
    let shown = -1;
    return this.animate(duration, (k, dt) => {
      const i = Math.min(pts.length - 1, Math.floor(k * (pts.length - 1)));
      if (i !== shown) {
        shown = i;
        this.api.select(i, { moveCamera: false });
        const p = pts[i];
        this.ui.setChips([[`${p.sol}`, 'sol'], [num(p.dist_total_m / 1000, 1), 'km'], [fmt.m(p.elev_m), 'altitud']]);
      }
      const goal = this.P(pts[i]);
      target = target.clone().lerp(goal, Math.min(1, dt / 350));
      this.place(this.around(target, { dist: 3800, elev: 34, az: 160 + 70 * k }), target);
    });
  }

  // --- Capítulos ---
  async start() {
    const { api, ui } = this;
    document.body.classList.add('touring');
    api.controls.enabled = false;
    ui.open({
      onPrev: () => this.go(this.idx - 1),
      onNext: () => this.go(this.idx + 1),
      onPause: () => this.togglePause(),
      onVoice: () => this.toggleVoice(),
      onExit: () => this.exit(),
      count: this.list.length,
    });
    ui.setVoice(this.voice);
    this.go(0);
  }

  async go(i) {
    if (i < 0 || i >= this.list.length) return;
    if (this.token) this.token.aborted = true;
    speechSynthesis?.cancel();
    this.paused = false;
    this.ui.setPaused(false);
    const token = { aborted: false };
    this.token = token;
    this.idx = i;
    const ch = this.list[i];
    this.labels = [];
    this.ui.showChapter(i, ch);
    try {
      // Estado de partida del capítulo (permite saltar a cualquiera)
      this.api.setAstroMode(false);
      if (this.api.state.layer !== ch.layer) await this.ui.dip(() => this.api.setLayer(ch.layer));
      if (token.aborted) return;
      if (Math.abs(this.api.state.exag - ch.exag) > 0.01) this.api.setExaggeration(ch.exag);
      this.api.select(ch.stop, { moveCamera: false });
      this.labels = ch.labels ?? [];

      const speech = this.speak(`${ch.title}. ${ch.text}`, ch.text);
      speech.catch(() => {}); // si se salta el capítulo, la espera se cancela sin ruido
      await ch.shot(this);
      await this.drift(speech);
      if (token.aborted) return;
      if (ch.final) this.ui.showEnd();
      else this.go(i + 1);
    } catch (err) {
      if (err !== ABORT) throw err;
    }
  }

  // Narración: voz en español si la hay; si no, tiempo de lectura estimado.
  speak(spoken, text) {
    const readMs = Math.max(6000, text.length * 55);
    const token = this.token;
    if (!this.voice) return this.animate(readMs, () => {});
    return new Promise((resolve) => {
      let started = false;
      const u = new SpeechSynthesisUtterance(spoken);
      u.lang = 'es-ES';
      if (this.ui.voice) u.voice = this.ui.voice;
      u.rate = 1.02;
      u.onstart = () => { started = true; };
      u.onend = () => resolve();
      u.onerror = () => resolve();
      // Si la voz no arranca (sin voces instaladas, bloqueo del navegador…), se usa el tiempo de lectura.
      setTimeout(() => {
        if (!started) resolve(this.animate(readMs, () => {}).catch(() => {}));
      }, 2000);
      setTimeout(resolve, readMs * 1.8); // red de seguridad por si no avisa del final
      if (!token.aborted) speechSynthesis.speak(u);
    });
  }

  togglePause() {
    this.paused = !this.paused;
    this.ui.setPaused(this.paused);
    if (this.voice) {
      if (this.paused) speechSynthesis.pause();
      else speechSynthesis.resume();
    }
  }

  toggleVoice() {
    this.voice = !this.voice && this.ui.voiceAvailable;
    this.ui.setVoice(this.voice);
    if (!this.voice) speechSynthesis?.cancel();
  }

  exit() {
    if (this.token) this.token.aborted = true;
    speechSynthesis?.cancel();
    this.offFrame();
    this.labels = [];
    this.ui.close();
    document.body.classList.remove('touring');
    const { api } = this;
    api.controls.enabled = true;
    api.setAstroMode(false);
    api.select(api.state.idx, { moveCamera: false });
    api.overview();
  }
}

// ---------- Interfaz ----------
function buildUI(api) {
  const stage = api.stage;
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const voices = () => (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang?.toLowerCase().startsWith('es'));
  const pickVoice = () => {
    const vs = voices();
    return vs.find((v) => /es-ES/i.test(v.lang) && /natural|neural|google/i.test(v.name))
      ?? vs.find((v) => /es-ES/i.test(v.lang)) ?? vs[0] ?? null;
  };

  const root = el(`<div class="tour" hidden>
      <div class="tour-bar top"></div><div class="tour-bar bottom"></div>
      <div class="tour-fade"></div>
      <div class="tour-labels"></div>
      <section class="tour-card" aria-live="polite">
        <div class="tour-head"><span class="tour-count mono"></span><div class="tour-steps"></div></div>
        <h2 class="tour-title"></h2>
        <p class="tour-text"></p>
        <div class="tour-chips"></div>
        <div class="tour-controls">
          <button class="btn icon" data-act="prev" aria-label="Capítulo anterior">${ICONS.prev}</button>
          <button class="btn icon" data-act="pause" aria-label="Pausar">${ICONS.pause}</button>
          <button class="btn icon" data-act="next" aria-label="Capítulo siguiente">${ICONS.next}</button>
          <button class="btn" data-act="voice" aria-pressed="true">${ICONS.voice}<span>Voz</span></button>
          <span class="tour-spacer"></span>
          <button class="btn" data-act="exit">Salir del tour</button>
        </div>
      </section>
    </div>`);
  stage.appendChild(root);
  const $q = (s) => root.querySelector(s);
  let handlers = {};
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const map = { prev: 'onPrev', next: 'onNext', pause: 'onPause', voice: 'onVoice', exit: 'onExit', start: 'onStart' };
    if (act && handlers[map[act]]) handlers[map[act]]();
  });
  const onKey = (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') handlers.onExit?.();
    else if (e.key === 'ArrowRight') handlers.onNext?.();
    else if (e.key === 'ArrowLeft') handlers.onPrev?.();
    else if (e.key === ' ') { e.preventDefault(); handlers.onPause?.(); }
  };
  document.addEventListener('keydown', onKey);

  const labelEls = new Map();
  const ui = {
    voiceAvailable: 'speechSynthesis' in window,
    get voice() { return pickVoice(); },
    open(h) {
      handlers = h;
      ui.count = h.count;
      $q('.tour-steps').innerHTML = Array.from({ length: h.count }, () => '<i></i>').join('');
      root.hidden = false;
      setTimeout(() => root.classList.add('on'), 30);
    },
    close() {
      root.classList.remove('on');
      root.hidden = true;
      labelEls.forEach((n) => n.remove());
      labelEls.clear();
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
    showChapter(i, ch) {
      const card = $q('.tour-card');
      card.classList.remove('in');
      void card.offsetWidth; // reinicia la animación de entrada
      card.classList.add('in');
      card.classList.remove('end');
      $q('.tour-count').textContent = `CAPÍTULO ${String(i + 1).padStart(2, '0')} / ${String(ui.count).padStart(2, '0')}`;
      root.querySelectorAll('.tour-steps i').forEach((s, k) => s.classList.toggle('done', k <= i));
      $q('.tour-title').textContent = ch.title;
      $q('.tour-text').textContent = ch.text;
      this.setChips(ch.chips ?? []);
      $q('[data-act="prev"]').disabled = i === 0;
      const next = $q('[data-act="next"]');
      next.hidden = false;
      $q('.tour-controls .explore')?.remove();
    },
    setChips(chips) {
      $q('.tour-chips').innerHTML = chips.map(([v, k]) => `<div class="tour-chip"><b>${v}</b><span>${k}</span></div>`).join('');
    },
    setPaused(p) {
      const b = $q('[data-act="pause"]');
      b.innerHTML = p ? ICONS.play : ICONS.pause;
      b.setAttribute('aria-label', p ? 'Continuar' : 'Pausar');
      root.classList.toggle('paused', p);
    },
    setVoice(on) {
      const b = $q('[data-act="voice"]');
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !this.voiceAvailable;
      b.title = this.voiceAvailable ? '' : 'Este navegador no tiene síntesis de voz';
    },
    showEnd() {
      const ctr = $q('.tour-controls');
      $q('[data-act="next"]').hidden = true;
      if (!ctr.querySelector('.explore')) {
        const b = el('<button class="btn primary explore" data-act="exit">Explorar por tu cuenta</button>');
        ctr.insertBefore(b, $q('.tour-spacer'));
      }
      $q('.tour-card').classList.add('end');
    },
    // Fundido a negro breve para cambiar de capa sin salto brusco.
    async dip(fn) {
      const f = $q('.tour-fade');
      f.classList.add('on');
      await new Promise((r) => setTimeout(r, 380));
      await fn();
      f.classList.remove('on');
    },
    placeLabels(labels, a) {
      const live = new Set();
      const { camera } = a;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      for (const l of labels) {
        const key = `${l.title}|${l.lon}|${l.lat}`;
        live.add(key);
        let n = labelEls.get(key);
        if (!n) {
          n = el(`<div class="tlabel"><span class="tl-dot"></span><span class="tl-line"></span><span class="tl-text"><b>${l.title}</b><small>${l.sub ?? ''}</small></span></div>`);
          $q('.tour-labels').appendChild(n);
          labelEls.set(key, n);
          setTimeout(() => n.classList.add('on'), 30);
        }
        const v = a.worldPoint(l.lon, l.lat).project(camera);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        n.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        n.style.visibility = visible ? 'visible' : 'hidden';
      }
      for (const [key, n] of labelEls) {
        if (!live.has(key)) {
          n.remove();
          labelEls.delete(key);
        }
      }
    },
    // Pantalla de bienvenida (cuando se llega con #tour): hace falta un clic para poder usar la voz.
    showIntro(onStart) {
      const intro = el(`<div class="tour-intro"><div>
          <span class="tour-count mono">TOUR GUIADO · 9 CAPÍTULOS · ~3 MIN</span>
          <h2>Jezero, a vista de rover</h2>
          <p>Vuela sobre el cráter, descubre las capas del mapa y recorre los ${num(api.stats.distance_m / 1000, 1)} km de Perseverance.</p>
          <button class="btn primary" data-start>Empezar el tour</button>
          <button class="btn" data-skip>Ahora no</button>
        </div></div>`);
      stage.appendChild(intro);
      intro.querySelector('[data-start]').addEventListener('click', () => { intro.remove(); onStart(); });
      intro.querySelector('[data-skip]').addEventListener('click', () => intro.remove());
    },
  };
  // Algunos navegadores cargan las voces más tarde
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => {});
  return ui;
}

const ICONS = {
  prev: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h2v10H3zM12 2v10L5.5 7z" fill="currentColor"/></svg>',
  next: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2h2v10H9zM2 2v10l6.5-5z" fill="currentColor"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>',
  voice: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor"/><path d="M11 5.5c1 .7 1 4.3 0 5M13 3.5c2 1.6 2 7.4 0 9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};
