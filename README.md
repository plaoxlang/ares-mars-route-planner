# ares-mars-route-planner
Mars route planning for the NASA Space Apps Challenge

**ARES** es un prototipo de mapa y planificador de rutas para excursiones humanas en Marte, centrado en el **cráter Jezero** y construido sobre la travesía real de **Perseverance**: 708 paradas y 45,2 km, de −2.586 m a −1.786 m. Calcula rutas entre dos puntos según el vehículo y sus especificaciones, como un "Google Maps" marciano. También muestra los datos en que se basan: relieve real, pendiente, frío nocturno y radiación estimada.

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

**Planificador de rutas** (pestaña *Planificar ruta* del mapa 2D): como Google Maps, pero en Jezero.
- Pulsa el origen (A) y el destino (B) en el mapa, o pon el origen en la parada actual del rover. Los pines se pueden arrastrar.
- Elige vehículo. Sus especificaciones se pueden editar y la ruta se recalcula al momento:

  | Vehículo | Pendiente máx. | Velocidad en llano | Autonomía | Batería |
  |---|---|---|---|---|
  | Astronauta a pie | 18° | 3 km/h | 8 h | — |
  | Rover no presurizado (tipo Apollo LRV) | 22° | 10 km/h | 8 h | 8,7 kWh |
  | Rover presurizado (tipo SEV de NASA) | 18° | 8 km/h | 72 h | 60 kWh (supuesto) |
  | Rover robótico (tipo Perseverance) | 25° | 0,12 km/h | — | — |

  Son valores de partida aproximados para el reto, no especificaciones oficiales.
- Calcula hasta 3 alternativas: **más rápida**, **más segura** (evita sobre todo pendientes de más de 8°) y **menos energía** (o *menos esfuerzo* a pie). Cada una trae tiempo, distancia, desnivel, pendiente máxima, tramo empinado, terreno irregular, energía y % de batería, con su perfil de elevación. Avisa si se pasa de autonomía o de batería, o si no hay ruta posible.
- **Reproducir la ruta:** con una ruta elegida, la barra de tiempo inferior pasa a esa ruta.
  - Play (o espacio) mueve el vehículo a la velocidad estimada, comprimida en 12–40 s.
  - La lectura muestra el reloj de misión (`T+h:mm`), los km recorridos, la altitud y el factor de aceleración.
  - El perfil se puede arrastrar y ← → avanzan o retroceden un 2 %.
- **Pasar entre vistas:** la ruta elegida se guarda en el navegador (`localStorage`).
  - *Ver en 3D* (o la pestaña *Terreno 3D*) abre `3d.html#plan`: la ruta en azul sobre el relieve, pines A/B, panel con sus datos y play con la cámara siguiendo al vehículo.
  - *Editar en el mapa* vuelve a `index.html#plan` con los mismos puntos, vehículo y alternativa.
- Por dentro:
  - A\* sobre el DTM de 20 m: unas 460.000 celdas, 8 direcciones. Corre en un Web Worker y tarda ~0,1–0,5 s.
  - Las celdas con más pendiente que el máximo del vehículo quedan prohibidas.
  - La velocidad depende de la pendiente del tramo (a pie, con la función de Tobler) y de la rugosidad del terreno.
  - La energía sale de la rodadura más el desnivel, con g = 3,721 m/s².
- **Validación con la ruta real de Perseverance:** en 27 tramos de ~1,5 km, el perfil "rover robótico" se separa del camino real una mediana de **55 m** (unas 3 celdas). En el 85 % de los tramos la desviación media es menor de 100 m. El recorrido real es más largo (1,8 veces la línea recta) porque el rover se desvía para hacer ciencia.
- **Limitación:** con 20 m por celda no se ven rocas ni escalones pequeños. Para una salida real habría que usar el DTM HiRISE de 1 m de la zona.

**Tour guiado** (botón *Tour guiado* en las dos vistas, o directamente `3d.html#tour`): un recorrido de ~3 minutos en 9 capítulos.
- La cámara vuela sobre Jezero y las capas cambian con fundidos.
- Etiquetas ancladas al terreno marcan el aterrizaje, los puntos más bajo y más alto, la subida más dura y la inclinación máxima. Salen de los propios datos.
- Recorre en cámara rápida la ruta de Perseverance con contadores en directo y acaba en la vista de astronauta, en el borde del cráter.
- Narración opcional en español con la voz del navegador (Web Speech API). Si no hay voz, avanza con tiempo de lectura.
- Teclado: ← → para cambiar de capítulo, espacio para pausar, Esc para salir.

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
| `planner.js` | Planificador: vehículos, puntos A/B, rutas en el mapa, fichas de resultados |
| `planner-worker.js` | Motor A* en un Web Worker: pendiente, rugosidad, velocidad, energía y estadísticas |
| `route-player.js` | Ruta compartida entre vistas (guardar/cargar) y su reproducción en la barra de tiempo |
| `tour.js` | Tour guiado: guion, vuelos de cámara, etiquetas, narración (se carga solo al pedirlo) |
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
