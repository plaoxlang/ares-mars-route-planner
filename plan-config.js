// Configuración del planificador común al navegador (planner.js) y a los scripts (build-default-plan.mjs).
// Solo datos: se puede importar desde Node.

// Vehículo de la misión: rover presurizado tipo SEV (Space Exploration Vehicle) de NASA.
// Cifras de partida supuestas para el reto (no son especificaciones oficiales).
export const VEHICLE = {
  name: 'Pressurized rover', sub: 'NASA SEV-type', model: 'rover',
  vFlat: 8, maxSlope: 18, maxHours: 72, battery_kWh: 60, mass: 3000, crr: 0.08, eff: 0.75, roughRef: 2,
};

// Alternativas que se calculan siempre, en este orden
export const OBJECTIVES = [
  { key: 'fast', label: 'Fastest' },
  { key: 'safe', label: 'Safest' },
  { key: 'energy', label: 'Least energy' },
];

// Ruta por defecto (y la que traza la presentación): de lo alto del delta del antiguo río a lo alto del
// borde oeste del cráter. ~5,7 km y +620 m de subida: se ven bien la pendiente, las alternativas y el informe.
export const DEFAULT_POINTS = {
  origin: { lat: 18.4954, lon: 77.34665, name: 'Jezero delta' },
  dest: { lat: 18.46055, lon: 77.26475, name: 'Crater rim' },
};
