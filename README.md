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
