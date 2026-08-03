# Propheteia

Wildfire prediction platform. Computes the wildfire danger for any
geographic coordinate using the **official Canadian Forest Fire Weather
Index (FWI) System** (Van Wagner 1987) and real-time weather data from the
[Open-Meteo API](https://open-meteo.com/).

The repository contains the **Node.js/Express backend** and the **React
frontend** (`frontend/`). The frontend loads initial data over REST and
receives real-time updates over Socket.IO.

---

## Quick start

```bash
# Backend (repo root)
npm install
cp .env.example .env        # optional; sensible defaults exist
npm start                   # or: npm run dev

# Frontend (frontend/ dir, in another terminal)
npm install
npm run dev                 # http://localhost:5173 (proxies /api + /socket.io)
```

The server listens on `http://0.0.0.0:3000` by default. When `frontend/dist`
exists, the backend also serves the built frontend as a single deployable
unit (SPA fallback included).

## Endpoints

| Method | Path                 | Description                                              |
| ------ | -------------------- | -------------------------------------------------------- |
| GET    | `/api/predict`       | Full wildfire danger prediction for a coordinate         |
| GET    | `/api/predictions`   | Latest prediction snapshots (one per location)           |
| GET    | `/api/alerts`        | Nearby + global alert lists                              |
| GET    | `/api/geocode`       | Place-name search for the map search bar                 |
| GET    | `/api/weather`       | Raw weather data from the active provider (cached)       |
| GET    | `/api/health`        | Server status, cache stats, database health              |
| GET    | `/api/locations`     | List locations monitored by the background jobs          |
| POST   | `/api/locations`     | Register `{ "lat": .., "lon": .., "name": ".." }`        |
| DELETE | `/api/locations`     | Remove `?lat=..&lon=..`                                  |

### `GET /api/predict?lat=31.63&lon=-8.01`

Response:

```json
{
  "latitude": 31.63,
  "longitude": -8.01,
  "predictedAt": "2026-07-31T20:55:00.000Z",
  "weather": {
    "temperature": 34.0,
    "humidity": 21.0,
    "windSpeed": 19.0,
    "precipitation": 0.0,
    "rainfall24h": 0.0,
    "weatherCode": 0,
    "observedAt": "2026-07-31T20:30",
    "provider": "open-meteo",
    "cached": true
  },
  "indices": {
    "FFMC": 91.4,
    "DMC": 28.6,
    "DC": 413.2,
    "ISI": 10.8,
    "BUI": 46.3,
    "FWI": 18.2,
    "DSR": 5.62
  },
  "riskLevel": "High",
  "fireProbability": 82,
  "state": {
    "date": "2026-07-31",
    "previousDate": "2026-07-30",
    "usedStartupValues": false
  }
}
```

`monitor=1` (e.g. `?lat=..&lon=..&monitor=1`) additionally registers the
location so the background jobs keep its state fresh.

### `GET /api/predictions?limit=50`

Latest prediction snapshot per location (newest first), persisted whenever a
prediction is computed (API requests and background jobs). Drives the map
markers and the global predictions list.

### `GET /api/predictions?north=..&south=..&east=..&west=..&z=..`

Computes a grid of predictions for a visible map viewport (bounds in degrees,
`z` = map zoom). Only **land** cells are computed — ocean, lakes and polar
ice are skipped (and prediction points are snapped to land inside their
cell) — and the grid spacing scales with the zoom level so the
cell count stays bounded:

| Zoom  | Spacing |
|-------|---------|
| ≤ 4   | 0.25°   |
| 5–8   | 0.10°   |
| 9–12  | 0.02°   |
| 13+   | 0.01°   |

Results are cached per zoom + quantized bounds (10 min TTL); weather is
fetched in batches through the provider. The response includes `count`,
`spacing` and the `predictions` array. Real-time updates for the visible
viewport arrive over the socket via `subscribe:view` (see below).

Prediction points are placed deterministically *inside* each grid cell
(a small pseudo-random offset derived from the cell's lattice indices),
so markers never line up in perfect rows/columns yet stay stable between
refreshes; points that would land on water fall back to the cell center.

Every prediction carries a human-readable location name ("In Agadir",
"Near Ifrane", "Near Teton") resolved by the reverse-geocoding pipeline
(Photon, with Nominatim as fallback when Photon has no data). Lookups
run asynchronously with a bounded inline budget, are cached in SQLite
(`geocode_cache` table) and queued in the background for the rest; when
a name resolves after the prediction was served, live clients receive a
`prediction:renamed` socket event.

Very low zooms (the whole world) are never computed: the backend refuses
regions that would still exceed the cell cap after coarsening, and the map
falls back to the latest persisted snapshots (`?limit=`) instead.

### `GET /api/alerts?lat=..&lon=..&radiusKm=600`

Derives the alert lists from the persisted snapshots:

- `nearby` — predictions within `radiusKm` of the reference point (the
  point's own prediction is computed live), ordered by distance,
- `global` — the most threatening predictions worldwide (country/region
  derived from the monitored location names),
- `reference` — the reference point's own alert.

### `GET /api/geocode?q=..&limit=8`

Place-name search backed by the Open-Meteo Geocoding API (used by the map
search bar). Returns up to `limit` (max 10) candidates with coordinates:

```json
{
  "query": "marseille",
  "count": 2,
  "results": [
    {
      "id": 2086257,
      "name": "Marseille",
      "latitude": 43.29695,
      "longitude": 5.38107,
      "country": "France",
      "admin1": "Provence-Alpes-Côte d'Azur",
      "formatted": "Marseille, Provence-Alpes-Côte d'Azur, France"
    }
  ]
}
```

## Real-time updates (Socket.IO)

Clients connect to `/socket.io`, join the `global` room automatically, and
may subscribe to a monitored area or to a map viewport:

| Direction | Event              | Payload                                            |
| --------- | ------------------ | -------------------------------------------------- |
| client →  | `monitor:area`     | `{ lat, lon }`                                     |
| client →  | `unmonitor`        | —                                                  |
| client →  | `subscribe:view`   | `{ north, south, east, west, zoom }`               |
| client →  | `unsubscribe:view` | —                                                  |
| server →  | `area:monitored`   | `{ key, lat, lon }`                                |
| server →  | `view:subscribed`  | the parsed viewport                                |
| server →  | `view:unsubscribed`| —                                                  |
| server →  | `prediction:updated` | full prediction payload                          |
| server →  | `weather:updated`  | `{ lat, lon, weather }`                            |
| server →  | `risk:changed`     | `{ lat, lon, previousRiskLevel, currentRiskLevel, prediction }` |
| server →  | `alert:new`        | alert-shaped prediction                             |
| server →  | `alert:resolved`   | `{ lat, lon, riskLevel }`                          |

Events are emitted whenever a prediction is computed (API or background
jobs). `prediction:updated` / `weather:updated` / `risk:changed` are
viewport-scoped: they only reach clients whose subscribed viewport (or
`area:<lat,lon>` room) contains the location — a viewport subscription is
re-applied automatically after a reconnect. `alert:new` / `alert:resolved`
are global and fire only when a location crosses the alert risk threshold.

## Frontend

`frontend/` is a React + TypeScript + Vite app with pages for Alerts, Map
(Leaflet) and Settings. State lives in `src/hooks/` (`usePredictions`,
`useAlerts`, `useLocation`, `useSocket`) backed by the services in
`src/services/` (`api`, `socket`, `location`, `notifications`, `storage`).
Preferences (notifications, location access, theme) persist in
`localStorage`; browser notifications fire when a nearby risk increases.

### `GET /api/weather?lat=..&lon=..&refresh=1`

Returns the normalized weather payload from Open-Meteo. `refresh=1` bypasses
the cache. Responses are cached per rounded coordinate (~11 m grid) with a
configurable TTL (`CACHE_TTL_SECONDS`, default 10 min).

---

## The Canadian FWI System

Propheteia implements all six official indices:

| Index | Module                 | Meaning                                            |
| ----- | ---------------------- | -------------------------------------------------- |
| FFMC  | `services/fwi/ffmc.js` | Fine Fuel Moisture Code — ease of ignition         |
| DMC   | `services/fwi/dmc.js`  | Duff Moisture Code — moisture of the duff layer    |
| DC    | `services/fwi/dc.js`   | Drought Code — moisture of deep organic layers     |
| ISI   | `services/fwi/isi.js`  | Initial Spread Index — expected rate of spread     |
| BUI   | `services/fwi/bui.js`  | Build-Up Index — total fuel available              |
| FWI   | `services/fwi/fwi.js`  | Fire Weather Index — expected fire intensity       |

The equations follow the operational formulation of the system as published
in:

- **Van Wagner, C.E. 1987.** *Development and structure of the Canadian
  Forest Fire Weather Index System.* Forestry Technical Report 35. Canadian
  Forestry Service, Ottawa.
- **Van Wagner, C.E.; Pickett, T.L. 1985.** *Equations and FORTRAN program
  for the Canadian Forest Fire Weather Index System.* Forestry Technical
  Report 33. Canadian Forestry Service, Petawawa.

The implementation reproduces the official reference algorithm (the one used
by the Canadian Wildland Fire Information System, also distributed in the
`cffdrs` R package), including all conditional equations, rain thresholds,
temperature constraints and the latitude/month day-length adjustments for
DMC and DC. It is verified against the official test dataset
(Van Wagner & Pickett 1985) — all 48 days × 6 indices match the reference
outputs:

```bash
node scripts/verify-fwi.js     # PASS: worst deviation 0.005
npm test                       # 18 unit tests, incl. official day-1 values
```

### Required inputs

- Air temperature (°C)
- Relative humidity (%)
- 10-m open wind speed (km/h)
- 24-hour rainfall (mm)
- Previous day's FFMC, DMC and DC

The FWI System is **recursive**: today's moisture codes depend on
yesterday's. Propheteia persists the previous day's FFMC/DMC/DC for every
queried location in SQLite (`fwi_state` table). When no previous state
exists, the official startup values are used (FFMC=85, DMC=6, DC=15).

## Fire probability mapping

The FWI System does **not** produce a probability. The FWI value is returned
as the scientific indicator; the `fireProbability` is an **estimated**
percentage for UI purposes only, derived by linear interpolation within each
band of the standard FWI danger scale:

| FWI    | Risk level | Estimated probability |
| ------ | ---------- | --------------------- |
| 0–5    | Very Low   | 0–20%                 |
| 5–12   | Low        | 20–40%                |
| 12–21  | Moderate   | 40–60%                |
| 21–38  | High       | 60–80%                |
| >38    | Extreme    | 80–100%               |

Implementation: `src/services/alerts/risk.mapper.js`.

## Weather source

Open-Meteo Forecast API (`https://api.open-meteo.com/v1/forecast`). The
provider (`src/services/weather/providers/openMeteo.provider.js`) fetches
temperature, relative humidity, 10-m wind speed, current precipitation and
the daily `precipitation_sum`, which supplies the 24-hour rainfall input the
FWI System requires. New providers can be added by implementing the same
`getWeather(lat, lon)` contract (see `weather.service.js`).

## Background jobs (node-cron)

All jobs are prepared for future expansion (notifications, satellite data,
etc.) and iterate over the monitored locations registered via
`POST /api/locations` or `monitor=1`:

| Job                     | Schedule   | Purpose                                  |
| ----------------------- | ---------- | ---------------------------------------- |
| Weather refresh         | `0 * * * *`| Refresh cached weather per location      |
| FWI recalculation       | `0 13 * * *`| Recompute indices (noon-observation assumption) |
| Cache maintenance       | `0 3 * * *`| Purge expired persistent cache entries   |

Jobs are guarded against overlapping runs, never crash the process, and can
be disabled with `JOBS_ENABLED=false`.

## Project structure

```
src/
├── config/          env + FWI constants, day-length tables, risk bands
├── routes/          Express routers (/api/*)
├── controllers/     request handling
├── services/
│   ├── weather/     provider abstraction + Open-Meteo provider
│   ├── fwi/         ffmc, dmc, dc, isi, bui, fwi, dayLength, fwi.service
│   ├── alerts/      FWI -> risk level + estimated probability
│   └── prediction/  end-to-end prediction orchestration
├── utils/           logger, errors, validation, geo keys
├── middleware/      request logger, error handler, 404
├── cache/           in-memory TTL cache + SQLite cache backend
├── db/              SQLite schema, FWI state store, location store
├── jobs/            node-cron scheduler + job definitions
├── app.js           Express application factory
└── server.js        HTTP server entry point
```

## Error handling

- Invalid coordinates → `400`
- Unknown routes → `404`
- Open-Meteo failures → `502` (timeouts → `504`)
- Incomplete weather data → `422`
- Unexpected errors → `500` (details never leaked)

All errors are JSON with `{ "error": ..., "message": ..., "details": ... }`.

## Logging

Structured JSON logs with request ids (`x-request-id` header), including
incoming requests, API errors, weather fetch duration and FWI calculation
duration. Configure via `LOG_LEVEL` and `LOG_FILE`.

## Future compatibility

The architecture leaves clean seams for: GPS tracking, push notifications,
satellite imagery, NASA FIRMS integration, historical wildfire databases,
machine-learning predictions, multiple weather providers and user accounts
(e.g. provider interface in `services/weather/`, alert mapper in
`services/alerts/`, monitored-location registry in `db/locationStore.js`).
