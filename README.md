# ares-mars-route-planner
Mars route planning for the NASA Space Apps Challenge

**ARES** es un prototipo de mapa y planificador de rutas para excursiones humanas en Marte, centrado en el **cráter Jezero**. Calcula rutas entre dos puntos para un rover presurizado, como un "Google Maps" marciano, y las enseña en 2D y en 3D con un informe de misión GO / PRECAUCIÓN / NO-GO. También muestra los datos en que se basan: relieve real, pendiente, frío nocturno y radiación estimada.

**Presentación de ~4 minutos** para exponer el proyecto: botón *Presentación* en la cabecera. Guion y teclas en [docs/presentacion.md](docs/presentacion.md).

## Arrancar

Es una web estática. Hay que servirla con un servidor local, porque el navegador no deja cargar los datos si se abre el HTML directamente:

```bash
python scripts/serve.py 8010
```

`scripts/serve.py` es el servidor de Python con `Cache-Control: no-cache`. Con `python -m http.server` el navegador puede seguir usando durante un rato los `.js` antiguos tras un cambio; si pasa, recarga con Ctrl+F5.

Después abre <http://localhost:8010>. Necesita conexión a internet: las teselas de mapa, las fotos y Three.js se cargan desde fuera.

## Vistas

**Diseño de la interfaz** (común al mapa y al 3D): estructura tipo Flightradar24 con estética tipo SpaceX.
- A la izquierda, la ficha de *Mi ruta*. Arriba lleva la imagen de satélite de donde va el vehículo y la barra de progreso de A a B. En el mapa, debajo va el planificador; en el 3D, la telemetría y el informe de misión.
- Abajo, la barra de herramientas junto a la línea de tiempo. Cada herramienta muestra su valor actual y abre su panel:
  - 3D: *Ruta*, *Relieve*, *Hora* e *Info*;
  - mapa: *Info*.
- **Capas siempre a la vista**, arriba a la izquierda del mapa: una tira de miniaturas con la capa activa resaltada y su leyenda debajo. Siempre hay una, y solo una, activa. En el mapa 2D van sobre el relieve MOLA, que es la base fija. Se puede plegar con la flecha.
- En el 3D, las vistas de cámara están arriba a la derecha, con los controles de navegación debajo; a ras de suelo, la telemetría y el minimapa pasan a la derecha.
- En el móvil, el mapa ocupa todo el ancho y la ficha va debajo.
- Tipografía Barlow / Barlow Condensed, fondo negro, la selección en blanco y el color reservado a los datos.

**Mapa 2D** (`index.html`): Leaflet con la proyección de Marte.
- Base fija: relieve MOLA en color. Encima, **una capa a elegir**: mosaicos **controlados** CTX (6 m) o HiRISE (25 cm, con CTX donde HiRISE no llega), o las capas calculadas en el navegador a partir del relieve real, **altura** y **pendiente**, o el **frío nocturno** relativo (THEMIS).
- El planificador ocupa el panel izquierdo (ver *Planificador de rutas*).
- Perfil de elevación de la ruta que hace de barra de tiempo (se arrastra), con reproducción.

**Terreno 3D** (`3d.html`): Three.js sobre el **DTM CTX de 20 m**, que difiere ±3,4 m de las alturas medidas por Perseverance en su travesía (se usan solo para validar el relieve).
- **Terreno lejano, sin bordes negros:** alrededor del DTM de 20 m (que solo cubre ~19 × 9,5 km) hay ~280 × 280 km de Marte con relieve MOLA de 463 m.
  - La imagen es CTX de 6 m en un anillo de ~30 km, el mosaico CTX regional más lejos y Viking (en gris) donde no hay CTX. Su tono se ajusta al del terreno detallado. Al alejarse del recorte se desenfoca, pierde color y se oscurece, para que el protagonismo sea de la zona de la ruta.
  - En el borde, MOLA se corrige para coincidir con el DTM de 20 m y la corrección se desvanece en ~3 km, así que no hay escalón.
  - A lo lejos el suelo baja con la curvatura de Marte (a 130 km, ~2,5 km), lo que da un horizonte real.
  - Solo es contexto visual: rutas, radiación y planificador usan únicamente el DTM de 20 m.
- **Intro:** al entrar en `3d.html` (una vez por sesión, o siempre con `3d.html#intro`) la cámara desciende sobre Jezero con el título y termina con dos opciones: *Ver la presentación* o *Explorar por mi cuenta*. Se salta con clic, Esc o espacio.
- **Informe de misión:** la ficha de la izquierda es la de la misión.
  - **Veredicto GO / PRECAUCIÓN / NO-GO** con sus motivos:
    - autonomía usada y batería;
    - pendiente máxima frente al límite del vehículo y tramo por encima de 8°;
    - tiempo en las zonas más frías de noche (THEMIS, relativo);
    - **dosis de radiación estimada** a lo largo de la ruta (tasa del modelo × tiempo en cada tramo). Se pone en contexto con el límite de carrera de NASA (600 mSv) y con los días equivalentes de radiación natural en la Tierra (2,4 mSv/año).
  - **Telemetría en directo** durante la reproducción: reloj de misión, autonomía restante, batería (aproximada), dosis acumulada y pendiente en el punto. También aparece en el panel de las vistas a ras de suelo.
  - **Parte de llegada** al terminar la reproducción: tiempo, distancia, dosis y el motivo principal del veredicto.
- **Hora del día:** el control *Hora solar* (abajo) mueve el Sol en todas las vistas. *Ver un sol* recorre de 5:30 a 19:30 en ~24 s.
  - El Sol se calcula para la latitud de Jezero con declinación de +25° (verano del hemisferio norte).
  - A ras de suelo, el cielo cambia con la hora: color caramelo de día, **halo azul alrededor del Sol al atardecer** (el polvo marciano dispersa el azul hacia delante) y estrellas de noche. Es una aproximación visual, no un modelo de transferencia radiativa.
- **Al volante:** al crear una ruta en el mapa aparece una cuenta atrás de 4 s (*Ir ya* / *Quedarme en el mapa*; cualquier otra acción la cancela). También hay un botón *Al volante* en las rutas.
  - El mapa vuela al inicio de la ruta, funde a negro y abre `3d.html#drive`.
  - Ahí, tras un telón de ~0,7 s con el nombre de la ruta, la cámara baja en curva desde el aire hasta detrás del rover. Durante el vuelo pasan la exageración, la niebla y el campo de visión de la vista general a los de a ras de suelo, y al llegar la ruta arranca sola.
  - Pulsar *Coche* desde *General* hace el mismo vuelo, más corto.
- **Precarga:** al abrir el 3D se preparan en segundo plano el modelo del rover, el suelo HiRISE del inicio de la ruta y los shaders (`renderer.compileAsync`). Entrar en *Coche* pasa de ~2,4 s a ~0,2 s. El mapa 2D, cuando ya está cargado, descarga en segundo plano Three.js, el modelo y el relieve para que el 3D salga de la caché.
- **Detalle al acercarse en *General*:** a menos de ~3,4 km del punto que se mira se monta un parche de 1,6 km con HiRISE (~0,8 m/px) y CTX, fundido por los bordes con el relieve. Sigue la exageración vertical y solo aparece con la capa *Satélite*.
- **Ruta:** todas las vistas, el play y la barra de tiempo siguen *Mi ruta*: la última trazada en el planificador o, si no hay ninguna, la ruta de ejemplo de `data/jezero/default-plan.json` (del delta al borde del cráter).
- **Vista *General*:** se navega como un mapa.
  - Arrastrar desplaza sobre el terreno, botón derecho (o Ctrl + arrastrar) gira, la rueda acerca hacia el cursor. En táctil, un dedo desplaza y dos giran y acercan.
  - Botones a la derecha: acercar, alejar, brújula (gira con la vista; un clic deja el norte arriba) y encuadrar toda la zona de estudio.
  - El punto de giro se mantiene pegado al suelo al desplazarse y no puede salir de la zona.
  - La exageración vertical se ajusta en *Relieve*.
- **Zona de estudio:** el rectángulo del DTM de 20 m lleva un contorno blanco sobre el relieve y un rótulo con su tamaño. Fuera, el relieve es MOLA (463 m) y la imagen se desenfoca, pierde el color y se oscurece desde el mismo borde.
- **Vistas a ras de suelo:** *Coche* (detrás del rover) y *POV* (Navcam del rover). Las dos comparten:
  - escala real, suelo HiRISE con detalle y cielo marciano;
  - **línea de trazada en el suelo**, al estilo de los simuladores de carreras: chevrones finos por delante del vehículo, coloreados por la inclinación del terreno en cada punto (verde < 8°, ámbar 8–15°, rojo > 15°, los mismos umbrales que el resto de la app). A lo lejos se funden en una línea fina; se ve hasta ~1,8 km por delante;
  - **trayectoria suavizada:** el vehículo no sigue la polilínea a tramos rectos. La ruta del planificador (rejilla de 20 m) se suaviza con una media gaussiana de σ ≈ 12 m;
  - banderas de origen (verde) y destino (rojo), con un haz de luz que se ve de lejos y desaparece al acercarse;
  - ratón: arrastrar para mirar alrededor (en *Coche*, para girar alrededor del rover), rueda para zoom, doble clic para centrar, Esc para volver a *General*.
  - **minimapa** abajo a la izquierda: la ruta entera sobre la imagen de satélite, el tramo recorrido en blanco, el vehículo con su rumbo, el cono de lo que ve la cámara, origen y destino, y una barra de escala. Un clic salta al punto de la ruta más cercano.
  - **telemetría** arriba a la derecha: ruta, cabeceo y alabeo del rover, rumbo, velocidad, dosis acumulada, autonomía y progreso. Los ángulos de la suspensión rocker-bogie están plegados en *Ver suspensión*.
- Capas del terreno:
  - Satélite
  - Satélite en color (aproximado)
  - Altura
  - Pendiente
  - Frío nocturno (THEMIS)
  - **Radiación estimada**
- Ficha del punto donde va el vehículo: tiempo de misión, elevación, recorrido, pendiente frente al límite, llegada estimada, frío nocturno relativo (percentil en la zona) y radiación.
- **Rover en *Coche* y *POV*.** El modelo 3D oficial de Perseverance (NASA) recorre la ruta.
  - *Coche*: cámara enganchada detrás del rover que sigue su rumbo con un retardo suave, sin quedarse atrás a ninguna velocidad. *POV*: desde la Navcam del mástil, con la torreta del brazo robótico en primer plano (en el modelo de NASA el brazo está levantado). La cabeza del mástil se oculta, porque es la propia cámara; la orientación se suaviza un poco para que los cambios de pendiente del relieve de 20 m no den tirones.
  - **Suspensión rocker-bogie articulada:** el modelo se separa en balancines, bogies, patas de dirección y 6 ruedas. En cada fotograma se apoyan las ruedas sobre el relieve: cada bogie se inclina entre su rueda central y trasera, cada balancín entre el bogie y la rueda delantera, y el diferencial deja el cuerpo con la media de los dos lados (cabeceo) y la diferencia de alturas (alabeo). Las ruedas giran según la distancia recorrida y las de esquina giran en las curvas.
  - Panel de telemetría: cabeceo, alabeo, rumbo, velocidad, distancia recorrida y ángulo de cada balancín y bogie. Velocidades ×1 / ×10 / ×100 / ×1000 respecto al tiempo real.
  - A escala real (exageración 1×), con sombras y cielo marciano.
  - **Suelo de cerca:** alrededor del rover se monta un parche de 360 m con HiRISE (25 cm/px). Su brillo se ajusta al CTX de debajo para que no se note el borde.
  - **Rover vivo** (`fx.js`, solo aspecto):
    - Las ruedas pisan un microrrelieve de ±4 cm (ruido determinista), así que balancines y bogies trabajan.
    - El cuerpo vibra según la velocidad: cabeceo, alabeo y rebote. La cámara tiembla un poco.
    - Las ruedas levantan polvo: partículas que suben, se abren y se desvanecen.
    - Deja huellas con el dibujo en chevrón de sus ruedas, que se desvanecen a ~260 m.
    - Coste medido: ~3,5 ms por fotograma en total (p99 6,6 ms).
  - **Fluidez:** el parche se regenera al avanzar sin parones. Todos los parches comparten un único material (no se recompila el shader), el ajuste de contraste se hace en la GPU con la media y la desviación medidas sobre una miniatura de 128 px, y la textura es de 1024 px. La telemetría y la ficha se refrescan 4 veces por segundo. Medido en 25 s de *Coche*: 6 regeneraciones del suelo, ningún fotograma por encima de 22 ms (antes, parones de ~65 ms en cada regeneración). Encima va una **textura de detalle procedimental** (regolito, grano y gravilla a escala de centímetros, más un mapa de normales) en `detail.js`. En estas vistas el suelo se tiñe de ocre, porque la imagen de satélite es en escala de grises. El detalle procedimental también aparece al acercarse en las demás vistas y se apaga en las capas de datos.
  - Limitaciones:
    - El detalle procedimental es **solo aspecto**: no son rocas reales y no cambia ni el relieve ni lo que siente la suspensión.
    - La articulación sale del DTM de 20 m, que a escala de rover es casi un plano inclinado. Por eso el balanceo es suave (bogies ±2°, alabeo según la ladera). Con el DTM HiRISE de 1 m se vería mucho más movimiento.
    - El mosaico HiRISE no cubre todo Jezero (por ejemplo, el borde oeste del cráter). Ahí el parche usa CTX de 6 m/px y se ve más borroso.

**Planificador de rutas** (panel izquierdo del mapa 2D): como Google Maps, pero en Jezero.
- Pulsa el origen (A) y el destino (B) en el mapa. Los pines se pueden arrastrar. Al abrir el mapa se carga la última ruta o la de ejemplo.
- **Siempre hay ruta.** Si A o B están en una ladera de más de 18° o en una zona rodeada de ellas, el punto se mueve al más cercano que se pueda alcanzar. Lo dice el estado ("B se ha movido 311 m…") y una línea discontinua naranja une el pin con el inicio o el final de la ruta. Por dentro, el worker etiqueta las zonas conectadas del terreno para esa pendiente (una pasada, ~10 ms, guardada en caché) y busca la celda más cercana de la zona de A.
- Arriba del panel, las **rutas**; debajo, el trayecto (A, B e intercambiar).
- Vehículo fijo: **rover presurizado tipo SEV de NASA**, con 18° de pendiente máxima, 8 km/h en llano, 72 h de autonomía y 60 kWh de batería (supuesto). Son valores de partida aproximados para el reto, no especificaciones oficiales. Están en `plan-config.js`.
- Calcula hasta 3 alternativas: **más rápida**, **más segura** (evita sobre todo pendientes de más de 8°) y **menos energía**. Cada una trae tiempo, distancia, desnivel, pendiente máxima, tramo empinado, terreno irregular, energía y % de batería, con su perfil de elevación. Avisa si se pasa de autonomía o de batería, o si no hay ruta posible.
- **Reproducir la ruta:** con una ruta elegida, la barra de tiempo inferior pasa a esa ruta.
  - Play (o espacio) mueve el vehículo a la velocidad estimada, comprimida en 12–40 s.
  - La lectura muestra el reloj de misión (`T+h:mm`), los km recorridos, la altitud y el factor de aceleración.
  - El perfil se puede arrastrar y ← → avanzan o retroceden un 2 %.
- **Pasar entre vistas:** la ruta elegida se guarda en el navegador (`localStorage`).
  - *Ver en 3D* (o la pestaña *Terreno 3D*) abre `3d.html#plan`: la ruta en azul sobre el relieve, pines A/B, panel con sus datos y play con la cámara siguiendo al vehículo.
  - *Editar en el mapa* vuelve al mapa con los mismos puntos y alternativa.
- Por dentro:
  - A\* sobre el DTM de 20 m: unas 460.000 celdas, 8 direcciones.
  - El motor es el A\* común del equipo, `src/planner/a-star.js` (rama `planner/a-star`), adaptado a la rejilla densa: arrays tipados, memoria reutilizada y costes con sentido (subir no cuesta lo mismo que bajar).
  - Las tres alternativas se calculan a la vez, en tres Web Workers: unos 70 ms en total, frente a 0,2–0,7 s antes.
  - Las velocidades por pendiente salen de tablas precalculadas.
  - Las celdas con más pendiente que el máximo del vehículo quedan prohibidas.
  - La velocidad depende de la pendiente del tramo (a pie, con la función de Tobler) y de la rugosidad del terreno.
  - La energía sale de la rodadura más el desnivel, con g = 3,721 m/s².
- **Validación con la ruta real de Perseverance** (hecha con el perfil de rover robótico, ya retirado de la interfaz): en 27 tramos de ~1,5 km, el planificador se separa del camino real una mediana de **55 m** (unas 3 celdas). En el 85 % de los tramos la desviación media es menor de 100 m. El recorrido real es más largo (1,8 veces la línea recta) porque el rover se desvía para hacer ciencia.
- **Limitación:** con 20 m por celda no se ven rocas ni escalones pequeños. Para una salida real habría que usar el DTM HiRISE de 1 m de la zona.

**Presentación** (botón *Presentación* en las dos vistas): 14 escenas, ~4 minutos, para exponer el proyecto mientras alguien la comenta.
- Recorre las capas, crea una ruta punto a punto con un cursor animado, compara las alternativas, la reproduce, pasa sola al 3D (vuelo, radiación, rover en *Coche* y *POV*, atardecer) y termina con el informe de misión.
- Tarjeta con título, puntos clave y cifras de cada escena; resalta en naranja la parte de la interfaz de la que se habla.
- Modo **automático** (pasa sola, con pausa) o **paso a paso** (espera al presentador). Teclas: → / Av Pág siguiente, ← / Re Pág anterior, Espacio pausa o avanza, A cambia de modo, N notas del presentador, Esc salir. Vale un mando de presentaciones.
- Al pasar del mapa al 3D guarda el punto en `sessionStorage` y la otra página sigue. El guion para el presentador está en [docs/presentacion.md](docs/presentacion.md).

Teclado: ← → avanzan o retroceden la ruta un 2 %; espacio reproduce.

### Limitaciones a tener en cuenta
- **Temperatura:** no hay temperatura absoluta por punto. El feed público de MEDA (Perseverance) solo tiene unos pocos soles; los datos completos están en NASA PDS. El frío nocturno de THEMIS es *relativo* (dónde se enfría más de noche), no son grados.
- **Radiación:** es un **modelo**, no una medida. Parte de 0,64 mSv/día (RAD, Curiosity, Gale; Hassler et al. 2014) y lo ajusta por el cielo visible y por la altitud (Jezero está ~1,9 km más alto que Gale). No incluye el ciclo solar ni tormentas solares. Los parámetros están en `RAD`, dentro de `scene3d.js`.
- **Pendiente:** está calculada a escala de ~60 m (DTM de 20 m ligeramente suavizado). Rocas y escalones pequeños no aparecen. Para eso haría falta el DTM HiRISE de 1 m de la zona de la excursión.

## Código

| Archivo | Qué hace |
|---|---|
| `index.html`, `app.js` | Mapa 2D |
| `3d.html`, `scene3d.js` | Vista 3D: malla del relieve, capas, radiación estimada, vistas Coche/POV, parche de suelo HiRISE |
| `rover.js` | Rover Perseverance articulado: separa ruedas y suspensión del GLB y resuelve el rocker-bogie sobre el relieve |
| `detail.js` | Textura de detalle de suelo procedimental (solo aspecto) |
| `mission.js` | Informe de misión: dosis acumulada, autonomía, batería, frío y pendiente → GO / PRECAUCIÓN / NO-GO |
| `sky.js` | Posición del Sol según la hora y cielo de Marte (día, atardecer azul, noche) |
| `intro.js` | Intro cinematográfica de la vista 3D |
| `minimap.js` | Minimapa de las vistas a ras de suelo |
| `fx.js` | Efectos a ras de suelo: microrrelieve bajo las ruedas, vibración, polvo y huellas |
| `layout.js` | Diseño de la interfaz: coloca los menús en la barra inferior (mapa y 3D) |
| `hero.js` | Cabecera de la ficha: imagen de satélite, estado y progreso de la ruta |
| `present.js` | Presentación de ~4 min: guion, motor (automático / paso a paso), resaltados y cursor, paso entre mapa y 3D |
| `plan-config.js` | Vehículo de la misión, alternativas y puntos de la ruta de ejemplo (común al navegador y a los scripts) |
| `assets/rover/perseverance.glb` | Modelo 3D oficial de Perseverance (NASA/JPL-Caltech) |
| `planner.js` | Planificador: puntos A/B, rutas en el mapa, fichas de resultados |
| `planner-worker.js` | Planificador en Web Workers: modelo del vehículo, coste de cada tramo y estadísticas; la búsqueda la hace `src/planner/a-star.js` |
| `src/planner/` | A* común del equipo (`a-star.js`), objetivos `risk`/`timeSeconds` y `planRoutes` (`objectives.js`), velocidad por defecto (`config.js`) |
| `src/data/` | Validación y carga de rejillas (`grid.js`) y generador `mars_grid.py` del equipo |
| `docs/grid-data-contract.md` | Contrato de la cuadrícula de costes (`data/jezero/grid.json`) |
| `route-player.js` | Ruta compartida entre vistas (guardar/cargar) y su reproducción en la barra de tiempo |
| `dem.js` | Carga del DTM, interpolación, pendiente, sombreado |
| `shared.js` | Configuración de la zona (`SITE`), utilidades, inspector de parada, perfil/barra de tiempo |
| `styles.css` | Estilos (tema oscuro, IBM Plex) |
| `scripts/jezero/` | Descarga y preparación de los datos de Jezero (Node 18+). `build-default-plan.mjs` genera la ruta de ejemplo (`data/jezero/default-plan.json`) con el mismo planificador que el navegador |
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
| Relieve regional para el terreno lejano (MOLA MEGDR, 128 px/°, ~463 m) | [megt44n000hb.img](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img) y su [etiqueta PDS](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.lbl) (NASA PDS Geosciences) |
| Relieve (DTM CTX controlado de 20 m) | [JEZ_ctx_B_soc_008_DTM…_20m.tif](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif) (USGS Astrogeology, Mars 2020 Terrain Relative Navigation) |
| Mosaico HiRISE controlado (25 cm) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml) |
| Mosaico CTX controlado (6 m) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/WMTSCapabilities.xml) |
| Mosaico CTX regional (preliminar) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Jezero_CTX_BlockAdj_dd/1.0.0/WMTSCapabilities.xml) |
| Frío nocturno (THEMIS IR noche, 100 m) | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml) |
| Mapa base: relieve MOLA en color | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml) |
| Mapa base: color Viking | [WMTS de Mars Trek](https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml) |
| Fotos de Perseverance por sol | [API raw_images (ejemplo: sol 1000)](https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=1000) |
| Modelo 3D del rover Perseverance (glTF) | [25042_Perseverance.glb](https://mars.nasa.gov/system/resources/gltf_files/25042_Perseverance.glb) (NASA/JPL-Caltech) |
| Límite de carrera de NASA para la dosis de un astronauta (600 mSv), usado en el informe de misión | NASA-STD-3001, Vol. 1, Rev. B (2022) |
| Radiación natural media en la Tierra (2,4 mSv/año), usada como comparación | UNSCEAR, informe de 2008 |
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
- [Barlow](https://fonts.google.com/specimen/Barlow) y [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed): tipografía.

Créditos de los datos: NASA/JPL-Caltech, USGS Astrogeology, University of Arizona (HiRISE), Malin Space Science Systems (CTX), Arizona State University (THEMIS), NASA Goddard Space Flight Center (MOLA).

## Datos

- [`data/jezero/`](data/jezero/README.md): ruta de Perseverance, perfil de elevación, DTM CTX recortado y relieve regional MOLA. También documenta las fuentes en vivo (Mars Trek, fotos, MEDA).
- [`data/gale/`](data/gale/README.md): archivo de la versión anterior (Curiosity en Gale, con clima REMS).
