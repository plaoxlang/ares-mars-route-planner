# Datos: ruta de Curiosity en Gale / Mount Sharp

Datos públicos de NASA listos para usar en un mapa de ruta marciana. Todo es de la misión **MSL Curiosity** (cráter Gale, Aeolis Mons/Mount Sharp), que es el ejemplo que menciona el reto *Interplanetary Survival Guide: Martian Map* y la zona con más datos de alta resolución.

Coordenadas: `lon`/`lat` en grados planetocéntricos con longitud este (−180…180). Elevación en metros respecto al areoide de Marte (MOLA).

## Archivos

| Archivo | Qué es | Tamaño |
|---|---|---|
| `msl_waypoints.json` | GeoJSON original de NASA: 1.389 paradas (fin de cada conducción) | 0,6 MB |
| `msl_traverse.json` | GeoJSON original de NASA: trazado completo (1.317 `LineString`/`MultiLineString` con altura) | 1,2 MB |
| `sources.json` | URLs de origen y fecha de descarga | — |
| `export/elevation_waypoints.json` | Perfil por parada, limpio y con resumen | 0,4 MB |
| `export/elevation_waypoints.csv` | Lo mismo en CSV (Excel, pandas…) | 0,1 MB |
| `export/elevation_traverse.json` | Perfil denso: 25.749 vértices del trazado con altura y distancia acumulada | 2,4 MB |
| `export/images_by_sol.json` | Índice de fotos del rover: hasta 12 por sol, para los 1.382 soles con parada | 6,2 MB |
| `export/weather_by_sol.json` | Clima REMS de Curiosity: 4.745 soles (4.717 con temperatura) | 0,9 MB |

### `export/elevation_waypoints.json`

```jsonc
{
  "meta": { "summary": { "distance_m": 38623.08, "elev_start_m": -4500.97, "elev_end_m": -3472.08,
                         "cumulative_gain_m": 1629.77, ... } },
  "points": [
    { "i": 0, "sol": 3, "site": 2, "drive": 0, "lon": 137.441633, "lat": -4.589467,
      "elev_m": -4500.971,          // altura respecto al areoide
      "dist_total_m": 0,            // acumulado (suma de dist_from_prev_m)
      "dist_total_nasa_m": 0,       // acumulado original de NASA (ver aviso)
      "dist_from_prev_m": 0,        // longitud de esa conducción
      "tilt_deg": 4.35,             // inclinación total del rover: aproximación a la pendiente
      "pitch_deg": -3.62, "roll_deg": -2.42, "yaw_deg": 111.52 }
  ]
}
```

> ⚠️ El `dist_total_m` original de NASA vuelve a 0 en 6 paradas (soles 987, 990, 1042, 1044, 1289 y 1685). Aquí se recalcula sumando `dist_from_prev_m`. El original se conserva en `dist_total_nasa_m`; no lo uses para gráficas.

### `export/elevation_traverse.json`

`{ meta, points: [{ segment, lon, lat, elev_m, dist_total_m }] }`. `dist_total_m` se calcula con la fórmula de haversine y el radio de Marte (3.396.190 m). Da 38.634 m, coherente con el total de NASA.

### `export/images_by_sol.json`

```jsonc
{
  "meta": { "images_per_sol_max": 12, "sols": 1382, "sols_failed": [] },
  "sols": [
    { "sol": 4000, "total_images": 311,
      "images": [ { "imageid": "...", "instrument": "NAV_RIGHT_B", "date_taken": "2023-11-07T07:14:21.000Z",
                    "site": 105, "drive": 418, "url": "https://mars.nasa.gov/msl-raw-images/...JPG", "title": "..." } ] }
  ]
}
```

Se cruza con las paradas por el campo `sol`. `total_images` es el total de ese sol en la API; para ver más, consulta la API directamente (abajo).

### `export/weather_by_sol.json`

```jsonc
{
  "meta": { "instrument": "REMS ...", "disclaimer": "...", "sol_range": [1, 4995] },
  "sols": [
    { "sol": 3810, "date": "2023-04-25", "ls": 55,
      "air_min_c": -82, "air_max_c": -25,         // temperatura del aire (°C)
      "ground_min_c": -96, "ground_max_c": -5,    // temperatura del suelo (°C)
      "pressure_pa": 851, "uv_index": "Moderate", "opacity": "Sunny",
      "sunrise": "06:08", "sunset": "17:54" }
  ]
}
```

- Fuente: el feed público de REMS (Centro de Astrobiología / NASA). El propio feed dice que es de divulgación; para uso científico, NASA PDS.
- `null` significa que ese sol no tiene medida.
- `ls` es la longitud solar, es decir, la estación marciana. Es lo que hay que usar para estimar el clima de una excursión futura.
- Se cruza con las paradas por `sol`. 1.347 de las 1.389 paradas tienen medida exacta; el mapa usa el sol más cercano, hasta 5 soles, si falta.

### Capas calculadas en el navegador (no son archivos)

- **Frío nocturno relativo:** el mosaico THEMIS IR nocturno de Mars Trek (`THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`, png, zoom máx. 9, ~100 m/px) es gris de 8 bits: más claro = superficie más templada de noche. Es relativo y puede tener cortes entre franjas.
- **Pendiente y altura en color:** salen del DEM de Mars Trek calibrado con las paradas (ver `scene3d.js`).
- **Radiación estimada:** el modelo está en `scene3d.js` (`RAD`). Calcula `0,64 mSv/día × (cielo visible / cielo visible en el aterrizaje) × exp(0,4 · Δaltura / 11.100 m)`. El cielo visible se mide en 16 direcciones, hasta 3 km. El 0,4 es un supuesto ajustable. No es una medida.

## Fuentes en vivo (sin descargar nada)

### Teselas de mapa: JPL Mars Trek (WMTS)

Plantilla: `https://trek.nasa.gov/tiles/Mars/EQ/{capa}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}`

La proyección es plate carrée (EPSG:104905) y encaja con la rejilla EPSG:4326 de Leaflet/OpenLayers: el zoom 0 son 2×1 teselas de 256 px. Para que la escala sea correcta, usa el radio de Marte. En Leaflet: `L.extend({}, L.CRS.EPSG4326, { R: 3396190 })`.

| Capa | ext | Zoom máx. | Cobertura |
|---|---|---|---|
| `Mars_MGS_MOLA_ClrShade_merge_global_463m` (relieve en color) | jpg | 7 | Global |
| `Mars_Viking_MDIM21_ClrMosaic_global_232m` (color) | jpg | 7 | Global |
| `Gale_CTX_BlockAdj_dd` (MRO CTX, ~6 m/px) | png | 12 | lat −6,57…−2,81, lon 135,18…139,24 |
| `curiosity_hirise_mosaic` (MRO HiRISE, ~25 cm/px) | png | 16 | lat −4,93…−4,25, lon 137,12…137,73 |
| `Gale_DEM_SMG_1m` (DEM HiRISE 1 m, visualizado) | png | 14 | igual que HiRISE |

Capacidades de cada capa: `https://trek.nasa.gov/tiles/Mars/EQ/{capa}/1.0.0/WMTSCapabilities.xml`.
Buscador del catálogo, para encontrar otras capas por zona: `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=50&key=*&bbox=137,-6,138.5,-4&proj=urn:ogc:def:crs:EPSG::104905`

### Fotos de los rovers (JSON, admite CORS)

- Curiosity: `https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=24&page=0&condition_1=msl:mission&condition_2={sol}:sol:gte&condition_3={sol}:sol:lte&extended=thumbnail::sample_type::noteq`
- Perseverance: `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=24&page=0&order=sol%20desc`

La API devuelve **403** si recibe muchas peticiones seguidas, así que hay que ir despacio.

### Ruta de Perseverance (Jezero), por si alguien la quiere

`https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json`: 708 paradas con el mismo formato que las de Curiosity, más panorámicas. El trazado (`m20_traverse.json`) no es público (403).

Los GeoJSON de `mmgis-maps` **no admiten CORS**: desde el navegador hay que servirlos en local (por eso están en este repo).

## Regenerar los datos

Requiere Node 18 o superior. Se ejecuta desde la raíz del repo:

```bash
node scripts/fetch-data.mjs        # descarga los GeoJSON de NASA a data/
node scripts/export-elevation.mjs  # genera data/export/elevation_*
node scripts/export-images.mjs     # genera o completa data/export/images_by_sol.json
node scripts/export-weather.mjs    # genera data/export/weather_by_sol.json (clima REMS)
```

`export-images.mjs` es reanudable: si ya existe el JSON, solo vuelve a pedir los soles que fallaron.

## Créditos

Datos e imágenes: NASA/JPL-Caltech, MSSS, University of Arizona (HiRISE), USGS. Datos públicos de NASA; revisa las condiciones de uso de cada fuente.
