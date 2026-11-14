# Datos de Jezero

`waypoints.json` contiene localizaciones del rover Perseverance descargadas del endpoint oficial de NASA MMGIS mediante `node scripts/fetch-data.mjs`. Al conectar los puntos en orden se obtiene una línea de referencia, no el trazado exacto de cada conducción.

`grid.json` debe ser generado por el análisis de terreno de Héctor. El ejemplo `grid.example.json` es ficticio y la aplicación no lo carga como datos científicos. Para ver el formato y unidades, consulta `../../docs/grid-data-contract.md`.

Las capas de mapa en vivo proceden del catálogo WMTS de NASA Mars Trek. El código usa los mosaicos CTX controlado y preliminar y el mosaico HiRISE controlado para Jezero. La documentación de cobertura, capas y fuentes está en `../README.md`.
