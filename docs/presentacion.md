# Presentación de ARES (~4 minutos)

Guion para exponer el proyecto en el hackathon con la presentación integrada en la app.

## Cómo lanzarla

1. Abre la app (`index.html` o `3d.html`) en el ordenador de la exposición. Hace falta conexión a internet: teselas, modelo 3D y Three.js se cargan desde fuera.
2. Pulsa **Presentación** en la cabecera y elige un modo:
   - **Automática:** cada escena dura lo previsto y pasa sola (unos 4 minutos en total).
   - **Paso a paso:** cada escena hace su animación y espera a que avances.

Se cambia de modo en cualquier momento con la tecla `A`. La presentación pasa sola del mapa al 3D y la ruta calculada en el mapa es la que se ve en 3D.

| Tecla | Acción |
| --- | --- |
| `→` · `Av Pág` · `Intro` | Escena siguiente |
| `←` · `Re Pág` | Escena anterior |
| `Espacio` | Pausa / continúa (automática) · siguiente (paso a paso) |
| `A` | Automática ↔ paso a paso |
| `N` | Notas del presentador en la tarjeta |
| `Esc` | Salir |

Un mando de presentaciones (que envía `Av Pág` / `Re Pág`) funciona sin configurar nada.

**Consejos**
- Ábrela una vez antes de exponer: el navegador guarda en caché las teselas y el modelo del rover (11,7 MB), y el paso al 3D tarda menos.
- Pantalla completa del navegador (`F11`) y zoom al 100 %.
- El reloj de la tarjeta (`1:23 / 4:00`) cuenta solo el tiempo de presentación, sin pausas.

## Guion

Lo que se ve en pantalla está en la tarjeta. Debajo, lo que se puede decir (lo mismo que aparece con `N`).

### Mapa 2D

**1 · Planificar una travesía en Marte (13 s).** Vista de Jezero.
> Una tripulación en Marte necesita saber por dónde ir, cuánto tardará y qué riesgos corre. ARES lo responde sobre el relieve real del cráter Jezero, donde aterrizó Perseverance en 2021. Fue un lago hace 3.500 millones de años. Todo con datos abiertos de NASA y USGS, y todo en el navegador.

**2 · Lo que ven los satélites (18 s).** Se acerca y va activando MOLA → CTX → HiRISE en la barra de capas.
> Las capas están siempre a la vista. MOLA es la altimetría láser de todo el planeta, a 463 m por píxel. CTX cubre toda la zona a 6 m. HiRISE, la cámara más potente en órbita, llega a 25 cm: se distinguen rocas de un metro.

**3 · Altura y pendiente, calculadas aquí (18 s).** Capa de altura y después de pendiente.
> Usamos el modelo digital del terreno de 20 m de USGS, hecho con pares estéreo para guiar el aterrizaje. La pendiente es su gradiente a escala de unos 60 m, calculado en el navegador. Verde por debajo de 8°, ámbar hasta 15° y rojo por encima: los mismos umbrales en toda la app.

**4 · Dónde aprieta el frío de noche (13 s).** Capa de frío nocturno.
> Es el infrarrojo nocturno de THEMIS: la arena y el polvo pierden el calor antes que la roca. Damos un valor relativo, "más frío que el X % de la zona", porque no hay temperatura medida en cada punto. Solo la estación MEDA del rover la mide, y en pocos soles.

**5 · Clic en A, clic en B (24 s).** Un cursor marca A (delta) y B (borde del cráter) y aparecen tres rutas.
> Marcamos origen y destino y las rutas se calculan al momento: algoritmo A* sobre 460.000 celdas de 20 m, en 8 direcciones, con tres alternativas en paralelo, cada una en un hilo. Vamos del delta del antiguo río al borde del cráter: casi 6 km y más de 600 m de subida, con un rover presurizado tipo SEV de NASA.

**6 · Rápida, segura o eficiente (21 s).** Selecciona cada alternativa.
> Como en Google Maps. La más rápida minimiza el tiempo, y la velocidad baja con la pendiente y el terreno irregular. La más segura penaliza pendientes y rugosidad aunque sea más larga. La de menos energía cuenta la rodadura y subir 3.000 kg de vehículo. Ninguna pasa por pendientes de más de 18°, el límite del vehículo. Elegimos la más segura.

**7 · La ruta, minuto a minuto (10 s).** Reproduce la ruta en la barra de tiempo.
> El perfil de abajo es la barra de tiempo: la altura de la ruta coloreada por pendiente, con el reloj de misión T+. Ahora la vemos en 3D.

### Vista 3D

**8 · El relieve real, en 3D (18 s).** Vuelo sobre la zona.
> La malla es el modelo del terreno de 20 m, con la altura exagerada al doble. El rectángulo blanco es nuestra zona de estudio. Fuera, relieve MOLA y la imagen desenfocada para dar contexto. La ruta azul es la que acabamos de calcular.

**9 · La dosis que llega al suelo (18 s).** Capa de radiación.
> Partimos de los 0,64 mSv al día que midió el detector RAD de Curiosity, unas 100 veces la dosis natural en la Tierra. La dosis baja donde el relieve tapa cielo y sube donde hay menos atmósfera encima. Calculamos el cielo visible en 16 direcciones hasta 3 km. Es un modelo, no una medida, y la ruta acumula su dosis tramo a tramo.

**10 · Al volante, sobre la ruta (22 s).** La cámara baja en vuelo hasta detrás del rover y arranca.
> Es el modelo 3D oficial de Perseverance, a escala real. La suspensión rocker-bogie está simulada: cada rueda pisa el relieve y el microrrelieve del suelo, y vemos cabeceo y alabeo en directo. El rover vibra, levanta polvo y deja huellas. La línea del suelo es la trazada, coloreada por la pendiente.

**11 · Desde la cámara del rover (13 s).** Vista POV.
> Desde la Navcam del mástil. El suelo cercano es HiRISE a 25 cm con detalle procedimental y se regenera mientras avanzamos. El minimapa sitúa la ruta.

**12 · Un atardecer marciano (14 s).** La hora avanza hasta la puesta de sol.
> El Sol se calcula para la latitud de Jezero. Al atardecer el cielo se vuelve azul alrededor del Sol: el polvo dispersa el azul hacia delante. Es al revés que en la Tierra.

**13 · ¿GO o NO-GO? (21 s).** Informe de misión en la ficha.
> El informe reúne tiempo, autonomía, batería, pendientes, frío nocturno y la dosis acumulada frente al límite de carrera de NASA, 600 mSv. Da un veredicto GO, PRECAUCIÓN o NO-GO con sus motivos: es la respuesta para la tripulación.

**14 · Gracias (12 s).** Vista general.
> Capas de satélite, rutas A → B con tres alternativas, 3D con el rover y un informe de misión. Todo con datos abiertos y en el navegador. ¿Preguntas?

## Si algo falla

- **El 3D tarda en cargar:** la presentación espera hasta 6 s a la imagen del terreno y sigue. Se puede pausar con `Espacio` mientras carga.
- **Sin conexión:** no hay teselas ni modelo 3D. Lleva un vídeo de respaldo grabado con la presentación en modo automático.
- **Te saltas una escena:** cada escena prepara su propio estado (capas, ruta, vista), así que se puede ir adelante y atrás libremente.
