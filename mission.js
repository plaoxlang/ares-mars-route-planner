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
    if (hoursUse > 1) add(2, `Dura ${fmtH(s.hours)} y la autonomía es de ${num(v.maxHours)} h`);
    else if (hoursUse > 0.75) add(1, `Usa el ${num(hoursUse * 100)} % de la autonomía: poco margen para volver`);
    else add(0, `Usa el ${num(hoursUse * 100)} % de la autonomía`);
  }
  if (batteryUse !== null) {
    if (batteryUse > 1) add(2, `Necesita el ${num(batteryUse * 100)} % de la batería`);
    else if (batteryUse > 0.75) add(1, `Gasta el ${num(batteryUse * 100)} % de la batería`);
    else add(0, `Gasta el ${num(batteryUse * 100)} % de la batería`);
  }
  if (slopeMargin < 0) add(2, `Pendiente máxima de ${num(s.max_slope_deg, 1)}°, por encima del límite del vehículo (${num(v.maxSlope)}°)`);
  else if (slopeMargin < 2 || s.max_slope_deg >= TILT.bad) add(1, `Pendiente máxima de ${num(s.max_slope_deg, 1)}° (límite ${num(v.maxSlope)}°)`);
  else add(0, `Pendiente máxima de ${num(s.max_slope_deg, 1)}°, dentro del límite (${num(v.maxSlope)}°)`);
  if (steepShare > 0.3) add(1, `El ${num(steepShare * 100)} % del camino va por pendientes de más de ${TILT.warn}°`);
  if (coldShare !== null) {
    if (coldShare > 0.3) add(1, `El ${num(coldShare * 100)} % del tiempo pasa por las zonas más frías de noche: no conviene que la noche le pille ahí`);
    else add(0, `Solo el ${num(coldShare * 100)} % del tiempo pasa por las zonas más frías de noche`);
  }
  add(0, `Dosis estimada de ${num(dose, 2)} mSv: el ${num((dose / DOSE_REF.careerLimit_mSv) * 100, 2)} % del límite de carrera de NASA`);
  const level = Math.max(...checks.map((c) => c.level));
  checks.sort((a, b) => b.level - a.level);

  return {
    level,
    verdict: ['GO', 'PRECAUCIÓN', 'NO-GO'][level],
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
        <span class="mission-kicker">Informe de misión</span>
        <span class="mission-verdict">${r.verdict}</span>
      </div>
      <div class="mission-grid">
        <div><b>${fmtH(s.hours)}</b><span>${plan.vehicle.maxHours ? `de ${num(plan.vehicle.maxHours)} h de autonomía` : 'de travesía'}</span></div>
        <div><b>${num(r.dose, 2)} mSv</b><span>dosis estimada · ${num(r.earthDays)} días de fondo terrestre</span></div>
        <div><b>${fmt.km(s.distance_m)}</b><span>+${num(s.ascent_m)} / −${num(s.descent_m)} m</span></div>
        <div><b>${r.batteryUse !== null ? `${num(r.batteryUse * 100)} %` : `${num(s.max_slope_deg, 1)}°`}</b><span>${r.batteryUse !== null ? 'de batería' : 'pendiente máxima'}</span></div>
      </div>
      <ul class="mission-checks">
        ${r.checks.map((c) => `<li class="lv-${LEVEL_CLS[c.level]}"><i>${LEVEL_ICON[c.level]}</i>${c.text}</li>`).join('')}
      </ul>
      <p class="mission-note">Radiación estimada (modelo RAD, sin tormentas solares). Frío relativo (THEMIS).</p>
    </div>`;
}

// Parte de llegada al terminar la reproducción
export function arrivalHTML(plan, r) {
  const s = plan.stats;
  return `
    <div class="arrival mission-${LEVEL_CLS[r.level]}" role="dialog" aria-label="Llegada al destino">
      <span class="mission-kicker">Destino alcanzado · ${plan.vehicleName}</span>
      <h2>${r.level === 2 ? 'Misión fuera de límites' : r.level === 1 ? 'Llegada con poco margen' : 'Misión completada'}</h2>
      <div class="arrival-stats">
        <div><b>${fmtH(s.hours)}</b><span>tiempo</span></div>
        <div><b>${fmt.km(s.distance_m)}</b><span>recorrido</span></div>
        <div><b>${num(r.dose, 2)}</b><span>mSv recibidos</span></div>
        <div><b>${num(s.max_slope_deg, 1)}°</b><span>pendiente máx.</span></div>
      </div>
      <p>${r.checks[0].text}.</p>
      <button class="btn primary" type="button" data-arrival-close>Seguir explorando</button>
    </div>`;
}
