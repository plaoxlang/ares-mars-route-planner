# ARES presentation (~4 minutes)

Script for pitching the project at the hackathon using the presentation built into the app.

## How to launch it

1. Open the app (`index.html` or `3d.html`) on the presentation computer. You need an internet connection: map tiles, the 3D model and Three.js are loaded from outside.
2. Click **Presentation** in the header and pick a mode:
   - **Automatic:** each scene runs for its set time and advances on its own (about 4 minutes in total).
   - **Step by step:** each scene plays its animation and waits for you to advance.

Switch modes at any time with the `A` key. The presentation moves from the map to 3D on its own, and the route computed on the map is the one shown in 3D.

| Key | Action |
| --- | --- |
| `→` · `Page Down` · `Enter` | Next scene |
| `←` · `Page Up` | Previous scene |
| `Space` | Pause / resume (automatic) · next (step by step) |
| `A` | Automatic ↔ step by step |
| `N` | Speaker notes on the card |
| `Esc` | Exit |

A presentation clicker (one that sends `Page Down` / `Page Up`) works with no setup.

**Tips**
- Run it once before you present: the browser caches the tiles and the rover model (11.7 MB), so the switch to 3D is faster.
- Browser full screen (`F11`) and zoom at 100%.
- The clock on the card (`1:23 / 4:00`) counts presentation time only, not pauses.

## Script

What appears on screen is on the card. Below it is what you can say (the same text you get with `N`).

### 2D map

**1 · Planning a drive across Mars (13 s).** View of Jezero.
> A crew on Mars needs to know where to go, how long it will take and what risks they face. ARES answers that on the real terrain of Jezero Crater, where Perseverance landed in 2021. It was a lake 3.5 billion years ago. All built on open NASA and USGS data, and all in the browser.

**2 · What the orbiters see (18 s).** Zooms in and switches MOLA → CTX → HiRISE in the layer bar.
> The layers are always in view. MOLA is laser altimetry of the whole planet, at 463 m per pixel. CTX covers the whole area at 6 m. HiRISE, the most powerful camera in orbit, gets down to 25 cm: you can make out one-meter boulders.

**3 · Elevation and slope, computed right here (18 s).** Elevation layer, then slope.
> We use the USGS 20 m digital terrain model, built from stereo pairs to guide the landing. Slope is its gradient at a scale of about 60 m, computed in the browser. Green below 8°, amber up to 15° and red above: the same thresholds across the whole app.

**4 · Where the night bites hardest (13 s).** Night cold layer.
> This is nighttime infrared from THEMIS: sand and dust lose their heat faster than rock. We give a relative value, "colder than X% of the area", because there is no measured temperature at every point. Only the rover's MEDA weather station measures it, and only on a handful of sols.

**5 · Click A, click B (24 s).** A cursor marks A (the delta) and B (the crater rim) and three routes appear.
> We mark the start and the destination and the routes are computed instantly: A* search over 460,000 cells of 20 m, in 8 directions, with three alternatives in parallel, each on its own thread. We go from the ancient river delta to the crater rim: almost 6 km and over 600 m of climb, in a NASA SEV-type pressurized rover.

**6 · Fast, safe or efficient (21 s).** Selects each alternative in turn.
> Just like Google Maps. Fastest minimizes time, and speed drops with slope and rough terrain. Safest penalizes slopes and roughness, even if it ends up longer. Least energy accounts for rolling resistance and hauling 3,000 kg of vehicle uphill. None of them crosses slopes above 18°, the vehicle's limit. We pick the safest one.

**7 · The route, minute by minute (10 s).** Plays the route on the timeline.
> The profile at the bottom is the timeline: route elevation colored by slope, with the T+ mission clock. Now let's see it in 3D.

### 3D view

**8 · The real terrain, in 3D (18 s).** Flyover of the area.
> The mesh is the 20 m terrain model, with elevation exaggerated ×2. The white rectangle is our study area. Outside it, MOLA terrain and blurred imagery for context. The blue route is the one we just computed.

**9 · The dose that reaches the ground (18 s).** Radiation layer.
> We start from the 0.64 mSv per day measured by the RAD detector on Curiosity, about 100 times the natural dose on Earth. The dose drops where terrain blocks the sky and rises where there is less atmosphere overhead. We compute the visible sky in 16 directions out to 3 km. It is a model, not a measurement, and the route adds up its dose segment by segment.

**10 · Behind the wheel, on the route (22 s).** The camera swoops down behind the rover and it starts driving.
> This is NASA's official 3D model of Perseverance, at true scale. The rocker-bogie suspension is simulated: every wheel rides on the terrain and the ground's micro-relief, and we see pitch and roll live. The rover shakes, kicks up dust and leaves tracks. The line on the ground is the planned path, colored by slope.

**11 · Through the rover's camera (13 s).** POV view.
> From the mast Navcam. The nearby ground is HiRISE at 25 cm with procedural detail, and it regenerates as we drive. The minimap shows where we are on the route.

**12 · A Martian sunset (14 s).** Time of day advances to sunset.
> The Sun is computed for Jezero's latitude. At sunset the sky turns blue around the Sun: dust scatters blue light forward. It is the opposite of Earth.

**13 · GO or NO-GO? (21 s).** Mission report in the side panel.
> The report brings together time, range, battery, slopes, night cold and the accumulated dose against NASA's career limit of 600 mSv. It gives a GO, CAUTION or NO-GO verdict with the reasons: that is the answer for the crew.

**14 · Thank you (12 s).** Overview.
> Satellite layers, A → B routes with three alternatives, 3D with the rover and a mission report. All on open data and all in the browser. Questions?

## If something goes wrong

- **3D is slow to load:** the presentation waits up to 6 s for the terrain imagery and then carries on. You can pause with `Space` while it loads.
- **No connection:** no tiles and no 3D model. Bring a backup video recorded with the presentation in automatic mode.
- **You skip a scene:** each scene sets up its own state (layers, route, view), so you can go back and forth freely.
