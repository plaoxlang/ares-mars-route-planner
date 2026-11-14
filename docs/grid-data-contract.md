# Contrato de datos de la cuadrícula Jezero

Héctor entrega un archivo `data/jezero/grid.json`. `grid.example.json` solo ilustra el formato; no debe usarse para resultados.

## Sistema de coordenadas

Usar `IAU_2000:104905` (equirectangular de Marte) con coordenadas y tamaños de celda en metros. El punto de origen del transform es la esquina superior izquierda de la celda [0,0]. `pixelWidth` debe ser positivo hacia el este y `pixelHeight` negativo hacia el sur. La aplicación transforma el centro de cada celda a latitud/longitud para dibujarlo sobre Leaflet.

## Campos requeridos

- `region`: Jezero y límites del área analizada.
- `crs`: exactamente `IAU_2000:104905`.
- `rows`, `cols`: número de filas y columnas.
- `transform`: `originX`, `originY`, `pixelWidth`, `pixelHeight` (metros).
- `risk`: matriz rectangular de números de 1 a 10 para celdas transitables.
- `timeSeconds`: matriz rectangular con segundos estimados por celda.
- `blocked`: matriz rectangular de booleanos compartida por los dos objetivos.
- `metadata` o `sources.json`: resolución, productos fuente, URLs, fecha, pasos de procesamiento, método de riesgo, criterio de bloqueo y fórmula de tiempo.

Las matrices deben tener `rows` × `cols`. En celdas bloqueadas usa `blocked: true` y `null` en ambas matrices de coste; JSON no admite `Infinity`. En el estado actual las diagonales no están permitidas. A* minimiza la suma de riesgo para la ruta segura y la suma de segundos para la ruta rápida; ambas evitan celdas bloqueadas. La arista entre celdas usa la media de los dos valores.

El riesgo es un índice definido por el equipo, no una probabilidad salvo que exista un método que lo justifique. No incluir celdas sin dato como si fueran seguras: marcarlas como bloqueadas o completar el área según una regla documentada.
