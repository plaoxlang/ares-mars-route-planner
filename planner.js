// Planificador de rutas tipo "Google Maps" en el mapa 2D: origen, destino, vehículo y alternativas.
// El cálculo (A* sobre el DTM) va en planner-worker.js para no bloquear la página.
import { $, num, fmt, latLon } from './shared.js';
import { savePlan, formatHours } from './route-player.js';

// Perfiles de partida. Son aproximaciones para el reto, editables en la interfaz:
// - LRV: Apollo Lunar Roving Vehicle (~13 km/h máx., ~700 kg cargado, baterías ~8,7 kWh).
// - SEV: concepto de rover presurizado de NASA (Space Exploration Vehicle); cifras supuestas.
// - Rover robótico: del orden de Perseverance (~0,15 km/h máx.).
export const VEHICLES = {
  walk: {
    name: 'Astronauta a pie', sub: 'con traje', model: 'tobler',
    vFlat: 3, maxSlope: 18, maxHours: 8, battery_kWh: null, mass: 230, crr: 0.25, eff: 0.25, roughRef: 1.5,
    energyLabel: 'Menos esfuerzo',
  },
  lrv: {
    name: 'Rover no presurizado', sub: 'tipo Apollo LRV', model: 'rover',
    vFlat: 10, maxSlope: 22, maxHours: 8, battery_kWh: 8.7, mass: 700, crr: 0.1, eff: 0.75, roughRef: 2.5,
    energyLabel: 'Menos energía',
  },
  sev: {
    name: 'Rover presurizado', sub: 'tipo SEV de NASA', model: 'rover',
    vFlat: 8, maxSlope: 18, maxHours: 72, battery_kWh: 60, mass: 3000, crr: 0.08, eff: 0.75, roughRef: 2,
    energyLabel: 'Menos energía',
  },
  robot: {
    name: 'Rover robótico', sub: 'tipo Perseverance', model: 'rover',
    vFlat: 0.12, maxSlope: 25, maxHours: null, battery_kWh: null, mass: 1025, crr: 0.15, eff: 0.5, roughRef: 1,
    energyLabel: 'Menos energía',
  },
};

const OBJECTIVES = [
  { key: 'fast', label: 'Más rápida' },
  { key: 'safe', label: 'Más segura' },
  { key: 'energy', label: null }, // depende del vehículo
];

const SPEC_FIELDS = [
  { key: 'vFlat', label: 'Velocidad en llano', unit: 'km/h', step: 0.1 },
  { key: 'maxSlope', label: 'Pendiente máxima', unit: '°', step: 1 },
  { key: 'maxHours', label: 'Autonomía', unit: 'h', step: 1 },
  { key: 'battery_kWh', label: 'Batería', unit: 'kWh', step: 0.1 },
  { key: 'mass', label: 'Masa con carga', unit: 'kg', step: 10 },
];

export function setupPlanner({ L, map, dem, pts, getStopIndex, onRouteChange, onPlay }) {
  const state = {
    active: false,
    vehicleKey: 'walk',
    vehicle: { ...VEHICLES.walk },
    origin: null,
    dest: null,
    routes: [],
    selected: 0,
    reqId: 0,
    ready: false,
  };

  // ---------- Worker ----------
  const worker = new Worker('planner-worker.js');
  const heights = dem.heights.slice();
  worker.postMessage({ type: 'init', heights, width: dem.width, height: dem.height, pxX: dem.pxX, pxY: dem.pxY }, [heights.buffer]);
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { state.ready = true; if (state.origin && state.dest) compute(); return; }
    if (m.id !== state.reqId) return; // respuesta antigua
    if (m.type === 'error') { setStatus(`Error al calcular: ${m.message}`, 'bad'); return; }
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
    state.shown = uniqueRoutes();
    const want = state.wantObjective ?? state.lastObjective;
    state.selected = Math.max(0, state.shown.findIndex((r) => r.objectives.includes(want)));
    state.wantObjective = null;
    drawRoutes();
    renderResults();
    notify();
  };

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
        .on('dragend', (e) => setPoint(kind, e.target.getLatLng(), { keepMarker: true }))
        .addTo(layer);
    } else {
      markers[kind].setLatLng(ll);
    }
  }

  function setPoint(kind, ll, { keepMarker = false } = {}) {
    const cell = toCell(ll);
    if (!cell) {
      setStatus('Ese punto queda fuera de la zona con relieve (recuadro discontinuo).', 'warn');
      if (keepMarker && state[kind]) markers[kind].setLatLng(state[kind].ll);
      return;
    }
    state[kind] = { ll: L.latLng(ll), cell };
    placeMarker(kind, ll);
    renderPoints();
    if (state.origin && state.dest) compute();
    else setStatus('Ahora pulsa en el mapa el destino (B).');
  }

  map.on('click', (e) => {
    if (!state.active) return;
    if (!state.origin) setPoint('origin', e.latlng);
    else if (!state.dest) setPoint('dest', e.latlng);
    else setPoint('dest', e.latlng); // con los dos puestos, un clic mueve el destino
  });

  // ---------- Cálculo ----------
  function compute() {
    if (!state.origin || !state.dest) return;
    if (!state.ready) { setStatus('Preparando el terreno…'); return; }
    state.reqId += 1;
    setStatus('Calculando rutas…', 'busy');
    $('plan-results').classList.add('pending');
    worker.postMessage({
      type: 'plan',
      id: state.reqId,
      start: state.origin.cell,
      goal: state.dest.cell,
      vehicle: state.vehicle,
      objectives: OBJECTIVES.map((o) => o.key),
    });
  }

  function objectiveLabel(key) {
    return OBJECTIVES.find((o) => o.key === key).label ?? state.vehicle.energyLabel;
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

  function drawRoutes() {
    routeGroup.clearLayers();
    const routes = state.shown ?? [];
    if (state.selected >= routes.length) state.selected = 0;
    // Primero las alternativas (gris), luego la seleccionada encima (azul), como en Google Maps.
    const order = routes.map((_, k) => k).sort((a, b) => (a === state.selected) - (b === state.selected));
    for (const k of order) {
      const latlngs = Array.from(routes[k].cells, toLatLng);
      const sel = k === state.selected;
      L.polyline(latlngs, { color: '#0b1a2b', weight: sel ? 9 : 7, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeGroup);
      L.polyline(latlngs, {
        color: sel ? '#4ea1ff' : '#b8c0ca', weight: sel ? 5 : 4, opacity: sel ? 1 : 0.85, lineCap: 'round', lineJoin: 'round',
      })
        .on('click', (e) => { L.DomEvent.stop(e); selectRoute(k); })
        .bindTooltip(`${routes[k].labels.join(' · ')} · ${formatHours(routes[k].hours)} · ${fmt.km(routes[k].distance_m)}`, { sticky: true })
        .addTo(routeGroup);
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
      origin: { lat: state.origin.ll.lat, lon: state.origin.ll.lng },
      dest: { lat: state.dest.ll.lat, lon: state.dest.ll.lng },
      vehicleKey: state.vehicleKey,
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
    el.textContent = text;
    el.className = `plan-status ${cls}`;
  }

  function renderPoints() {
    const row = (kind, letter) => {
      const p = state[kind];
      return `<div class="plan-point"><span class="pin-badge ${kind}">${letter}</span>
        <span class="mono">${p ? latLon({ lat: p.ll.lat, lon: p.ll.lng }) : '<span class="dim">pulsa en el mapa</span>'}</span>
        ${p ? `<button class="link-x" data-clear="${kind}" aria-label="Quitar">×</button>` : ''}</div>`;
    };
    $('plan-points').innerHTML = row('origin', 'A') + row('dest', 'B');
  }

  function warningsFor(r) {
    const v = state.vehicle;
    const w = [];
    if (v.maxHours && r.hours > v.maxHours) w.push(`Supera la autonomía (${num(v.maxHours)} h)`);
    if (v.battery_kWh && r.energy_wh / 1000 > v.battery_kWh) w.push(`Supera la batería (${num(v.battery_kWh, 1)} kWh)`);
    if (r.max_slope_deg > v.maxSlope) w.push('Origen o destino en pendiente por encima del límite');
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

  function renderResults() {
    const box = $('plan-results');
    box.classList.remove('pending');
    const routes = state.shown ?? [];
    const v = state.vehicle;
    if (!routes.length) {
      const why = state.routes.length ? `No hay ruta transitable con una pendiente máxima de ${num(v.maxSlope)}°. Prueba otro vehículo o sube la pendiente máxima.` : '';
      box.innerHTML = why ? `<p class="plan-empty">${why}</p>` : '';
      if (why) setStatus('Sin ruta posible', 'bad');
      return;
    }
    setStatus(`${routes.length} ${routes.length === 1 ? 'ruta' : 'rutas'} · calculadas en ${num(state.ms)} ms`, 'ok');
    const actions = `<div class="plan-actions">
      <button class="btn primary" type="button" data-act="play">
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8v10.4L12 7z" fill="currentColor"/></svg>Reproducir</button>
      <a class="btn" href="3d.html#plan">Ver en 3D</a></div>`;
    box.innerHTML = actions + routes.map((r, k) => {
      const warn = warningsFor(r);
      const sel = k === state.selected;
      return `<button class="route-card ${sel ? 'sel' : ''}" data-route="${k}" aria-pressed="${sel}">
        <div class="rc-head"><span class="rc-name">${r.labels.join(' · ')}</span>
          <span class="rc-time">${formatHours(r.hours)}</span></div>
        <div class="rc-meta mono">${fmt.km(r.distance_m)} · +${num(r.ascent_m)} m / −${num(r.descent_m)} m · máx ${num(r.max_slope_deg, 1)}°</div>
        ${sel ? `<div class="rc-detail">
          ${sparkline(r.profile)}
          <dl class="rc-kv">
            <div><dt>Tramo &gt; 8°</dt><dd>${fmt.km(r.steep_m)}</dd></div>
            <div><dt>Terreno irregular</dt><dd>${fmt.km(r.rough_m)}</dd></div>
            <div><dt>${v.battery_kWh ? 'Energía' : 'Trabajo mecánico'}</dt><dd>${num(r.energy_wh / 1000, 2)} kWh</dd></div>
            ${v.battery_kWh ? `<div><dt>Batería usada</dt><dd>${num((100 * r.energy_wh) / 1000 / v.battery_kWh)} %</dd></div>` : ''}
          </dl></div>` : ''}
        ${warn.map((t) => `<div class="rc-warn">${t}</div>`).join('')}
      </button>`;
    }).join('');
  }

  function renderVehicles() {
    $('plan-vehicles').innerHTML = Object.entries(VEHICLES).map(([k, v]) => `
      <label class="vehicle"><input type="radio" name="vehicle" value="${k}" ${k === state.vehicleKey ? 'checked' : ''}>
        <span class="name">${v.name}</span><span class="meta">${v.sub}</span></label>`).join('');
    renderSpecs();
  }

  function renderSpecs() {
    const v = state.vehicle;
    $('plan-specs').innerHTML = SPEC_FIELDS.filter((f) => v[f.key] !== null && v[f.key] !== undefined).map((f) => `
      <label class="spec"><span>${f.label}</span>
        <span><input class="num" type="number" min="0" step="${f.step}" data-spec="${f.key}" value="${v[f.key]}"> ${f.unit}</span></label>`).join('');
  }

  // Eventos
  $('plan-vehicles').addEventListener('change', (e) => {
    state.vehicleKey = e.target.value;
    state.vehicle = { ...VEHICLES[state.vehicleKey] };
    renderSpecs();
    compute();
  });
  $('plan-specs').addEventListener('change', (e) => {
    const key = e.target.dataset.spec;
    const val = e.target.valueAsNumber;
    if (!key || !Number.isFinite(val) || val <= 0) return;
    state.vehicle[key] = val;
    compute();
  });
  $('plan-points').addEventListener('click', (e) => {
    const kind = e.target.closest('[data-clear]')?.dataset.clear;
    if (!kind) return;
    state[kind] = null;
    markers[kind]?.remove();
    markers[kind] = null;
    state.routes = [];
    state.shown = [];
    routeGroup.clearLayers();
    renderPoints();
    renderResults();
    notify();
    setStatus(kind === 'origin' ? 'Pulsa en el mapa el origen (A).' : 'Pulsa en el mapa el destino (B).');
  });
  $('plan-results').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="play"]')) { onPlay?.(); return; }
    const k = e.target.closest('[data-route]')?.dataset.route;
    if (k !== undefined) selectRoute(Number(k));
  });
  $('plan-from-rover').addEventListener('click', () => {
    const p = pts[getStopIndex()];
    setPoint('origin', L.latLng(p.lat, p.lon));
  });
  $('plan-swap').addEventListener('click', () => {
    if (!state.origin || !state.dest) return;
    const o = state.origin.ll;
    const d = state.dest.ll;
    state.origin = null;
    state.dest = null;
    setPoint('origin', d);
    setPoint('dest', o);
  });

  renderVehicles();
  renderPoints();
  setStatus('Pulsa en el mapa el origen (A).');

  return {
    setActive(on) {
      state.active = on;
      map.getContainer().classList.toggle('planning', on);
      if (on) { layer.addTo(map); extent.addTo(map); } else { extent.remove(); }
    },
    current: currentPlan,
    // Recupera una ruta guardada (al volver desde la vista 3D): mismos puntos, vehículo y objetivo.
    restore(plan) {
      if (!plan?.origin || !plan?.dest) return;
      state.vehicleKey = VEHICLES[plan.vehicleKey] ? plan.vehicleKey : 'walk';
      state.vehicle = { ...VEHICLES[state.vehicleKey], ...plan.vehicle };
      state.wantObjective = plan.objective;
      renderVehicles();
      state.origin = null;
      state.dest = null;
      setPoint('origin', L.latLng(plan.origin.lat, plan.origin.lon));
      setPoint('dest', L.latLng(plan.dest.lat, plan.dest.lon));
      map.fitBounds(L.latLngBounds(plan.latlngs), { paddingTopLeft: [300, 40], paddingBottomRight: [360, 40] });
    },
  };
}
