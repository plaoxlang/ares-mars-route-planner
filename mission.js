// Informe de misión: ¿se puede hacer esta ruta con este vehículo y volver para contarlo?
// Reúne lo que la app ya sabe de cada punto de la ruta (tiempo, pendiente, radiación estimada,
// frío nocturno relativo, energía) y da un veredicto GO / PRECAUCIÓN / NO-GO con sus motivos.
// Solo funciones puras y HTML: el cálculo de dosis y frío por punto lo pasa quien llama.
import { num, fmt, TILT } from './shared.js';

// Referencias para poner la dosis en contexto
export const DOSE_REF = {
  careerLimit_mSv: 600, // límite de carrera de NASA para astronautas (NASA-STD-3001, 2022)
  earthBackground_mSv_year: 2.4, // fondo natural medio en la Tierra (UNSCEAR)
};

/**
 * plan: ruta guardada por el planificador (latlngs, hours, slope, stats, vehicle…).
 * doseAt(lon, lat) → mSv/día estimados; coldAt(lon, lat) → 0–1, fracción de la zona más templada
 * que ese punto de noche (null si aún no hay datos de THEMIS).
 */
export function missionReport(plan, { doseAt, coldAt }) {
  const { latlngs, hours } = plan;
  const v = plan.vehicle;
  const s = plan.stats;
  const n = latlngs.length;
  // Dosis acumulada por tramo (tasa media de sus extremos × duración)
  const cumDose = new Float64Array(n);
  const rate = latlngs.map(([lat, lon]) => doseAt(lon, lat));
  for (let i = 1; i < n; i++) cumDose[i] = cumDose[i - 1] + ((rate[i - 1] + rate[i]) / 2) * ((hours[i] - hours[i - 1]) / 24);
  const dose = cumDose[n - 1];
  // Frío: parte del recorrido (en tiempo) por el 20 % más frío de la zona
  let coldShare = null;
  const coldVals = latlngs.map(([lat, lon]) => coldAt(lon, lat));
  if (coldVals.every((c) => c !== null)) {
    let t = 0;
    for (let i = 1; i < n; i++) if (coldVals[i] >= 0.8) t += hours[i] - hours[i - 1];
    coldShare = t / (hours[n - 1] || 1);
  }
  const steepShare = s.steep_m / (s.distance_m || 1);
  const hoursUse = v.maxHours ? s.hours / v.maxHours : null;
  const batteryUse = v.battery_kWh ? s.energy_wh / 1000 / v.battery_kWh : null;
  const slopeMargin = v.maxSlope - s.max_slope_deg;

  // Veredicto: cada comprobación aporta un nivel (0 ok, 1 precaución, 2 no-go) y un motivo
  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  if (hoursUse !== null) {
    if (hoursUse > 1) add(2, `Takes ${fmtH(s.hours)} and the endurance is ${num(v.maxHours)} h`);
    else if (hoursUse > 0.75) add(1, `Uses ${num(hoursUse * 100)}% of the endurance: little margin to get back`);
    else add(0, `Uses ${num(hoursUse * 100)}% of the endurance`);
  }
  if (batteryUse !== null) {
    if (batteryUse > 1) add(2, `Needs ${num(batteryUse * 100)}% of the battery`);
    else if (batteryUse > 0.75) add(1, `Uses ${num(batteryUse * 100)}% of the battery`);
    else add(0, `Uses ${num(batteryUse * 100)}% of the battery`);
  }
  if (slopeMargin < 0) add(2, `Max slope of ${num(s.max_slope_deg, 1)}°, above the vehicle limit (${num(v.maxSlope)}°)`);
  else if (slopeMargin < 2 || s.max_slope_deg >= TILT.bad) add(1, `Max slope of ${num(s.max_slope_deg, 1)}° (limit ${num(v.maxSlope)}°)`);
  else add(0, `Max slope of ${num(s.max_slope_deg, 1)}°, within the limit (${num(v.maxSlope)}°)`);
  if (steepShare > 0.3) add(1, `${num(steepShare * 100)}% of the route is on slopes steeper than ${TILT.warn}°`);
  if (coldShare !== null) {
    if (coldShare > 0.3) add(1, `${num(coldShare * 100)}% of the time is spent in the coldest areas at night: avoid being caught there after dark`);
    else add(0, `Only ${num(coldShare * 100)}% of the time is spent in the coldest areas at night`);
  }
  add(0, `Estimated dose of ${num(dose, 2)} mSv: ${num((dose / DOSE_REF.careerLimit_mSv) * 100, 2)}% of NASA's career limit`);
  const level = Math.max(...checks.map((c) => c.level));
  checks.sort((a, b) => b.level - a.level);

  return {
    level,
    verdict: ['GO', 'CAUTION', 'NO-GO'][level],
    checks,
    dose,
    cumDose,
    earthDays: dose / (DOSE_REF.earthBackground_mSv_year / 365),
    coldShare,
    steepShare,
    hoursUse,
    batteryUse,
  };
}

const fmtH = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`);
const LEVEL_CLS = ['go', 'caution', 'nogo'];
const LEVEL_ICON = ['●', '▲', '■'];

// Tarjeta del informe (panel lateral)
export function reportHTML(plan, r) {
  const s = plan.stats;
  return `
    <div class="mission mission-${LEVEL_CLS[r.level]}">
      <div class="mission-head">
        <span class="mission-kicker">Mission report</span>
        <span class="mission-verdict">${r.verdict}</span>
      </div>
      <div class="mission-grid">
        <div title="${plan.vehicle.maxHours ? `of ${num(plan.vehicle.maxHours)} h endurance` : 'traverse time'}"><b>${fmtH(s.hours)}</b><span>${plan.vehicle.maxHours ? `of ${num(plan.vehicle.maxHours)} h` : 'traverse'}</span></div>
        <div title="Estimated dose: ${num(r.earthDays)} days of natural background radiation on Earth"><b>${num(r.dose, 2)}</b><span>mSv</span></div>
        <div title="+${num(s.ascent_m)} / −${num(s.descent_m)} m"><b>${fmt.km(s.distance_m)}</b><span>+${num(s.ascent_m)} m</span></div>
        <div><b>${r.batteryUse !== null ? `${num(r.batteryUse * 100)}%` : `${num(s.max_slope_deg, 1)}°`}</b><span>${r.batteryUse !== null ? 'battery' : 'max slope'}</span></div>
      </div>
      ${checksHTML(r)}
    </div>`;
}

// Avisos primero; lo que está en orden se pliega para que el informe quepa sin desplazarse
function checksHTML(r) {
  const li = (c) => `<li class="lv-${LEVEL_CLS[c.level]}"><i>${LEVEL_ICON[c.level]}</i>${c.text}</li>`;
  const warn = r.checks.filter((c) => c.level > 0);
  const ok = r.checks.filter((c) => c.level === 0);
  return `${warn.length ? `<ul class="mission-checks">${warn.map(li).join('')}</ul>` : ''}
    ${ok.length ? `<details class="mission-more"><summary>${ok.length} ${ok.length === 1 ? 'check' : 'checks'} OK</summary>
      <ul class="mission-checks">${ok.map(li).join('')}</ul></details>` : ''}`;
}

// Parte de llegada al terminar la reproducción
export function arrivalHTML(plan, r) {
  const s = plan.stats;
  return `
    <div class="arrival mission-${LEVEL_CLS[r.level]}" role="dialog" aria-label="Arrival at destination">
      <span class="mission-kicker">Destination reached · ${plan.vehicleName}</span>
      <h2>${r.level === 2 ? 'Mission out of limits' : r.level === 1 ? 'Arrived with little margin' : 'Mission complete'}</h2>
      <div class="arrival-stats">
        <div><b>${fmtH(s.hours)}</b><span>time</span></div>
        <div><b>${fmt.km(s.distance_m)}</b><span>distance</span></div>
        <div><b>${num(r.dose, 2)}</b><span>mSv received</span></div>
        <div><b>${num(s.max_slope_deg, 1)}°</b><span>max slope</span></div>
      </div>
      <p>${r.checks[0].text}.</p>
      <button class="btn primary" type="button" data-arrival-close>Keep exploring</button>
    </div>`;
}
