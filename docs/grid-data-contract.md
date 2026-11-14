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

## Rejilla real de Jezero

`data/jezero/grid.json` ya existe y sigue este contrato. La genera `node scripts/jezero/build-grid.mjs` desde el DTM CTX de 20 m: 48 × 97 = 4656 celdas de 200 m (10 × 10 píxeles del DTM).

- `risk` (1–5, la misma escala que `mars_grid.py`) sale de la pendiente media de la celda: < 2° → 1, < 5° → 2, < 8° → 3, < 15° → 4, resto → 5. `mars_grid.py` usa el rango de alturas de los puntos de la ruta que caen en la celda. Con el DTM completo se usa la pendiente, porque el rango crece con el tamaño de la celda y la pendiente no.
- `traversable` es `false` si el 90 % más llano de la celda supera 25°, el límite del rover más capaz. Salen 86 celdas no transitables.
- `points` es el número de píxeles del DTM con dato en la celda. `elev_*` salen de esos píxeles.
- La fila 0 está al sur, como en `mars_grid.py`.

`risk_grid.json` y `time_grid.json` (salida de `mars_grid.py`) son de **Gale** (Curiosity, lon 137,35–137,45, lat −4,83 a −4,59). Están en `data/gale/processed_data/`.

## Motor común y aplicación

`src/planner/a-star.js` es el único A* del proyecto. Lo usan el mapa, la vista 3D (a través de `planner-worker.js`) y los scripts. Conserva este contrato y añade:

- **Entrada tal como la genera `mars_grid.py`:** `{ meta, grid: [...] }`, sin `traversable`. En ese caso una celda con `risk` 0 («sin datos») cuenta como no transitable.
- **Rejilla densa con costes propios:** `findPath({ grid: { rows, cols, blocked, cellWidth, cellHeight }, start, goal, edgeCost, heuristic })`.
  - `edgeCost(i, j, metros)` permite costes con sentido (subir no cuesta lo mismo que bajar).
  - El planificador de la app la usa sobre el DTM completo de 20 m (unas 460 000 celdas), con el modelo de cada vehículo (pendiente máxima, Tobler, rugosidad, energía).
- **`cornerCutting`** (por defecto `false`, como en este contrato). El planificador de la app lo activa: en el DTM las celdas bloqueadas salen de umbralizar una pendiente suavizada, no son obstáculos puntuales.
- **Rendimiento:** arrays tipados e índices enteros, memoria reutilizada entre búsquedas (sin reinicializar) y el resultado con `indices` (Int32Array) y `expanded`.

Con matriz y lista de celdas devuelve el mismo coste óptimo que la versión original. Se comprobó en 240 casos: rejillas aleatorias de los dos formatos, los dos objetivos y los datos de `mars_grid.py`.
