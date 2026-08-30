# Pebble vector tile server demo

This demo turns OpenStreetMap Shortbread vector tiles into deliberately simple
watch-sized indexed PNG maps for the Pebble companion. It renders only five
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

For the small Ada deployment, `compose.yaml` binds the container only to
`127.0.0.1:8081`. Tailscale Funnel exposes only
`https://ada.tailadb379.ts.net:8443/weather-radar`; the existing Ada site stays
Tailnet-only on Tailscale Serve port 443. Run `deploy.sh` to create a private
`.env` token on first use and start or update the container. The token is
retained across redeploys.

To run without Docker:

```bash
cd tile-server
npm install
npm test
npm run demo:lake-como
npm start
```

## Test on a phone and watch

The production tile URL is built into the app and is not user-configurable. To
test it:

1. Start the server with `npm start` from `tile-server/` and leave it running.
2. Find the computer's LAN address and verify on the phone that a URL such as
   `http://<computer-ip>:8080/maps/v1/wide/8/54.623/-1.302.png` displays a map.
3. Run `pebble build`, then install `build/pebble-weather-radar.pbw` on the test
   phone/watch in the usual way.
4. For the lake test, enable manual location and enter latitude `45.99` and
   longitude `9.26`.

The build reads `TILE_SERVER_TOKEN` from the environment or the ignored
`tile-server/.env` file and generates an ignored PebbleKit JS module. The token
is bundled into the PBW without entering Git history. If the production server
is slow or unavailable, the app automatically falls back to public OSM raster
tiles for that refresh.

## Endpoints

```text
GET /maps/v2/{standard|wide}/{z}/{latitude}/{longitude}.png
GET /tiles/v2/{z}/{x}/{y}.png
GET /tiles/v2-wide/{z}/{x}/{y}.png
```

The app uses the viewport endpoint, which returns the final 200×228 map in one
request. Standard renders the visible geographic area directly. Wide assembles a
400×456 source and downsamples it to the watch size, preserving the existing
wider-area behaviour.

The server builds each viewport from cached, label-free 256×256 base tiles. It
then considers labels from every intersecting vector tile together, places them
inside the final watch boundary, avoids overlaps, and draws them only after the
map has been cropped. Consequently, an internal slippy-tile edge can no longer
clip a place name. The slippy endpoints remain available for diagnostics.

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
| `TILE_SERVER_TOKEN` | unset | Optional fixed token required in the `X-Tile-Token` request header |
| `METRICS_TOKEN` | unset | Enables `/internal/metrics`, requiring the `X-Metrics-Token` header |

## Internal request metrics

`GET /internal/metrics` returns persistent totals and UTC daily counts for
watch viewport requests, diagnostic slippy-tile requests, cache hits and misses,
render errors, and unauthorised requests. The daily history retains 90 days.
The endpoint is disabled unless `METRICS_TOKEN` is set and never accepts the app
tile token. On Ada, query it over SSH against `http://127.0.0.1:8081` so the
monitoring credential does not need to cross the public Funnel.

From another Tailnet device, the bundled helper provides the authenticated
snapshot without printing the monitoring token:

```bash
tailscale ssh mark@ada /home/mark/apps/pebble-weather-radar-tile-server/show-metrics.sh
```

## Rendering and cache flow

```text
Pebble companion (one request)
      |
      v
/maps/v2/mode/z/lat/lon.png
      |
      +-- fresh viewport cache --------------------------> response
      |
      +-- miss -> cached label-free raster tiles -> crop/downsample
               + cached Shortbread MVTs --------> global label layout
                                                    |
                                                    +--> five-colour PNG cache
```

The viewport centre is rounded to a source pixel before the final-cache lookup,
so nearby GPS fixes can reuse a render while moving the map by less than half a
source pixel. Raw MVTs, label-free raster tiles, and final viewports have separate
cache layers. Concurrent misses for the same key share one operation, and style
versions prevent old and new renders from mixing.

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

## Watch integration

The companion automatically requests one pre-styled watch-sized viewport rather
than downloading, recolouring, stitching, and cropping slippy tiles itself. If
that request errors, returns an invalid image, or takes more than five seconds,
the companion automatically renders the same view from the original public OSM
raster tiles for that refresh. It tries the production server again next time.
