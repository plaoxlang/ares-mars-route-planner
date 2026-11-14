
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
- A la izquierda, la ficha de *Mi ruta*: una tarjeta flotante que mide lo que su contenido y cabe entera sin desplazarse.
  - En el mapa: nombre y progreso de A a B, las rutas (con *Al volante*, *Reproducir* y *3D* en una fila) y el trayecto.
  - En el 3D: una foto de satélite pequeña del punto, los datos del punto en tres columnas, la telemetría (una línea por dato) y el informe de misión. En el informe salen los avisos; lo que está en orden queda plegado.
  - *Cómo calcula* y los datos del vehículo están en *Info*.
- Paneles, menús, avisos y la barra inferior comparten el mismo estilo flotante: esquinas redondeadas, fondo translúcido con desenfoque, borde fino y sombra. La barra inferior es una burbuja a la derecha de la ficha y el mapa pasa por debajo.
- Abajo, la barra de herramientas junto a la línea de tiempo. Cada herramienta muestra su valor actual y abre su panel:
  - 3D: *Ruta*, *Relieve*, *Hora* e *Info*;
  - mapa: *Info*.
- **Capas siempre a la vista**, arriba a la izquierda del mapa: una tira de miniaturas con la capa activa resaltada y su leyenda debajo. Siempre hay una, y solo una, activa. En el mapa 2D van sobre el relieve MOLA, que es la base fija. Se puede plegar con la flecha.
- En el 3D, las vistas de cámara están arriba a la derecha, con los controles de navegación debajo; a ras de suelo, la telemetría y el minimapa pasan a la derecha.
- En el móvil, el mapa ocupa todo el ancho y la ficha va debajo.
- Tipografía Barlow / Barlow Condensed, fondo negro, la selección en blanco y el color reservado a los datos.
- **Movimiento estilo Apple:** paneles, menús, avisos y tarjetas entran deslizándose desde fuera de la pantalla por su propio borde, sin fundidos, con la curva de desaceleración de iOS (`--apple` en `styles.css`).
  - La ficha entra desde la izquierda, la barra inferior y sus menús desde abajo, la telemetría, el minimapa y las vistas desde la derecha, y la cabecera desde arriba.
  - Al cerrarse, los menús vuelven a bajar.
- **Mapa al entrar:** a pantalla completa, sin ficha ni barra inferior y con la barra de capas plegada. Un aviso baja desde arriba parpadeando: *Marca el origen en el mapa*.
  - Al marcar A entran la ficha (izquierda) y la barra inferior (abajo), y el aviso pide el destino.
  - Al marcar B el aviso sube, se calculan las rutas y la barra de capas se despliega.
  - Al volver del 3D (`index.html#plan`) se recupera la ruta.
- **Animaciones** (CSS al final de `styles.css`, más el trazo de la ruta en `planner.js`):
  - **Al cargar:** la cabecera, la ficha, la barra inferior y los controles entran escalonados.
  - **Menús:** se abren y cierran con movimiento, y la barra de capas se pliega y despliega con suavidad. La capa elegida da un pequeño salto y su leyenda aparece.
  - **Crear una ruta:**
    - los pines A y B caen;
    - mientras calcula salen tarjetas esqueleto con un barrido;
    - la ruta se dibuja sobre el mapa de A a B (primero las alternativas, la elegida encima);
    - las tarjetas entran en cascada y la elegida emite un destello;
    - al elegir otra se despliega su detalle y su perfil se traza.
  - **Cifras de la cabecera:** entran en cascada cada vez que cambia la ruta, y el perfil de la barra de tiempo se descubre de izquierda a derecha.
  - **3D:** el informe de misión sube con el veredicto marcado, y la telemetría y el minimapa entran por la derecha al ir a ras de suelo. El botón *Al volante* lleva un brillo que invita a pulsarlo.
  - Con "reducir movimiento" del sistema todo esto se desactiva.

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
- **Al volante:** al crear una ruta en el mapa aparece una cuenta atrás de 10 s (*Ir ya* / *Quedarme en el mapa*; cualquier otra acción la cancela). También hay un botón *Al volante* en las rutas.
  - Va directo, sin pantallas intermedias: abre `3d.html?drive=…` y la cámara, que empieza ya cerca del inicio de la ruta, baja en curva hasta detrás del rover. Durante el vuelo pasan la exageración, la niebla y el campo de visión de la vista general a los de a ras de suelo, y al llegar la ruta arranca sola.
  - En Chrome y Edge esa vista se **prerenderiza** mientras se mira el mapa (reglas de especulación), así que el cambio de página es instantáneo. Si cambia la ruta o la alternativa, se prepara otra.
  - En otros navegadores el modelo del rover empieza a cargarse con la página. Mientras tanto la cámara ya se acerca al inicio, así que no hay ni imagen fija ni pantalla de carga.
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
  - **Rocas 3D** (`fx.js`): unas 3.800 alrededor del vehículo, con guijarros, piedras y algún bloque.
    - Facetadas e irregulares, en tonos de basalto, óxido y polvo, medio enterradas y con sombra de contacto.
    - Se colocan por celdas de 8 m con semilla fija (no cambian de sitio al avanzar) y dejan libre la ruta.
    - Coste: ~1 ms por fotograma.
  - **Capas a ras de suelo:** la barra de capas también está en *Coche* y *POV*. Con *Satélite* o *Satélite en color* se ve el suelo HiRISE en ocre. Con *Altura*, *Pendiente*, *Frío nocturno* o *Radiación*, ese mismo suelo detallado se tiñe con el color de la capa, así que se sigue viendo el relieve fino, el grano y las rocas.
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

# ARES — Mars Route Planner

Mars route planning for the NASA Space Apps Challenge 2026.

**ARES** is a map and route-planning prototype for human excursions on Mars, focused on **Jezero crater**. It calculates routes between two points for a pressurized rover — a "Google Maps of Mars" — and displays them in 2D and 3D with a GO / CAUTION / NO-GO mission report. It also shows the underlying data: real terrain, slope, night-time cold, and estimated radiation.

A ~4-minute presentation is included (button **Presentación** in the header). Script and keys are in `docs/presentacion.md`.

## Introduction

ARES is a browser-based tool that helps a crew on Mars decide where to go, how long it will take, and what risks they face. It runs entirely in the browser on real terrain from Jezero crater — where Perseverance landed in 2021, site of an ancient lake 3.5 billion years ago — using open data from NASA and USGS.

The app provides:
- A 2D map (Leaflet, Mars equirectangular projection) with route planner.
- A 3D terrain view (Three.js) with a Perseverance rover model, first-person and chase-camera views, day/night cycle, and mission report.
- Three route alternatives (fastest, safest, least energy) computed with A* on a 20 m grid (~460,000 cells) across three Web Workers.

## Mission Objectives

- Enable crew-assisted route planning between two points (A → B) on Mars using real terrain data.
- Provide a GO / CAUTION / NO-GO verdict based on autonomy, battery, maximum slope vs. vehicle limit, time in cold night zones, and estimated radiation dose along the route.
- Visualize scientific data layers (MOLA, CTX, HiRISE, THEMIS) in 2D and 3D.
- Validate the planner against the real Perseverance traverse (median deviation of ~55 m over 27 segments of ~1.5 km).
- Deliver a hackathon-ready presentation (~4 minutes, automatic or step-by-step mode).

## Interactive Map & Features

### 2D Map (`index.html`)
- Fixed base: color MOLA relief. On top, one choosable layer: controlled CTX mosaics (6 m) or HiRISE (25 cm, with CTX where HiRISE doesn't reach), or browser-computed layers from real relief — **elevation** and **slope** — or relative **night-time cold** (THEMIS).
- Route planner in the left panel: tap origin (A) and destination (B) on the map; pins are draggable.
- Elevation profile of the route acting as a timeline (draggable, with playback).
- Layers always visible (top-left of the map): a strip of thumbnails with the active layer highlighted and its legend below. Always one, and only one, active. Can be collapsed.
- Layers: Satellite, Satellite in color (approximate), Elevation, Slope, Night cold (THEMIS), Estimated radiation.

### 3D Terrain (`3d.html`)
- Terrain mesh from the **20 m CTX DTM** (validated against Perseverance measurements, ±3.4 m RMS error).
- Distant terrain without black edges: ~280 × 280 km of Mars with 463 m MOLA relief around the 20 m DTM (~19 × 9.5 km). CTX 6 m in a ~30 km ring, regional CTX mosaic further out, and Viking (grayscale) where no CTX exists.
- Martian curvature at distance (~2.5 km drop at 130 km) for a real horizon.
- Solar hour control: moves the Sun across all views. "See a sol" runs from 5:30 to 19:30 in ~24 s, calculated for Jezero latitude with +25° declination (northern summer).
- Sky: caramel by day, **blue halo around the Sun at sunset** (Martian dust scatters blue forward), stars at night — a visual approximation, not a radiative transfer model.
- Camera views: **General** (map-like navigation), **Car** (behind the rover), and **POV** (rover Navcam). Minimap, telemetry, and scale bar included.
- Cinematic intro on first entry to `3d.html`: camera descends over Jezero with title, ending with *Watch the presentation* or *Explore on my own*.

### Presentation
- 14 scenes, ~4 minutes: layers, point-to-point route with animated cursor, alternative comparison, playback, 3D flight, radiation, rover in Car and POV, sunset, mission report.
- Automatic mode (runs alone, with pause) or step-by-step mode (waits for the presenter). Keys: → / Page Down next, ← / Page Up previous, Space pause or advance, A toggle mode, N presenter notes, Esc exit. Works with a presentation clicker.

## Scientific Data Layers

| Layer | Source | Resolution / Notes |
|---|---|---|
| MOLA color relief (base map) | Mars Trek WMTS | ~463 m/px, global |
| CTX controlled mosaic | Mars Trek WMTS | 6 m/px |
| HiRISE controlled mosaic | Mars Trek WMTS | 25 cm/px (where available) |
| THEMIS Night IR (night cold, relative) | Mars Trek WMTS | 100 m/px, global ±65° |
| DTM CTX 20 m | USGS Astrogeology (Mars 2020 TRN) | Used for 3D mesh and planning |
| MOLA MEGDR regional | NASA PDS Geosciences | ~463 m, distant terrain |
| Perseverance waypoints | NASA MMGIS | 708 stops, sols 13–2022 |
| Perseverance photos | NASA raw_images API | By sol, JSON with CORS |

Layers calculated in the browser from the real DTM: elevation, slope, and relative night-time cold. Estimated radiation is a model (not a measurement), based on 0.64 mSv/day measured by Curiosity's RAD (Hassler et al. 2014), adjusted for sky visibility and altitude (Jezero is ~1.9 km higher than Gale).

## Mission Planning & Navigation

### Vehicle (fixed)
NASA SEV-type pressurized rover (approximate starting values for the challenge, not official specs): **18° maximum slope, 8 km/h on flat ground, 72 h autonomy, 60 kWh battery**. Configurable in `plan-config.js`.

### Route alternatives (up to 3)
- **Fastest**: minimizes time (speed drops with slope and roughness).
- **Safest**: penalizes slopes over 8° and roughness, even if longer.
- **Least energy**: rolling plus elevation change, with Mars gravity g = 3.721 m/s².

Each alternative includes time, distance, elevation gain, maximum slope, steep segment, rough terrain, energy, and battery %, with its elevation profile. Warns if autonomy or battery is exceeded, or if no route is possible.

### Planner internals
- A* over the 20 m DTM: ~460,000 cells, 8 directions.
- Shared team A* engine (`src/planner/a-star.js`), adapted to the dense grid: typed arrays, reused memory, directional costs (going uphill doesn't cost the same as downhill).
- Three alternatives computed simultaneously in three Web Workers: ~70 ms total.
- Speed by slope from precalculated tables; slope function of Tobler.
- Cells steeper than the vehicle maximum are forbidden.
- Cells with slope > 18° or surrounded by them are snapped to the nearest reachable cell (orange dashed line indicates the move).
- Route chosen is saved in `localStorage`; "View in 3D" opens `3d.html#plan`, "Edit on map" returns with the same points.

### Validation
Against the real Perseverance route: over 27 segments of ~1.5 km, the planner deviates from the real path by a median of **55 m** (~3 cells). In 85% of segments the average deviation is under 100 m. The real traverse is 1.8× the straight-line distance because the rover detours for science.

### Limitations
- 20 m per cell doesn't see rocks or small steps. A real sortie would need the 1 m HiRISE DTM of the excursion area.
- No absolute per-point temperature; public MEDA feed covers only a few sols. THEMIS night cold is relative (where it cools more at night), not degrees.
- Radiation is a model, excludes solar cycle and solar storms.

## Technology & Architecture

- **Vanilla JavaScript (ES modules)**, no build step. Static site served via a local server (browser blocks data loading when opening HTML directly).
- **Leaflet 1.9.4** — 2D map.
- **Three.js 0.160** — 3D terrain, rover, sky.
- **Barlow / Barlow Condensed** — typography (Google Fonts).
- **Web Workers** — parallel route calculation (3 workers).
- **Typed arrays** (Int32Array, Float64Array, Uint8Array) and reused search buffers — high-performance A* on dense grids.
- **A* engine** (`src/planner/a-star.js`): supports matrix and flat cell-list formats, risk and time objectives, 8-direction movement without corner-cutting between blocked cells, octile heuristic, haversine distance on Mars (radius 3,389,500 m).
- **Rover model**: official NASA/JPL-Caltech Perseverance glTF, articulated rocker-bogie suspension (balancers, bogies, steering legs, 6 wheels) solved frame-by-frame against the terrain. Suspension telemetry panel.
- **Files:**
  - `index.html`, `app.js` — 2D map.
  - `3d.html`, `scene3d.js` — 3D: terrain mesh, layers, estimated radiation, Car/POV views, HiRISE ground patch.
  - `rover.js` — articulated Perseverance rover.
  - `detail.js` — procedural ground detail texture (visual only).
  - `mission.js` — mission report: dose, autonomy, battery, cold, slope → GO / CAUTION / NO-GO.
  - `sky.js` — Sun position by hour and Martian sky (day, blue sunset, night).
  - `intro.js` — cinematic 3D intro.
  - `minimap.js` — ground-view minimap.
  - `layout.js` — UI layout (bottom toolbar, map and 3D).
  - `hero.js` — header: satellite image, status, route progress.
  - `present.js` — ~4-minute presentation engine.
  - `plan-config.js` — mission vehicle, alternatives, example route points.
  - `planner.js` — planner: A/B points, map routes, result cards.
  - `planner-worker.js` — Web Worker planner: vehicle model, segment cost, stats; search via `src/planner/a-star.js`.
  - `route-player.js` — shared route between views and timeline playback.
  - `dem.js` — DTM loading, interpolation, slope, shading.
  - `shared.js` — site config (`SITE`), utilities, stop inspector, profile/timeline.
  - `styles.css` — dark theme styles.

## NASA Data Sources

All links verified 14-11-2026.

**The challenge:**

- [Interplanetary Survival Guide: Martian Map — NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)
- Challenge resources: [JPL Mars Trek](https://trek.nasa.gov/mars/), [USGS-NASA Planetary Geologic Mapping Program](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars), [Curiosity's proposed path up Mount Sharp](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/), [NASA Worldview](https://worldview.earthdata.nasa.gov/) (Earth reference only), [Perseverance raw images gallery](https://mars.nasa.gov/mars2020/multimedia/raw-images/).

**Jezero data used by the app:**

| Data | Source |
|---|---|
| Perseverance route and stops | M20_waypoints.json (NASA MMGIS viewer) |
| Regional relief for distant terrain (MOLA MEGDR, 128 px/°, ~463 m) | megt44n000hb.img + PDS label (NASA PDS Geosciences) |
| Relief (20 m CTX-controlled DTM) | USGS Astrogeology, Mars 2020 Terrain Relative Navigation |
| Controlled HiRISE mosaic (25 cm) | Mars Trek WMTS |
| Controlled CTX mosaic (6 m) | Mars Trek WMTS |
| Regional CTX mosaic (preliminary) | Mars Trek WMTS |
| Night cold (THEMIS IR night, 100 m) | Mars Trek WMTS |
| Color MOLA relief base | Mars Trek WMTS |
| Color Viking base | Mars Trek WMTS |
| Perseverance photos by sol | NASA raw_images API |
| Perseverance 3D model (glTF) | 25042_Perseverance.glb (NASA/JPL-Caltech) |
| NASA career radiation limit (600 mSv) | NASA-STD-3001, Vol. 1, Rev. B (2022) |
| Earth natural radiation (2.4 mSv/year) | UNSCEAR 2008 report |
| Radiation reference dose | Hassler et al. (2014), Science 343, doi:10.1126/science.1244797 |

Mars Trek layer catalog search (useful to find more layers for an area): [example with "jezero"](https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=20&key=jezero&proj=urn:ogc:def:crs:EPSG::104905).

**Jezero climate (pending integration):**
- Public MEDA feed (Perseverance): covers only a few sols.
- MEDA on NASA PDS (Atmospheres node): full dataset.

**Gale (archive, no longer used by the app):**
- MSL waypoints and traverse (Curiosity route).
- REMS weather feed (Curiosity).
- Curiosity raw images API.

**Data credits:** NASA/JPL-Caltech, USGS Astrogeology, University of Arizona (HiRISE), Malin Space Science Systems (CTX), Arizona State University (THEMIS), NASA Goddard Space Flight Center (MOLA).

## Credits & References

**Data and imagery:** NASA/JPL-Caltech, USGS Astrogeology, University of Arizona (HiRISE), Malin Space Science Systems (CTX), Arizona State University (THEMIS), NASA Goddard Space Flight Center (MOLA). Public NASA data; review the terms of use of each source.

**Software:** Leaflet 1.9.4, Three.js 0.160, Barlow and Barlow Condensed fonts (Google Fonts).

**References:**
- NASA-STD-3001, Vol. 1, Rev. B (2022) — NASA spaceflight human-system standard (600 mSv career limit).
- UNSCEAR 2008 report — Earth natural radiation (2.4 mSv/year).
- Hassler et al. (2014), *Mars' Surface Radiation Environment Measured with the MSL Curiosity Rover*, Science 343 — doi:10.1126/science.1244797.

**Team workflow:** see `docs/team-workflow.md`. **Presentation script:** see `docs/presentacion.md`. **Grid data contract:** see `docs/grid-data-contract.md`. **Data details:** see `data/jezero/README.md` and `data/gale/README.md`.
