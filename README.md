# ares-mars-route-planner
Mars route planning for the NASA Space Apps Challenge

Prototipo de mapa de ruta para una excursión humana en Marte, construido sobre la ruta real de Curiosity en el cráter Gale / Mount Sharp. Todavía no planifica rutas: reúne y muestra los datos que un algoritmo de rutas necesitará (relieve, pendiente, frío, radiación) y la ruta de referencia del rover.

## Arrancar

Es una web estática. Hay que servirla con un servidor local, porque el navegador no deja cargar los JSON si se abre el HTML directamente:

```bash
python -m http.server 8010
```

Después abre <http://localhost:8010>. Necesita conexión a internet: las teselas de mapa y Three.js se cargan desde fuera.

## Vistas

**Mapa 2D** (`index.html`): Leaflet con la proyección de Marte.
- Capas base MOLA y Viking. Encima: mosaicos CTX y HiRISE de Gale, relieve HiRISE y frío nocturno relativo (THEMIS).
- Ruta completa de Curiosity, con las paradas coloreadas por inclinación del rover o por temperatura mínima.
- Barra de tiempo con reproducción y perfil de elevación interactivo.
- Fotos del rover del sol de cada parada.
- Clima REMS por parada y avisos de frío con umbrales editables.

**Vista 3D** (`3d.html`): Three.js.
- Relieve de Gale a partir del DEM de Mars Trek, calibrado con las alturas reales de la ruta (error medio ±5,9 m).
- Vistas: general, cenital (2D) y astronauta (a ras de suelo).
- Exageración vertical ajustable.
- Capas del terreno:
  - Satélite HiRISE + CTX
  - Satélite en color (aproximado)
  - Altura en color
  - Pendiente
  - Frío nocturno relativo (THEMIS)
  - **Radiación estimada**

Las dos vistas comparten la parada seleccionada (`#i=123` en la URL).

### Limitaciones a tener en cuenta
- **Relieve:** el DEM de Mars Trek viene en 8 bits (~18,6 m por nivel). Sirve para ver el relieve general, no para detalle de metros. La pendiente es una media a escala de ~300 m.
- **Temperatura:** REMS mide el clima del sol en que pasó el rover, es decir, el *momento*. THEMIS es *relativo* (dónde se enfría más de noche), no son grados.
- **Radiación:** es un **modelo**, no una medida. Parte de 0,64 mSv/día (RAD, Hassler et al. 2014) y lo ajusta por el cielo visible y la altitud. No incluye el ciclo solar ni tormentas solares. Los parámetros están en `RAD` dentro de `scene3d.js`.
- **Umbrales de frío:** los valores (aire < −80 °C, suelo < −100 °C) son de ejemplo. Hay que fijarlos con los límites reales del traje.

## Código

| Archivo | Qué hace |
|---|---|
| `index.html`, `app.js` | Mapa 2D |
| `3d.html`, `scene3d.js` | Vista 3D: relieve, capas, radiación estimada |
| `shared.js` | Utilidades comunes: teselas, colores, clima REMS, avisos |
| `styles.css` | Estilos (tema oscuro) |
| `scripts/` | Descarga y regeneración de los datos (Node 18+) |

## Datos

En [`data/`](data/README.md) están la ruta de Curiosity, el perfil de elevación, el índice de fotos y el clima REMS por sol. Ahí también se documentan las fuentes en vivo de NASA y cómo regenerarlo todo.
