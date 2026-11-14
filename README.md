# ARES · Planificador de rutas en Jezero

Prototipo web para comparar rutas sobre una cuadrícula de terreno de Jezero. La aplicación activa usa un mapa Leaflet con mosaicos NASA Mars Trek y muestra localizaciones de Perseverance como contexto. El motor A* calcula una ruta de menor riesgo y otra de menor tiempo cuando el equipo añada la cuadrícula real.

## Ejecutar

Requiere Python 3 para servir los archivos locales:

```bash
python3 -m http.server 8010
```

Abre `http://localhost:8010`. Las teselas NASA requieren conexión a internet. Descarga las localizaciones de Perseverance una vez con:

```bash
node scripts/fetch-data.mjs
```

## Estado del proyecto

- **Mapa Jezero:** MOLA/Viking globales, CTX Jezero y HiRISE Jezero desde NASA Mars Trek.
- **Referencia de Perseverance:** waypoints NASA MMGIS; la polilínea une puntos de localización y no es el trazado exacto de conducción.
- **Planificador:** A* con objetivo de riesgo o tiempo y obstáculos comunes.
- **Pendiente de datos científicos:** `data/jezero/grid.json` debe llegar de Héctor. Hasta entonces, los botones de selección y cálculo se mantienen desactivados. `grid.example.json` es ficticio y no se carga.
- **Vista 3D:** el prototipo anterior de Gale se conserva en `archive/gale/`; no se presenta como vista de Jezero.

## Módulos y equipo

| Carpeta/archivo | Responsabilidad |
|---|---|
| `data/jezero/` | Fuentes, waypoints y cuadrícula procesada de Jezero |
| `src/data/grid.js` | Valida y carga el contrato de matriz |
| `src/planner/a-star.js` | Búsqueda A* sobre celdas transitables |
| `src/planner/objectives.js` | Rutas segura y rápida, con métricas comparables |
| `app.js` | Mapa Leaflet, capas y presentación de rutas |
| `scripts/fetch-data.mjs` | Descarga waypoints oficiales de Perseverance |
| `docs/grid-data-contract.md` | Formato común para Héctor y quien integra A* |
| `docs/team-workflow.md` | Ramas, commits y Pull Requests |

## Método del planificador

La ruta segura minimiza la suma del índice de riesgo. La rápida minimiza los segundos estimados. Ambas excluyen celdas bloqueadas. Usa cuatro vecinos y el coste de una transición es la media de los costes de las dos celdas. Consulta el contrato de datos antes de generar la matriz.

## Fuentes

Consulta [`data/README.md`](data/README.md) para las fuentes y coberturas. El material del prototipo anterior de Gale permanece separado en [`archive/gale/`](archive/gale/).
