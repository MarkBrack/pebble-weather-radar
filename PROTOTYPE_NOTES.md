# Rain Radar Prototype Notes

## Goal

Build and validate a browser demo that answers one question well:

- show a small local map centered on the user
- overlay current rain radar
- crop it to Pebble-sized output
- prove the image pipeline before reducing it to the essentials for the Pebble app

Working target for the Pebble app:

- `emery`
- Pebble Time 2
- `200x228` color display

The main demo file is:

- [rainviewer_osm_overlay_test (6).html](/mnt/d/Personal/pebble/rain-radar/rainviewer_osm_overlay_test%20%286%29.html)

The early Pebble app implementation already exists, but this doc is about the HTML prototype and what should be ported from it.

Current Pebble port alignment notes:

- keep the watch target as `emery`
- use `OSM Standard` tiles in the Pebble app
- use the map remap colours and thresholds from [rainviewer_osm_overlay_test (6).html](/mnt/d/Personal/pebble/rain-radar/rainviewer_osm_overlay_test%20%286%29.html)
- when the JS port differs from the HTML prototype, prefer the HTML prototype unless we explicitly decide otherwise
- verify the phone-side render before sending to the watch by running `node scripts/render_debug.js --crop=standard` or `node scripts/render_debug.js --crop=wide`
- the debug render writes intermediate artifacts into `build/` so tile assembly and final Pebble output can be inspected separately

## Current Demo

The demo runs in the browser and fetches:

- latest RainViewer frame metadata from `https://api.rainviewer.com/public/weather-maps.json`
- public raster basemap tiles
- a single centered RainViewer radar image

Then it:

- builds a local basemap around the selected lat/lon
- overlays radar centered on the same location
- crops to Pebble output
- optionally animates through past radar frames

Recommended way to run it:

```bash
cd /mnt/d/Personal/pebble/rain-radar
python3 -m http.server 39689
```

Then open:

```text
http://localhost:39689/rainviewer_osm_overlay_test%20(6).html
```

## Defaults

Current defaults in the demo:

- latitude: `54.623430`
- longitude: `-1.302022`
- map zoom: `9`
- radar zoom cap: `7`
- Pebble crop: `Standard`
- basemap style: `OSM Standard`
- map detail: `Native`
- composite size: `512`
- map wash: `0.55`
- radar color: `2`
- radar options: `1_1`

## What The Demo Supports

### Core controls

- `Use My Location`
- `Fetch Latest RainViewer Frame`
- `Render Prototype`
- `Download Pebble Crop`

### View controls

- `Map zoom`
- `Radar zoom cap`
- `Pebble crop`
  - `Standard`
  - `Wide`
- `Basemap style`
  - `CARTO Light No Labels`
  - `CARTO Voyager No Labels`
  - `Stadia Alidade Smooth`
  - `OSM Standard`
- `Map detail`
  - `Native`
  - `Sharper (+1 zoom)`

### Render controls

- `Composite size`
- `Map wash`
- `Radar color`
- `Radar options`
- `Show Pebble crop box on composite`

### Animation controls

- `Enable past-to-now radar animation`
- `Start Animation`
- `Next Frame`

## Current Render Pipeline

### Map

The map is built from raster tiles around the user’s location.

Important details:

- tile provider is selectable
- we now fetch only the tile coverage needed for the active Pebble crop mode
- for the Pebble app we are building for `emery`, so the live watch crop is `200x228`
- `Standard` crop in older notes referred to a smaller `144x168` Pebble-sized source crop from earlier experiments
- `Wide` crop in older notes referred to a `288x336` source crop from those same experiments

This was an important optimization. Earlier versions fetched a much larger fixed area and wasted requests.

### Radar

Radar is not tiled.

The demo uses a single centered RainViewer image:

```text
https://tilecache.rainviewer.com{path}/{size}/{z}/{lat}/{lon}/{color}/{options}.png
```

Important details:

- one centered radar image only
- map and radar zoom are decoupled
- radar zoom is capped by `radar zoom cap`
- if map zoom is above radar zoom, radar is rescaled around the center so rain stays in the correct geographic place

### Composite and crop

The demo builds a square composite and then extracts a Pebble crop.

Two crop modes exist:

- `Standard`
  - source crop: `144x168`
  - output: `144x168`
- `Wide`
  - source crop: `288x336`
  - output: scaled down to `144x168`

The wide mode does not request a more zoomed-out map anymore. It just uses a larger crop from the same composite.

That is the correct approach for this prototype.

## Animation

The demo can animate through RainViewer `radar.past` frames.

Current behavior:

- pulls the available past frames from `weather-maps.json`
- steps oldest to newest
- uses the same base map and only swaps radar frames
- shows a local-time `HH:MM` badge on the Pebble crop

When not animating, the latest frame time badge is still shown.

## Debugging Aids In The Demo

The prototype includes:

- exact OSM tile URLs
- exact RainViewer URL
- metadata panel
- debug overlay showing crop spans
- red crop box on the composite
- time badge on the Pebble crop

These are useful for prototype work, but most of them should not be ported into the Pebble app.

## Important Findings

### 1. No-label basemap works better for Pebble

Standard labeled OSM tiles look bad at tiny output sizes because labels blur badly.

Best current default:

- the HTML demo can still compare multiple basemaps
- the current Pebble app target should use `OSM Standard` because that is the source we want to tune against now

Reason:

- keeps coastlines and road context
- avoids unreadable labels
- looks cleaner after crop/downscale

### 2. Crop mode is better than zooming out map requests

For the Pebble use case, a second wider view should come from a larger crop window, not by pretending the map zoom changed.

This preserves:

- same center
- same geographic alignment
- simpler reasoning

### 3. Native vs sharper map detail should stay optional for now

Two map strategies exist:

- `Native`
  - fetch tiles at `mapZoom`
  - fewer requests
  - more honest to target output size
- `Sharper (+1 zoom)`
  - fetch tiles at `mapZoom + 1`
  - potentially cleaner linework
  - more detail and processing

For Pebble, `Native` may be enough and is the cheaper baseline.

### 4. Radar must scale with map zoom difference

If the radar image is fetched at zoom `7` and the map is shown at zoom `9`, the radar must be drawn scaled by:

```text
2^(mapZoom - radarZoom)
```

Without that, the rain appears to float independently from the basemap.

### 5. Only fetch the map area we actually need

This is now implemented.

Observed effect:

- `Standard` crop can render with as few as `4` map tiles
- `Wide` crop can render with `12` map tiles

This is much better than the older fixed larger fetch.

## Recommended Features To Port Into The Pebble App

These are the essentials worth carrying over:

- centered local map
- single centered RainViewer radar image
- map/radar zoom decoupling with radar cap
- correct radar scaling when map zoom exceeds radar zoom
- no-label basemap default
- two Pebble crop modes
  - `Standard`
  - `Wide`
- optional animation through past radar frames
- local frame time label in `HH:MM`

## Features Probably Not Worth Porting

These are good for the prototype, but probably not needed in the watch app:

- basemap style selector
- map detail selector
- raw URL/debug panels
- crop-box debug outline
- direct manual lat/lon editing in the final watch UI
- download button

## Suggested Pebble App Cut-Down

If we reduce the prototype to the practical Pebble feature set, the watch app should likely keep:

- current location
- map zoom: maybe only one or two useful levels
- crop mode:
  - `Standard`
  - `Wide`
- optional radar animation on/off
- frame time displayed on screen

Phone-side JS should likely fix:

- basemap style to `CARTO Light No Labels`
- map detail default to `Native` unless testing shows `Sharper` is clearly worth it
- radar color and options to the chosen stable values

## Current Pebble Port Status

There is already a started Pebble app in:

- [main.c](/mnt/d/Personal/pebble/rain-radar/src/c/main.c)
- [index.js](/mnt/d/Personal/pebble/rain-radar/src/pkjs/index.js)

But the HTML prototype is now the clearer source of truth for:

- crop behavior
- optional animation behavior
- basemap choice
- minimal request strategy

The next Pebble iteration should port the reduced feature set from this doc, not every control from the prototype.

## Current Architecture Notes

- Target watch remains `emery` / Pebble Time 2.
- Basemap source remains `OSM Standard`.
- Color remap and radar compositing remain defined by `rainviewer_osm_overlay_test (6).html`.
- Production renderer remains phone-side in PKJS so OSM fetch, remap, crop, radar overlay, and quantization all happen before watch transfer.
- Watch app is now structured as Alloy/embeddedjs:
  - `src/embeddedjs/main.js` owns buttons, AppMessage reads/writes, frame assembly, and redraw scheduling.
  - `src/c/mdbl.c` is only window/bootstrap.
  - `src/c/dynamic-pebble-bitmap.c` is a minimal native bitmap wrapper so embeddedjs/Poco can draw the completed 8-bit Pebble frame.
- JS-side debug images must continue to be checked before blaming the watch transfer path.
