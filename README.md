# ares-mars-route-planner
Mars route planning for the NASA Space Apps Challenge

**ARES** es un prototipo de mapa de ruta para una excursión humana en Marte, centrado en el **cráter Jezero** y construido sobre la travesía real de **Perseverance**: 708 paradas y 45,2 km, de −2.586 m a −1.786 m. Todavía no planifica rutas. Reúne y muestra los datos que necesitará un algoritmo de rutas: relieve real, pendiente, frío nocturno y radiación estimada, además de la ruta de referencia del rover.

## Arrancar

Es una web estática. Hay que servirla con un servidor local, porque el navegador no deja cargar los datos si se abre el HTML directamente:

```bash
python -m http.server 8010
```

Después abre <http://localhost:8010>. Necesita conexión a internet: las teselas de mapa, las fotos y Three.js se cargan desde fuera.

## Vistas

**Mapa 2D** (`index.html`): Leaflet con la proyección de Marte.
- Capas base MOLA y Viking. Encima: mosaicos **controlados** CTX (6 m) y HiRISE (25 cm) de Jezero.
- Capas calculadas en el navegador a partir del relieve real: **altura** y **pendiente**. También el **frío nocturno** relativo (THEMIS).
- Ruta de Perseverance con las paradas coloreadas por inclinación del rover.
- Perfil de elevación que hace de barra de tiempo (se arrastra), con reproducción.
- Fotos del rover del sol de cada parada, pedidas en directo a la API de NASA.

**Terreno 3D** (`3d.html`): Three.js sobre el **DTM CTX de 20 m**, que difiere ±3,4 m de las alturas medidas por el rover.
- Vistas: general, cenital (2D) y astronauta (a ras de suelo). Exageración vertical ajustable.
- Capas del terreno:
  - Satélite
  - Satélite en color (aproximado)
  - Altura
  - Pendiente
  - Frío nocturno (THEMIS)
  - **Radiación estimada**
- En cada parada: pendiente del terreno, frío nocturno relativo (percentil en la zona) y dosis estimada.

Las dos vistas comparten la parada seleccionada (`#i=123` en la URL). Teclado: ← → para cambiar de parada; espacio para reproducir.

### Limitaciones a tener en cuenta
- **Temperatura:** no hay temperatura por parada. El feed público de MEDA (Perseverance) solo tiene unos pocos soles; los datos completos están en NASA PDS. El frío nocturno de THEMIS es *relativo* (dónde se enfría más de noche), no son grados.
- **Radiación:** es un **modelo**, no una medida. Parte de 0,64 mSv/día (RAD, Curiosity, Gale; Hassler et al. 2014) y lo ajusta por el cielo visible y por la altitud (Jezero está ~1,9 km más alto que Gale). No incluye el ciclo solar ni tormentas solares. Los parámetros están en `RAD`, dentro de `scene3d.js`.
- **Pendiente:** está calculada a escala de ~60 m (DTM de 20 m ligeramente suavizado). Rocas y escalones pequeños no aparecen. Para eso haría falta el DTM HiRISE de 1 m de la zona de la excursión.
- **Fechas:** la fecha terrestre de cada sol es aproximada; se calcula a partir del aterrizaje del 18-02-2021.

## Código

| Archivo | Qué hace |
|---|---|
| `index.html`, `app.js` | Mapa 2D |
| `3d.html`, `scene3d.js` | Vista 3D: malla del relieve, capas, radiación estimada |
| `dem.js` | Carga del DTM, interpolación, pendiente, sombreado |
| `shared.js` | Configuración de la zona (`SITE`), utilidades, inspector de parada, perfil/barra de tiempo |
| `styles.css` | Estilos (tema oscuro, IBM Plex) |
| `scripts/jezero/` | Descarga y preparación de los datos de Jezero (Node 18+) |
| `scripts/gale/` | Scripts de la zona anterior (archivo) |

## Fuentes

Todos los enlaces se comprobaron el 14-11-2026.

### El reto
- [Interplanetary Survival Guide: Martian Map — NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)
- Recursos que propone el reto:
  - [JPL Mars Trek](https://trek.nasa.gov/mars/): portal de NASA para explorar Marte por capas. De aquí salen todas las teselas.
  - [USGS-NASA Planetary Geologic Mapping Program · mapas interactivos de Marte](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)
  - [Ruta propuesta de Curiosity en Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/): ejemplo de mapa de ruta.
  - [NASA Worldview](https://worldview.earthdata.nasa.gov/): visor de capas. Es de la Tierra; solo sirve como referencia.
  - [Galería de imágenes sin procesar de Perseverance](https://mars.nasa.gov/mars2020/multimedia/raw-images/)

### Datos de Jezero que usa la app
| Dato | Fuente |
|---|---|
| Ruta y paradas de Perseverance | [M20_waypoints.json](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json) (visor MMGIS de NASA) |
| Relieve (DTM CTX controlado de 20 m) | [JEZ_ctx_B_soc_008_DTM…_20m.tif](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif) (USGS Astrogeology, Mars 2020 Terrain Relative Navigation) |
| Mosaico HiRISE controlado (25 cm) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml) |
| Mosaico CTX controlado (6 m) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml) |
| Mosaico CTX regional (preliminar) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Jezero_CTX_BlockAdj_dd/1.0.0/WMTSCapabilities.xml) |
| Frío nocturno (THEMIS IR noche, 100 m) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) |
| Mapa base: relieve MOLA en color | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml) |
| Mapa base: color Viking | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml) |
| Fotos de Perseverance por sol | [API raw_images (ejemplo: sol 1000)](https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=1000) |
| Dosis de referencia para la radiación estimada | Hassler et al. (2014), *Mars' Surface Radiation Environment Measured with the MSL Curiosity Rover*, Science 343 — [doi:10.1126/science.1244797](https://doi.org/10.1126/science.1244797) |

Buscador del catálogo de Mars Trek, útil para encontrar más capas de una zona: [ejemplo con "jezero"](https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=20&key=jezero&proj=urn:ogc:def:crs:EPSG::104905).

### Clima de Jezero (pendiente de integrar)
- [Feed público de MEDA (Perseverance)](https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json): solo trae unos pocos soles.
- [MEDA en NASA PDS (nodo de Atmósferas)](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html), con el [archivo de datos completo](https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/).

### Gale (archivo, ya no lo usa la app)
- [MSL_waypoints.json](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json) y [MSL_traverse.json](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json): ruta de Curiosity.
- [Feed de clima REMS (Curiosity)](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json)
- [API de imágenes de Curiosity](https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=5&page=0&condition_1=msl:mission)

### Software
- [Leaflet 1.9.4](https://leafletjs.com/): mapa 2D.
- [Three.js 0.160](https://threejs.org/): vista 3D.
- [IBM Plex Sans / Mono](https://fonts.google.com/specimen/IBM+Plex+Sans): tipografía.

Créditos de los datos: NASA/JPL-Caltech, USGS Astrogeology, University of Arizona (HiRISE), Malin Space Science Systems (CTX), Arizona State University (THEMIS).

## Datos

- [`data/jezero/`](data/jezero/README.md): ruta de Perseverance, perfil de elevación y DTM CTX recortado. También documenta las fuentes en vivo (Mars Trek, fotos, MEDA).
- [`data/gale/`](data/gale/README.md): archivo de la versión anterior (Curiosity en Gale, con clima REMS).
