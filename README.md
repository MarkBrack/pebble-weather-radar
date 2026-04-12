# Rain Radar for Pebble

A rain radar app for the **Pebble Time 2 (Emery)** smartwatch. It displays a live rain radar overlay on top of an OpenStreetMap base map, centred on your location.

## Features

- **Live rain radar** from [RainViewer](https://www.rainviewer.com/) overlaid on OpenStreetMap tiles
- **Multiple time steps** — stores up to 8 recent radar frames on the watch for animation
- **Frame navigation** — use the Up/Down buttons to step through past and nowcast radar frames
- **Two crop modes** — Wide (full display) and Standard (square crop), toggled with Select
- **Frame position indicator** — shows current frame number when multiple frames are loaded
- **Automatic refresh** every 4 minutes

## Target Hardware

- **Platform:** Pebble Time 2 (`emery`)
- **Display:** 200×228 colour (64-colour palette)

## How It Works

The app is split between the phone (PebbleKit JS) and the watch (Moddable XS JavaScript runtime).

### Phone Side

1. Fetches the user's GPS location (falls back to a hardcoded default)
2. Downloads OpenStreetMap raster tiles and assembles a base map centred on the location
3. Fetches the latest radar timestamps from the RainViewer API (up to 8 past frames plus nowcast)
4. Renders the background map once — remaps colours to the Pebble 64-colour palette, applies a wash for readability, draws a centre crosshair, and RLE-encodes the result
5. For each radar time step, fetches the radar tile, classifies rain intensity into a compact 6-level palette, and RLE-encodes the overlay
6. Sends the background as chunked messages, then sends each radar frame as chunked messages, followed by a batch-done signal

### Watch Side

1. Receives and stores background chunks (kept in memory as small ArrayBuffers to avoid large allocations)
2. Receives and stores each radar frame's chunks separately
3. On batch completion, composites the display: decodes the background RLE stream, then overlays the current radar frame using the rain palette
4. Up/Down buttons navigate between stored frames; the display recomposites on each navigation step

### Rain Intensity Palette

| Level    | Colour on watch |
|----------|----------------|
| Drizzle  | Light cyan     |
| Light    | Blue           |
| Moderate | Dark blue      |
| Heavy    | Yellow         |
| Intense  | Orange         |
| Extreme  | Dark red       |

## Building

Requires the Pebble SDK (4.x with Moddable XS support).

```bash
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
