# Rain Radar work items

Last triaged: 2026-07-26

## Decision summary

- Show frame age (`-10 min`) rather than local time. Age communicates data
  freshness directly and does not depend on the phone and watch agreeing on a
  timezone.
- Keep radar frames stored newest-first so a tight watch-memory budget always
  preserves the newest data, but map the indicator dots oldest-to-newest from
  left to right.
- For usage telemetry, prefer a small Cloudflare Pages Function or Worker plus
  Workers Analytics Engine. This is serverless and should stay inside the free
  tier at the expected scale. Do not store IP addresses or the GPS coordinates
  already used to centre the radar.

## Completed in this change

### RR-001 — Put the most recent frame on the right

Priority: P1  
Status: Done

The dots now read chronologically from left to right. Internal storage remains
newest-first to retain the existing memory-safety behaviour.

Acceptance:

- Rightmost dot selects the newest accepted radar frame.
- Leftmost dot selects the oldest accepted radar frame.
- Memory exhaustion still drops older history before newer data.

### RR-002 — Animate the radar history

Priority: P1  
Status: Done

Playback advances through history every second and pauses for three seconds on
the newest frame before looping. Pressing Up or Down resets the playback timer;
automatic playback resumes after three seconds without another button press.

Acceptance:

- A frame is shown for one second during normal playback.
- The newest frame is shown for three seconds.
- Manual frame navigation is not immediately overridden by playback.
- Refreshing radar data cancels the old playback timer.

### RR-003 — Show frame freshness

Priority: P1  
Status: Done

The selected frame's age is shown at the bottom-left as `-N min`. The phone
sends the source radar timestamp with each accepted overlay.

Follow-up after a device check:

- Confirm the label remains legible over the available map palettes.
- Confirm it does not collide with the timeline when all five frames are loaded.
- Reconsider local `HH:MM` only if testers consistently prefer clock time.

## Ready for implementation after decision

### RR-004 — Add privacy-minimised active-user telemetry

Priority: P2  
Status: Proposed — recommended route selected, owner decision required before
collecting telemetry

Recommended design:

1. Generate an opaque random installation ID in PebbleKit JS and persist it in
   local storage. It must not be derived from a name, email, device identifier,
   IP address, or GPS coordinate.
2. After a successful radar metadata refresh, send at most one telemetry event
   per installation per six hours to `/api/telemetry`.
3. Handle that path with a Cloudflare Pages Function (or standalone Worker).
4. Write one Workers Analytics Engine point containing:
   - opaque installation ID;
   - event name and app version;
   - Cloudflare-provided country and, optionally, region code;
   - success/failure category if operational health is useful.
5. Report active installations as distinct IDs over 1, 7, and 30 days, grouped
   by country. Start at country level; only enable region-level reporting if
   there is a real product need and enough users to avoid singling people out.

Do not collect:

- raw IP addresses;
- GPS latitude/longitude;
- Cloudflare's city, postal code, or edge-derived latitude/longitude;
- a radar-centre coordinate;
- an event on every four-minute automatic refresh.

Why this route:

- A request for a static file is cheap, but request/visitor counts are an
  approximation based on network traffic and do not provide a durable,
  anonymous installation identity.
- [Pages Functions run on the Workers runtime without a dedicated server](https://developers.cloudflare.com/pages/functions/).
- [The Workers request object includes IP-derived country, region, city and coordinates](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties);
  this proposal deliberately retains only country/region.
- [Workers Free currently includes 100,000 requests per day](https://developers.cloudflare.com/workers/platform/pricing/#workers).
- [Analytics Engine Free currently includes 100,000 writes and 10,000 read
  queries per day](https://developers.cloudflare.com/analytics/analytics-engine/pricing/).
- [Analytics Engine can count distinct values](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/aggregate-functions/#count)
  and [retains data for three months](https://developers.cloudflare.com/analytics/analytics-engine/limits/#data-retention).

Open decisions:

- Approve anonymous telemetry and add a short disclosure to the README/store
  listing before implementation.
- Choose country-only (recommended) or country plus region reporting.
- Choose the activity window and ping throttle. Suggested defaults are 7-day
  active installations and one ping per six hours.
- Confirm the Cloudflare project/repository where the Function should live.

Acceptance:

- Telemetry failure never prevents radar loading.
- A single installation can be counted distinctly without storing personal
  information.
- Dashboard/query shows 1-, 7-, and 30-day active counts and country totals.
- Endpoint has basic method/content validation and a payload-size limit.
- Retention and deletion behaviour are documented.

### RR-005 — Build a minimal usage report

Priority: P3  
Status: Blocked by RR-004

Start with saved queries or a small authenticated/admin-only report for:

- distinct active installations over 1, 7, and 30 days;
- active installations by country;
- app-version adoption;
- radar-refresh success rate, only if RR-004 records a coarse result.

Avoid building a public dashboard or operating a database until the saved
queries prove insufficient.

### RR-006 — Plan the custom radar tile service boundary

Priority: P3  
Status: Research

Keep the future tile API logically separate from telemetry, even if both use
Cloudflare Workers. The tile path will have different caching, availability,
abuse-protection, and cost requirements.

Questions for later:

- Will the service proxy/cache upstream tiles or render custom tiles?
- Is access public, installation-token based, or signed per request?
- What cache lifetime follows the source radar-frame timestamp?
- What happens when the Worker free quota or upstream source is unavailable?
- Can static/cache-hit tile delivery bypass Function invocation where possible?

Cloudflare notes:

- [Static Pages asset requests are free and unlimited, while Function requests
  consume the Workers quota](https://developers.cloudflare.com/pages/functions/pricing/).
- Function routes should be scoped so unrelated static assets do not invoke the
  Worker.

