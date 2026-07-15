# Rain Radar for Pebble

A rain radar app for the **Pebble Time 2 (Emery)** smartwatch. It displays a live rain radar overlay on top of an OpenStreetMap base map, centred on your location.

![Rain Radar in action](radar-gif.gif)

## Features

- **Live rain radar** from [RainViewer](https://www.rainviewer.com/) overlaid on OpenStreetMap tiles
- **Multiple time steps** — stores up to 3 recent radar frames, within a strict memory budget
- **Frame navigation** — use the Up/Down buttons to step through recent radar frames
- **Two crop modes** — Wide (zoom  out) and Standard (zoomed in), toggled with Select
- **Frame position indicator** — shows current frame when multiple frames are loaded

## Target Hardware

- **Platform:** Pebble Time 2 (`emery`)
- **Display:** 200×228 colour (64-colour palette)

## How It Works

The app is split between the phone (PebbleKit JS) and the watch (Moddable XS JavaScript runtime).

### Phone Side

1. Fetches the user's GPS location (falls back to a hardcoded default)
2. Downloads OpenStreetMap raster tiles and assembles a base map centred on the location
3. Fetches the latest radar timestamps from the RainViewer API (up to 3 candidates)
4. Renders the background map once — remaps colours to the Pebble 64-colour palette, applies a wash for readability, draws a centre crosshair, and PackBits RLE-encodes the result
5. For each radar time step, fetches the radar tile, classifies rain intensity into a compact 6-level palette, and PackBits RLE-encodes the overlay
6. Sends the background as chunked messages, then sends each radar frame as chunked messages, followed by a batch-done signal

### Watch Side

1. Receives the background into one exactly-sized native RLE buffer
2. Receives each accepted radar frame into its own exactly-sized native RLE buffer
3. On batch completion, composites the display: decodes the background RLE stream, then overlays the current radar frame using the rain palette
4. Up/Down buttons navigate between stored frames; the display recomposites on each navigation step

### Memory model

The watch never keeps a raw 200×228 image for each time step. It retains the
compressed background and radar overlays, then decodes the selected pair
directly into the display only when it needs to draw.

PackBits uses literal blocks as well as repeated runs. A frame containing
45,600 pixels therefore has a provable maximum encoded size of 45,957 bytes;
the earlier pair-only RLE could grow to 91,200 bytes on rapidly changing
colours. The watch enforces a 56,000-byte total retained-frame budget and the
phone sends the newest frames that fit.

Retained RLE data uses native, exactly-sized allocations. The XS runtime is
reserved only 16 KB for transient chunks, 12 KB for object slots, and 6 KB for
the stack. This removes the previous 64 KB startup reservation that could fail
after an OS update.

### Rain Intensity Palette

| Level    | Colour on watch |
|----------|----------------|
| Drizzle  | Light cyan     |
| Light    | Blue           |
| Moderate | Dark blue      |
| Heavy    | Yellow         |
| Intense  | Orange         |
| Extreme  | Dark red       |

## Building and testing

The Pebble SDK and CLI must be installed inside WSL. From Windows PowerShell:

```powershell
npm test
npm run build:watch
# Force a clean Pebble build when needed:
powershell -ExecutionPolicy Bypass -File scripts/build-watch.ps1 -Clean
```

The build script converts the Windows checkout path to its WSL mount, verifies
that `pebble` is available inside WSL, and runs the build there. The deployable
bundle is written to `build/rain-radar.pbw`.

From a WSL shell, the equivalent commands are:

```bash
cd /mnt/d/Personal/pebble/rain-radar
pebble build
pebble install --emulator emery --logs
```

## Project Structure

```
src/
  c/           — C entry point (boots Moddable XS with custom heap config)
  embeddedjs/  — Watch-side JavaScript (main app, RLE decoders)
  pkjs/        — Phone-side PebbleKit JS (fetch, render, send pipeline)
scripts/       — Debug/render helpers
```

## Data Sources

- **Base map:** [OpenStreetMap](https://www.openstreetmap.org/) raster tiles
- **Radar:** [RainViewer API](https://www.rainviewer.com/api.html) (free public weather radar)
