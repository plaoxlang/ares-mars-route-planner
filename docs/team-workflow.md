# Flujo de trabajo del equipo

1. `main` es la versión compartida y revisada. No subas trabajo sin revisar directamente a `main`.
2. Antes de empezar una tarea, actualiza tu copia: `git switch main` y `git pull origin main`.
3. Crea una rama por tarea: por ejemplo `feat/jezero-grid`, `feat/astar-planner` o `feat/map-routes`.
4. Guarda cambios relacionados en commits pequeños y con mensajes claros.
5. Sube la rama y abre un Pull Request hacia `main`.
6. Otra persona revisa los archivos y la integración. Corrige comentarios en la misma rama y vuelve a subir.
7. Cuando el PR esté aprobado, fusiónalo. Cada integrante vuelve a `main` y ejecuta `git pull origin main` antes de otra tarea.

Reparto sugerido: Wassim documenta y selecciona productos NASA de Jezero; Héctor genera `grid.json` y explica el análisis; el responsable del planificador mantiene `src/planner/` y `src/data/`; Guillermo conecta controles, capas y rutas en `app.js`. Acordad el contrato de datos antes de trabajar en paralelo.
