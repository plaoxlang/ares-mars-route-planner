# Datos: cráter Jezero (zona de trabajo)

Ruta de **Perseverance (Mars 2020)** y relieve del cráter Jezero. Coordenadas en grados planetocéntricos, longitud este. Alturas en metros respecto al areoide de Marte (MOLA).

## Archivos

| Archivo | Qué es | Tamaño |
|---|---|---|
| `m20_waypoints.json` | GeoJSON original de NASA (MMGIS): 708 paradas, soles 13–2022 | 0,5 MB |
| `elevation_waypoints.json` | Perfil por parada, limpio y con resumen | 0,3 MB |
| `elevation_waypoints.csv` | Lo mismo en CSV | 0,1 MB |
| `dem_ctx_20m.bin` | Relieve: DTM CTX controlado de 20 m recortado a la zona de la ruta (966 × 475 px) | 0,9 MB |
| `dem_ctx_20m.json` | Extensión, tamaño, escala y estadísticas del relieve | — |

### `elevation_waypoints.json`

Mismo formato que el de Gale:

```jsonc
{
  "meta": { "summary": { "distance_m": 45245.71, "elev_start_m": -2569.91, "elev_end_m": -1936.37,
                         "cumulative_gain_m": 1588.14, "sol_range": [13, 2022] } },
  "points": [
    { "i": 0, "sol": 13, "site": 3, "drive": 0, "lon": 77.45088572, "lat": 18.44462715,
      "elev_m": -2569.91,
      "dist_total_m": 0,          // acumulado (suma de dist_from_prev_m)
      "dist_total_nasa_m": 0,     // acumulado original de NASA (ver aviso)
      "dist_from_prev_m": 0,
      "tilt_deg": 1.18, "pitch_deg": -0.03, "roll_deg": -1.18, "yaw_deg": 130.88,
      "note": "..." }
  ]
}
```

> ⚠️ El `dist_total_m` original de NASA vuelve a 0 en **129 paradas**. Se recalcula sumando `dist_from_prev_m`, que da exactamente su total final (45.245,71 m).

### `dem_ctx_20m.bin`

- `Int16` little-endian, fila a fila empezando por el norte.
- Metros = valor × 0,1. El valor `-32768` significa sin dato; en este recorte no hay ninguno.
- Cada píxel mide 20 m (3,374·10⁻⁴°), igual en longitud y en latitud, porque la proyección es equirectangular con latitud estándar 0.
- Los bordes `west`, `east`, `north` y `south` del JSON son los bordes exteriores de los píxeles.

Lectura en el navegador:

```js
const meta = await (await fetch('data/jezero/dem_ctx_20m.json')).json();
const raw = new Int16Array(await (await fetch('data/jezero/dem_ctx_20m.bin')).arrayBuffer());
const alturaEn = (col, fila) => raw[fila * meta.width + col] * meta.scale;
```

`dem.js` ya hace esto e incluye interpolación, pendiente y sombreado.

**Precisión:** frente a las 708 alturas medidas por el rover, el error cuadrático medio es de **±3,4 m**, con un sesgo de −0,9 m.

## Fuentes en vivo

**Teselas de Mars Trek (WMTS)**, con la plantilla `https://trek.nasa.gov/tiles/Mars/EQ/{capa}/1.0.0/default/default028mm/{z}/{y}/{x}.png`:

| Capa | Zoom máx. | Cobertura (lon / lat) |
|---|---|---|
| `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` (HiRISE controlado, 25 cm) | 17 | 77,223–77,584 / 18,307–18,669 |
| `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` (CTX controlado, 6 m) | 13 | 77,160–77,699 / 18,211–18,721 |
| `Jezero_CTX_BlockAdj_dd` (CTX preliminar, región amplia) | 12 | 75,15–78,87 / 15,91–19,45 |
| `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` (frío nocturno relativo) | 9 | global ±65° |

Los modelos de elevación de Jezero **no** se sirven como teselas. Se descargan de USGS:
- DTM CTX de 20 m (9,7 MB, el que se usa aquí): `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif`
- DTM HiRISE de 1 m: existe en el catálogo de Mars Trek, pero pesa ~1,8 GB. Sirve para afinar una zona concreta de la excursión.

**Fotos de Perseverance por sol**, en JSON y con CORS: `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}`. Devuelve todas las imágenes del sol (~0,8 MB), con miniaturas de 320 px en `image_files.small`.

**Clima (MEDA):** el feed público `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` solo cubre unos pocos soles. Los datos completos están en NASA PDS (nodo de Atmósferas, `mars2020_meda`).

## Regenerar

Desde la raíz del repo, con Node 18 o superior:

```bash
node scripts/jezero/fetch-route.mjs   # paradas de Perseverance y perfil de elevación
node scripts/jezero/fetch-dem.mjs     # descarga el DTM CTX de USGS y lo recorta a la ruta
```
