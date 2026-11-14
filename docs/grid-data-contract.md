# Contrato de datos de la cuadrícula Jezero

El generador entrega `data/jezero/grid.json` como una lista JSON plana con un objeto por celda. `grid.example.json` ilustra el formato; no debe usarse para resultados.

## Formato acordado

Cada objeto identifica la celda en la cuadrícula y contiene sus límites geográficos, riesgo, transitabilidad y elevación:

```json
{
  "cell": 0,
  "row": 0,
  "col": 0,
  "lon_min": 137.352761,
  "lat_min": -4.826023,
  "lon_max": 137.356626,
  "lat_max": -4.816548,
  "risk": 0,
  "points": 0,
  "traversable": true,
  "elev_mean": null,
  "elev_min": null,
  "elev_max": null
}
```

El archivo contiene esos objetos dentro de un array `[...]`. `row` y `col` son índices enteros desde cero. Las dimensiones se deducen de los índices máximos. El generador debe incluir todas las posiciones de la cuadrícula, también las bloqueadas; si una posición no aparece, el planificador la tratará como bloqueada.

`traversable` determina si el rover puede entrar en la celda. Usa `false` para peligro infinito, riesgo no aceptable o una celda sin datos suficientes para decidir que es segura. JSON no admite `Infinity`. `risk` debe ser un número no negativo para las celdas transitables; puede ser `null` cuando el dato no está disponible. Si una celda es transitable y `risk` es `null`, A* usa por defecto una penalización cero, que se puede cambiar con `unknownRiskPenalty`.

`points` se conserva como dato de la celda, pero A* no lo usa todavía. Los campos de elevación aceptan números o `null`; tampoco afectan al coste actual de la ruta. El coste de riesgo es el promedio del riesgo de las dos celdas multiplicado por la distancia recorrida entre sus centros.

## A*

`loadGrid(url)` carga y valida el array. Se puede pasar directamente a `findPath({ grid, start, goal })`; inicio y destino tienen formato `{ row, col }`. Para el array nuevo, el objetivo por defecto es minimizar `risk`. El resultado contiene `path` y `objectiveCost`, o es `null` si no hay ruta.

A* permite movimientos cardinales y diagonales, y no permite cortar una esquina entre celdas bloqueadas. Para el objetivo más rápido, cada tramo tarda `distancia / roverSpeedMps`. A* calcula la distancia entre los centros geográficos de las celdas sobre una esfera marciana. `planRoutes` usa la velocidad del rover para devolver ruta segura, ruta más rápida y sus estimaciones de distancia y tiempo. La velocidad inicial del prototipo es 1 m/s (3,6 km/h), en `src/planner/config.js`; es un supuesto ajustable del proyecto, no una especificación del vehículo. No se repite en cada celda.

Con velocidad constante, la ruta más rápida coincide con la de menor distancia; cambiar la velocidad cambia la estimación de tiempo, pero no qué ruta es más corta. La ruta segura sí puede diferir porque su coste acumula riesgo a lo largo de la distancia.

El cargador también conserva compatibilidad con el contrato matricial anterior (`rows`, `cols`, `risk`, `timeSeconds`, `blocked` y `transform`) mientras se migra la aplicación.
