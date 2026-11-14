// Planificador de rutas tipo "Google Maps" en el mapa 2D: origen, destino y alternativas.
// El cálculo (A* sobre el DTM) va en planner-worker.js para no bloquear la página.
// El vehículo es fijo (rover presurizado, ver plan-config.js).
import { $, num, fmt, latLon, M_PER_DEG, tiltClass } from './shared.js';
import { savePlan, formatHours } from './route-player.js';
import { VEHICLE, OBJECTIVES } from './plan-config.js';

export function setupPlanner({ L, map, dem, onRouteChange, onPlay, onCreated, onDrive, onPoints }) {
  const state = {
    active: false,
    vehicle: { ...VEHICLE },
    origin: null,
    dest: null,
    routes: [],
    selected: 0,
    reqId: 0,
    ready: false,
  };

  // ---------- Workers ----------
  // Un worker por objetivo (rápida, segura, energía) para calcular las alternativas en paralelo; cada uno
  // importa el A* común (src/planner/a-star.js). Con pocos núcleos se reparten entre menos workers.
  const POOL = Math.max(1, Math.min(OBJECTIVES.length, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  let readyCount = 0;
  const pending = { id: 0, parts: 0, routes: [], t0: 0 };
  for (let k = 0; k < POOL; k++) {
    const wk = new Worker('planner-worker.js', { type: 'module' });
    const heights = dem.heights.slice();
    wk.postMessage({ type: 'init', heights, width: dem.width, height: dem.height, pxX: dem.pxX, pxY: dem.pxY }, [heights.buffer]);
    wk.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        readyCount++;
        if (readyCount === POOL) { state.ready = true; if (state.origin && state.dest) compute(); }
        return;
      }
      if (m.id !== state.reqId || m.id !== pending.id) return; // respuesta antigua
      if (m.type === 'error') { setStatus(`Routing error: ${m.message}`, 'bad'); return; }
      pending.routes.push(...m.routes);
      pending.snap = m.snap ?? pending.snap;
      if (--pending.parts > 0) return;
      // Todas las partes: se ordenan como OBJECTIVES y se procesan juntas
      const order = OBJECTIVES.map((o) => o.key);
      onRoutes(pending.routes.sort((a, b) => order.indexOf(a.objective) - order.indexOf(b.objective)), Math.round(performance.now() - pending.t0));
    };
    workers.push(wk);
  }

  function onRoutes(routes, ms) {
    const m = { routes, ms };
    // Datos por vértice para reproducir la ruta y llevarla a la vista 3D
    for (const r of m.routes) {
      if (r.unreachable) continue;
      r.latlngs = Array.from(r.cells, toLatLng);
      r.cumDist = Array.from(r.track.dist); // ojo: r.hours es el total; estos son por vértice
      r.cumHours = Array.from(r.track.hours);
      r.elevs = Array.from(r.track.elev);
      r.slopes = Array.from(r.track.slope);
    }
    state.routes = m.routes;
    state.ms = m.ms;
    state.snap = pending.snap ?? null;
    state.shown = uniqueRoutes();
    const want = state.wantObjective ?? state.lastObjective;
    state.selected = Math.max(0, state.shown.findIndex((r) => r.objectives.includes(want)));
    state.wantObjective = null;
    drawRoutes({ animate: true });
    renderResults({ fresh: true });
    notify();
    const done = resultWaiters.splice(0);
    done.forEach((fn) => fn(state.shown));
    if (state.userEdit && state.shown.length && state.origin && state.dest) {
      state.userEdit = false;
      onCreated?.(currentPlan());
    }
  }
  const resultWaiters = [];

  // ---------- Coordenadas ↔ celdas del DTM ----------
  const toCell = (ll) => {
    const c = Math.floor(((ll.lng - dem.west) / (dem.east - dem.west)) * dem.width);
    const r = Math.floor(((dem.north - ll.lat) / (dem.north - dem.south)) * dem.height);
    return c < 0 || r < 0 || c >= dem.width || r >= dem.height ? null : [c, r];
  };
  const toLatLng = (i) => {
    const c = i % dem.width;
    const r = (i - c) / dem.width;
    return [dem.north - ((r + 0.5) * (dem.north - dem.south)) / dem.height, dem.west + ((c + 0.5) * (dem.east - dem.west)) / dem.width];
  };

  const FIT_PAD = () => (window.innerWidth > 900
    ? { paddingTopLeft: [420, 60], paddingBottomRight: [80, 60] }
    : { padding: [20, 20] });

  // ---------- Capas del mapa ----------
  const layer = L.layerGroup();
  const extent = L.rectangle([[dem.south, dem.west], [dem.north, dem.east]], {
    color: '#e8eaed', weight: 1, opacity: 0.5, dashArray: '4 6', fill: false, interactive: false,
  });
  const routeGroup = L.layerGroup().addTo(layer);
  const pin = (letter, cls) => L.divIcon({ className: `pin ${cls}`, html: `<span><b>${letter}</b></span>`, iconSize: [26, 34], iconAnchor: [13, 32] });
  const markers = { origin: null, dest: null };

  function placeMarker(kind, ll) {
    if (!markers[kind]) {
      markers[kind] = L.marker(ll, { icon: pin(kind === 'origin' ? 'A' : 'B', kind), draggable: true, keyboard: false, zIndexOffset: 1000 })
        .on('dragend', (e) => { state.userEdit = true; setPoint(kind, e.target.getLatLng(), { keepMarker: true }); })
        .addTo(layer);
    } else {
      markers[kind].setLatLng(ll);
    }
  }

  function setPoint(kind, ll, { keepMarker = false } = {}) {
    const cell = toCell(ll);
    if (!cell) {
      setStatus('That point is outside the terrain area (dashed box).', 'warn');
      if (keepMarker && state[kind]) markers[kind].setLatLng(state[kind].ll);
      return;
    }
    state[kind] = { ll: L.latLng(ll), cell };
    placeMarker(kind, ll);
    renderPoints();
    if (state.origin && state.dest) compute();
    else setStatus('Now click the map to set the destination (B).');
  }

  map.on('click', (e) => {
    if (!state.active) return;
    state.userEdit = true; // ruta hecha por el usuario (no restaurada ni de la presentación)
    if (!state.origin) setPoint('origin', e.latlng);
    else if (!state.dest) setPoint('dest', e.latlng);
    else setPoint('dest', e.latlng); // con los dos puestos, un clic mueve el destino
  });

  // ---------- Cálculo ----------
  function compute() {
    if (!state.origin || !state.dest) return;
    if (!state.ready) { setStatus('Preparing terrain…'); return; }
    state.reqId += 1;
    setStatus('Calculating routes…', 'busy');
    const box = $('plan-results');
    box.classList.add('pending');
    box.classList.remove('fresh');
    $('plan-routes-sec').hidden = false;
    if (!box.querySelector('.route-card')) {
      box.innerHTML = Array.from({ length: 3 }, (_, k) => `<div class="route-card skeleton" style="--i:${k}"><i></i><i></i></div>`).join('');
    }
    // Reparto de objetivos entre los workers (uno por worker si hay suficientes)
    const parts = workers.map(() => []);
    OBJECTIVES.forEach((o, k) => parts[k % workers.length].push(o.key));
    Object.assign(pending, { snap: null, id: state.reqId, parts: parts.filter((p) => p.length).length, routes: [], t0: performance.now() });
    parts.forEach((objectives, k) => {
      if (!objectives.length) return;
      workers[k].postMessage({
        type: 'plan',
        id: state.reqId,
        start: state.origin.cell,
        goal: state.dest.cell,
        vehicle: state.vehicle,
        objectives,
      });
    });
  }

  function objectiveLabel(key) {
    return OBJECTIVES.find((o) => o.key === key).label;
  }

  // Alternativas: si dos objetivos dan la misma ruta, se muestra una sola con ambas etiquetas.
  function uniqueRoutes() {
    const out = [];
    for (const r of state.routes) {
      if (r.unreachable) continue;
      const dup = out.find((o) => Math.abs(o.distance_m - r.distance_m) < 1 && o.cells.length === r.cells.length);
      if (dup) {
        dup.labels.push(objectiveLabel(r.objective));
        dup.objectives.push(r.objective);
      } else {
        out.push({ ...r, labels: [objectiveLabel(r.objective)], objectives: [r.objective] });
      }
    }
    return out;
  }

  // Trazo animado: la línea "se dibuja" de A a B (en SVG, con el desplazamiento del trazo discontinuo)
  function animateStroke(layer, ms, delay = 0) {
    const el = layer.getElement?.();
    if (!el || typeof el.getTotalLength !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const len = el.getTotalLength();
    el.style.strokeDasharray = `${len} ${len}`;
    el.style.strokeDashoffset = String(len);
    el.getBoundingClientRect();
    el.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(0.45, 0, 0.2, 1) ${delay}ms`;
    el.style.strokeDashoffset = '0';
    // Al acabar se quita el discontinuo: si no, al hacer zoom la línea quedaría a medias
    setTimeout(() => { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; el.style.transition = ''; }, ms + delay + 60);
  }

  function drawRoutes({ animate = false } = {}) {
    routeGroup.clearLayers();
    const routes = state.shown ?? [];
    if (state.selected >= routes.length) state.selected = 0;
    // Primero las alternativas (gris), luego la seleccionada encima (azul), como en Google Maps.
    const order = routes.map((_, k) => k).sort((a, b) => (a === state.selected) - (b === state.selected));
    for (const k of order) {
      const latlngs = Array.from(routes[k].cells, toLatLng);
      const sel = k === state.selected;
      const casing = L.polyline(latlngs, { color: '#0b1a2b', weight: sel ? 9 : 7, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false, className: sel ? 'route-sel' : 'route-alt' }).addTo(routeGroup);
      const line = L.polyline(latlngs, {
        color: sel ? '#4ea1ff' : '#b8c0ca', weight: sel ? 5 : 4, opacity: sel ? 1 : 0.85, lineCap: 'round', lineJoin: 'round',
        className: sel ? 'route-sel' : 'route-alt',
      })
        .on('click', (e) => { L.DomEvent.stop(e); selectRoute(k); })
        .bindTooltip(`${routes[k].labels.join(' · ')} · ${formatHours(routes[k].hours)} · ${fmt.km(routes[k].distance_m)}`, { sticky: true })
        .addTo(routeGroup);
      // Ruta nueva: las alternativas se dibujan primero y la elegida encima, un poco después y más lenta
      if (animate) {
        const ms = sel ? 1800 : 1250;
        const delay = sel ? 350 : 0;
        animateStroke(casing, ms, delay);
        animateStroke(line, ms, delay);
      }
    }
    // Si A o B estaban en una zona inalcanzable: línea discontinua del pin al punto donde empieza o acaba la ruta
    const sel = routes[state.selected];
    if (sel && state.snap) {
      const ends = [[state.snap.startMoved_m, state.origin, sel.latlngs[0]], [state.snap.goalMoved_m, state.dest, sel.latlngs.at(-1)]];
      for (const [moved, p, end] of ends) {
        if (moved > 0 && p) {
          L.polyline([p.ll, end], { color: '#ffb547', weight: 2.5, opacity: 0.95, dashArray: '5 6', interactive: false }).addTo(routeGroup);
        }
      }
    }
    Object.values(markers).forEach((m) => m?.bringToFront?.());
  }

  function selectRoute(k) {
    state.selected = k;
    drawRoutes();
    renderResults();
    notify();
  }

  // Ruta elegida → se guarda (para la vista 3D) y se avisa a la página (barra de tiempo).
  function currentPlan() {
    const r = state.shown?.[state.selected];
    if (!r || !state.origin || !state.dest) return null;
    state.lastObjective = r.objectives[0];
    return {
      // Si A o B se movieron al punto alcanzable más cercano, la ruta empieza y acaba ahí
      origin: { lat: r.latlngs[0][0], lon: r.latlngs[0][1] },
      dest: { lat: r.latlngs.at(-1)[0], lon: r.latlngs.at(-1)[1] },
      vehicleKey: 'sev',
      vehicle: state.vehicle,
      vehicleName: `${state.vehicle.name} (${state.vehicle.sub})`,
      objective: r.objectives[0],
      labels: r.labels,
      stats: {
        distance_m: r.distance_m, hours: r.hours, energy_wh: r.energy_wh, ascent_m: r.ascent_m,
        descent_m: r.descent_m, max_slope_deg: r.max_slope_deg, steep_m: r.steep_m,
      },
      latlngs: r.latlngs, dist: r.cumDist, hours: r.cumHours, elev: r.elevs, slope: r.slopes,
    };
  }
  function notify() {
    const plan = currentPlan();
    savePlan(plan);
    onRouteChange?.(plan);
  }

  // ---------- Interfaz ----------
  function setStatus(text, cls = '') {
    const el = $('plan-status');
    if (el.textContent === text && el.classList.contains(cls || 'plan-status')) return;
    el.textContent = text;
    el.className = `plan-status ${cls}`;
    void el.offsetWidth; // reinicia la animación de entrada
    el.classList.add('flash');
  }

  // Altura y pendiente del terreno en un punto (DTM de 20 m; pendiente con diferencias a ±20 m)
  function terrainInfo(ll) {
    const lat = ll.lat;
    const lon = ll.lng;
    const h = dem.at(lon, lat);
    const dLon = 20 / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
    const dLat = 20 / M_PER_DEG;
    const gx = (dem.at(lon + dLon, lat) - dem.at(lon - dLon, lat)) / 40;
    const gy = (dem.at(lon, lat + dLat) - dem.at(lon, lat - dLat)) / 40;
    const slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    return { h, slope: Number.isFinite(slope) ? slope : 0 };
  }

  // Trayecto: A y B como dos tarjetas unidas por una línea (como en un navegador), el siguiente punto a
  // marcar parpadea, un clic en un punto centra el mapa y el botón redondo intercambia A y B.
  function renderPoints() {
    const next = !state.origin ? 'origin' : !state.dest ? 'dest' : null;
    const row = (kind, letter, label) => {
      const p = state[kind];
      if (!p) {
        return `<div class="trip-row empty ${next === kind ? 'next' : ''}">
          <span class="trip-dot ${kind}"><b>${letter}</b></span>
          <div class="trip-main"><span class="trip-label">${label}</span>
            <span class="trip-name">${next === kind ? 'Click the map' : 'After the origin'}</span></div></div>`;
      }
      const t = terrainInfo(p.ll);
      const cls = tiltClass(t.slope);
      const over = t.slope > state.vehicle.maxSlope;
      return `<div class="trip-row set" data-focus="${kind}" title="Center map on ${label.toLowerCase()}">
        <span class="trip-dot ${kind}"><b>${letter}</b></span>
        <div class="trip-main"><span class="trip-label">${label}</span>
          <span class="trip-name mono">${latLon({ lat: p.ll.lat, lon: p.ll.lng })}</span>
          <span class="trip-meta"><span>${fmt.m(t.h)}</span><span class="trip-slope ${cls}">${num(t.slope, 1)}°${over ? ' · over limit' : ''}</span></span></div>
        <button class="trip-x" type="button" data-clear="${kind}" aria-label="Remove ${label.toLowerCase()}" title="Remove">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5"/></svg></button>
      </div>`;
    };
    let summary = '';
    if (state.origin && state.dest) {
      const a = state.origin.ll;
      const b = state.dest.ll;
      const cos = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
      const d = Math.hypot((b.lng - a.lng) * cos, b.lat - a.lat) * M_PER_DEG;
      const dh = terrainInfo(b).h - terrainInfo(a).h;
      summary = `<div class="trip-summary"><span><b>${fmt.km(d)}</b> straight line</span>
        <span><b>${dh >= 0 ? '+' : '−'}${num(Math.abs(dh))} m</b> elevation change</span></div>`;
    }
    const canSwap = state.origin && state.dest;
    $('plan-points').innerHTML = `<div class="trip">
        <div class="trip-rows">${row('origin', 'A', 'Origin')}<span class="trip-link" aria-hidden="true"></span>${row('dest', 'B', 'Destination')}</div>
        <button class="trip-swap" type="button" data-swap ${canSwap ? '' : 'disabled'} aria-label="Swap origin and destination" title="Swap A and B">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2v11M2.5 10.5 5 13l2.5-2.5M11 14V3M8.5 5.5 11 3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>${summary}`;
    onPoints?.({ origin: !!state.origin, dest: !!state.dest });
  }

  function warningsFor(r) {
    const v = state.vehicle;
    const w = [];
    if (v.maxHours && r.hours > v.maxHours) w.push(`Exceeds endurance (${num(v.maxHours)} h)`);
    if (v.battery_kWh && r.energy_wh / 1000 > v.battery_kWh) w.push(`Exceeds battery (${num(v.battery_kWh, 1)} kWh)`);
    if (r.max_slope_deg > v.maxSlope) w.push('Origin or destination on a slope above the limit');
    return w;
  }

  function sparkline(profile) {
    const W = 260;
    const H = 44;
    const maxD = profile.at(-1)[0] || 1;
    const hs = profile.map((p) => p[1]);
    const lo = Math.min(...hs);
    const hi = Math.max(...hs);
    const y = (h) => H - 3 - ((h - lo) / (hi - lo || 1)) * (H - 8);
    const line = profile.map(([d, h], k) => `${k ? 'L' : 'M'}${((d / maxD) * W).toFixed(1)},${y(h).toFixed(1)}`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${line}L${W},${H}L0,${H}Z" fill="rgba(78,161,255,0.16)"/><path d="${line}" fill="none" stroke="#4ea1ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <div class="spark-labels mono"><span>${fmt.m(lo)}</span><span>${fmt.m(hi)}</span></div>`;
  }

  function renderResults({ fresh = false } = {}) {
    const box = $('plan-results');
    box.classList.remove('pending');
    box.classList.toggle('fresh', fresh);
    const routes = state.shown ?? [];
    const v = state.vehicle;
    if (!routes.length) {
      const why = state.routes.length ? `No drivable route with a maximum slope of ${num(v.maxSlope)}°. Try other points.` : '';
      box.innerHTML = why ? `<p class="plan-empty">${why}</p>` : '';
      if (why) setStatus('No route possible', 'bad');
      $('plan-routes-sec').hidden = !why;
      return;
    }
    $('plan-routes-sec').hidden = false;
    const moved = [];
    if (state.snap?.startMoved_m > 0) moved.push(`A moved ${fmt.m(state.snap.startMoved_m)}`);
    if (state.snap?.goalMoved_m > 0) moved.push(`B moved ${fmt.m(state.snap.goalMoved_m)}`);
    setStatus(moved.length
      ? `${moved.join(' and ')} to the nearest reachable point: the marked point is on a slope steeper than ${num(v.maxSlope)}° or cut off by them (dashed line).`
      : `${routes.length} ${routes.length === 1 ? 'route' : 'routes'} · calculated in ${num(state.ms)} ms`, moved.length ? 'warn' : 'ok');
    const actions = `<div class="plan-actions">
      <button class="btn primary drive-btn" type="button" data-act="drive" title="Fly to the chase view behind the rover and start the route">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M2 7.2h4.4M9.6 7.2H14M8 9.6V14" stroke="currentColor" stroke-width="1.6"/></svg>Drive</button>
      <button class="btn" type="button" data-act="play">
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>Play</button>
      <a class="btn" href="3d.html#plan">View in 3D</a></div>`;
    box.innerHTML = actions + routes.map((r, k) => {
      const warn = warningsFor(r);
      const sel = k === state.selected;
      return `<button class="route-card ${sel ? 'sel' : ''}" data-route="${k}" aria-pressed="${sel}" style="--i:${k}">
        <div class="rc-head"><span class="rc-name">${r.labels.join(' · ')}</span>
          <span class="rc-time">${formatHours(r.hours)}</span></div>
        <div class="rc-meta mono">${fmt.km(r.distance_m)} · +${num(r.ascent_m)} m / −${num(r.descent_m)} m · max ${num(r.max_slope_deg, 1)}°</div>
        ${sel ? `<div class="rc-detail">
          ${sparkline(r.profile)}
          <dl class="rc-kv">
            <div><dt>Stretch &gt; 8°</dt><dd>${fmt.km(r.steep_m)}</dd></div>
            <div><dt>Rough terrain</dt><dd>${fmt.km(r.rough_m)}</dd></div>
            <div><dt>${v.battery_kWh ? 'Energy' : 'Mechanical work'}</dt><dd>${num(r.energy_wh / 1000, 2)} kWh</dd></div>
            ${v.battery_kWh ? `<div><dt>Battery used</dt><dd>${num((100 * r.energy_wh) / 1000 / v.battery_kWh)}%</dd></div>` : ''}
          </dl></div>` : ''}
        ${warn.map((t) => `<div class="rc-warn">${t}</div>`).join('')}
      </button>`;
    }).join('');
  }

  $('plan-points').addEventListener('click', (e) => {
    if (e.target.closest('[data-swap]')) { swapPoints(); return; }
    const kind = e.target.closest('[data-clear]')?.dataset.clear;
    if (!kind) {
      const f = e.target.closest('[data-focus]')?.dataset.focus;
      if (f && state[f]) map.flyTo(state[f].ll, Math.max(map.getZoom(), 14), { duration: 0.9 });
      return;
    }
    state[kind] = null;
    markers[kind]?.remove();
    markers[kind] = null;
    state.routes = [];
    state.shown = [];
    routeGroup.clearLayers();
    renderPoints();
    renderResults();
    notify();
    setStatus(kind === 'origin' ? 'Click the map to set the origin (A).' : 'Click the map to set the destination (B).');
  });
  $('plan-results').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="play"]')) { onPlay?.(); return; }
    if (e.target.closest('[data-act="drive"]')) { onDrive?.(); return; }
    const k = e.target.closest('[data-route]')?.dataset.route;
    if (k !== undefined) selectRoute(Number(k));
  });
  function swapPoints() {
    if (!state.origin || !state.dest) return;
    state.userEdit = true;
    const o = state.origin.ll;
    const d = state.dest.ll;
    state.origin = null;
    state.dest = null;
    setPoint('origin', d);
    setPoint('dest', o);
  }

  renderPoints();
  setStatus('Click the map to set the origin (A).');
  $('plan-routes-sec').hidden = true;

  return {
    setActive(on) {
      state.active = on;
      map.getContainer().classList.toggle('planning', on);
      if (on) { layer.addTo(map); extent.addTo(map); } else { extent.remove(); }
    },
    current: currentPlan,
    // Recupera una ruta (la guardada al volver del 3D, o la de por defecto): mismos puntos y objetivo.
    restore(plan, { fit = true } = {}) {
      if (!plan?.origin || !plan?.dest) return;
      state.userEdit = false;
      state.wantObjective = plan.objective;
      state.origin = null;
      state.dest = null;
      setPoint('origin', L.latLng(plan.origin.lat, plan.origin.lon));
      setPoint('dest', L.latLng(plan.dest.lat, plan.dest.lon));
      if (fit && plan.latlngs?.length) map.fitBounds(L.latLngBounds(plan.latlngs), FIT_PAD());
    },
    // Para la presentación: borrar, poner puntos, elegir alternativa y esperar al cálculo
    clear() {
      state.reqId += 1; // descarta un cálculo en curso
      ['origin', 'dest'].forEach((kind) => { state[kind] = null; markers[kind]?.remove(); markers[kind] = null; });
      state.routes = [];
      state.shown = [];
      routeGroup.clearLayers();
      renderPoints();
      renderResults();
      notify();
      setStatus('Click the map to set the origin (A).');
    },
    setPoint: (kind, lat, lon) => setPoint(kind, L.latLng(lat, lon)),
    selectRoute,
    get routes() { return state.shown ?? []; },
    get selected() { return state.selected; },
    nextResult: () => new Promise((resolve) => resultWaiters.push(resolve)),
  };
}
