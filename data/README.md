# Datos y capas del cráter Jezero

La aplicación activa usa la zona de aterrizaje y exploración de Perseverance, aproximadamente 18° N, 77° E. El mapa 2D carga MOLA/Viking globales y mosaicos de Jezero mediante WMTS de NASA Mars Trek. El catálogo de Mars Trek identifica los mosaicos CTX Jezero controlado y preliminar y el mosaico HiRISE controlado; sus límites exactos están reflejados en `app.js`.

Los puntos de navegación proceden de `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json` y se guardan localmente en `data/jezero/waypoints.json` porque el endpoint no permite CORS. La línea de referencia conecta localizaciones del rover y no equivale a una traza precisa de cada conducción.

La cuadrícula de riesgo/tiempo no está incluida todavía. Héctor debe producir `data/jezero/grid.json` conforme a `../docs/grid-data-contract.md`. La aplicación no usa datos ficticios para calcular rutas.

## Fuentes

- NASA Mars Trek WMTS y catálogo: `https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars`
- NASA MMGIS, waypoints Mars 2020: `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json`
- USGS Astrogeology, mosaico DEM CTX Jezero de 20 m/px: `https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic`
- NASA/JPL, contexto y localización de Jezero: `https://www.jpl.nasa.gov/news/press_kits/ingenuity/landing/mission/jezero_crater/`

El antiguo material de Curiosity en Gale está guardado en `archive/gale/` solo como referencia histórica.
