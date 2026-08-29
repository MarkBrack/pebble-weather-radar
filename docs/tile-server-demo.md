# Pebble vector tile server demo

This demo turns OpenStreetMap Shortbread vector tiles into deliberately simple
256×256 indexed PNG slippy tiles for the Pebble companion. It renders only five
exact Pebble palette colours:

- green land
- white ocean and inland water
- pale-green major roads with dark-green casings
- black major-city markers and labels

The source layers are semantic, so Lake Como and the sea are rendered with the
same water colour without guessing from raster pixels.

## Run with Docker

```bash
docker compose up --build
curl -o lake-como.png http://localhost:8080/tiles/v1/8/134/90.png
```

The first request fetches and renders the upstream vector tile. Later requests
come from the persistent Docker volume. `X-Tile-Cache` reports `MISS` or `HIT`.

To run without Docker:

```bash
cd tile-server
npm install
npm test
npm run demo:lake-como
npm start
```

## Endpoint

```text
GET /tiles/v1/{z}/{x}/{y}.png
```

Zoom is limited to the Shortbread service's native range of 0–14. Invalid
coordinates return HTTP 400. Responses include an ETag, public cache headers,
and `© OpenStreetMap contributors` attribution metadata. The app UI or store
listing must also display the attribution where users can see it.

Configuration:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `CACHE_DIR` | `.cache/tiles` | Rendered PNG cache |
| `OSM_VECTOR_TILE_URL` | official Shortbread v1 template | Configurable MVT source |
| `OSM_USER_AGENT` | project name and contact email | Honest upstream identification |
| `UPSTREAM_CACHE_SECONDS` | `604800` | Cache lifetime, with a seven-day minimum |

## Rendering and cache flow

```text
Pebble companion
      |
      v
/tiles/v1/z/x/y.png
      |
      +-- fresh PNG cache --------------------> response
      |
      +-- miss -> Shortbread MVT -> SVG -> five-colour PNG
                                      |
                                      +-------> atomic cache write -> response
```

Concurrent misses for the same coordinate share one render operation. Cache
keys include the style version so a palette or styling change can be deployed
without mixing old and new tiles.

## Demo scope and production boundary

The default upstream is appropriate for a small, interactive proof of concept,
not bulk generation. The service does not prefetch. It identifies itself and
caches every downloaded tile for at least seven days, following the
[OSM vector tile policy](https://operations.osmfoundation.org/policies/vector/).

OSM explicitly does not recommend placing general-purpose caching proxies in
front of its public service. This demo is a transforming renderer, but before a
public launch we should either confirm the expected traffic is acceptable, use
another Shortbread provider, or generate/host our own regional vector source.
The upstream URL is therefore configurable.

## Next integration step

Add a `pebble_server` map style in `src/pkjs/render.js` whose URL is the server
endpoint. The existing tile assembly code can consume these PNGs unchanged.
Keep the current raster source behind a feature flag until Lake Como, a coast,
London, and a rural fixture have been checked on the physical watch.
