# Wolffie - your Home Energy Management System

## Project Overview

Wolffie is a comprehensive, self-hosted energy monitoring and management platform designed for residential solar and battery systems. 
https://wolffieenergy.nl
It is created to enable management of your battery inverter and solar converter in 1 system and not to depend on public/external API's from vendors.
It collects, stores, and visualizes real-time and historical energy data from multiple sources - including AlphaESS solar/battery inverters, HomeWizard smart devices, and SolarEdge systems — through a modern web interface. 
The system is built for extensibility, allowing new energy sources to be integrated as modular plug-ins without changing the core application.

![](homePage_dashboard.png)
---

## Getting Started

**Requirements:** Node.js 22+, npm.

```bash
git clone https://github.com/PeterAarts/Wolffie.git
cd Wolffie

# Backend
cd server
npm install
npm start          # listens on port 3009

# Frontend (in a second terminal)
cd ../my-app
npm install
cp .env.example .env.local     # only needed if your setup differs from defaults
npm run dev                    # http://localhost:5173
```

The frontend dev server proxies `/api` and `/ws` to the backend, so both run
side by side without CORS configuration. All hardware connections (inverter IP
addresses, API keys, poll intervals) are configured **in the app itself** under
Settings, not in files — they live in the database so they can be changed
without a restart.

---

## Configuration

### Frontend — `vite.config.js` and `.env.local`

`vite.config.js` reads every environment-specific value from the environment
and falls back to a working default, so **a fresh clone builds and runs without
editing it**. Overrides go in `.env.local`, which is git-ignored — your LAN
addresses and local paths stay out of the repository.

| Variable | Default | What it does |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL the app uses for API calls. Keep it relative to use the dev proxy and avoid CORS. |
| `VITE_WS_URL` | derived from the API target | WebSocket endpoint for live dashboard updates. |
| `VITE_PROXY_TARGET` | `http://localhost:3009` | Where the dev server forwards `/api` and `/ws`. Only needed when the backend is not on localhost. |
| `VITE_DEV_PORT` | `5173` | Port for the Vite dev server. |
| `VITE_OUT_DIR` | `dist` | Where `npm run build` writes the bundle. Point it at your web root to deploy in one step. |

**Filename matters.** Vite loads `.env`, `.env.local`, `.env.[mode]` and
`.env.[mode].local`. The default mode for `vite dev` is `development`, so a
file named `.env.dev` is **not** loaded unless your npm script passes
`--mode dev`. Use `.env.local` and it always applies.

**Relative or absolute API URL.** These are two different mechanisms and only
one applies at a time:

- `VITE_API_BASE_URL=/api` — the browser calls the dev server, which proxies to
  the backend. No CORS involved. Recommended.
- `VITE_API_BASE_URL=http://host:3009/api` — the browser calls the backend
  directly, **bypassing the proxy**. The backend must then send CORS headers
  for your frontend origin.

**Backend on another machine.** Keep the base URL relative and point the proxy
at it:

```bash
VITE_API_BASE_URL=/api
VITE_PROXY_TARGET=http://192.168.1.50:3009
```

`VITE_WS_URL` follows automatically (`http` becomes `ws`, `https` becomes
`wss`), so you rarely need to set it.

**Building straight into your web root.** `VITE_OUT_DIR` accepts an absolute
path, which saves a copy step when deploying behind Apache or nginx:

```bash
# Windows
VITE_OUT_DIR=W:/_wolffie/my-app/dist

# Linux
VITE_OUT_DIR=/var/www/wolffie
```

⚠️ `emptyOutDir` is enabled, so **the target folder is wiped on every build**.
Do not point it at a directory containing anything else.

### Things in `vite.config.js` you should not need to change

- **Timestamped asset filenames.** Every build stamps `[name]-<timestamp>.js`
  onto bundles. This is deliberate: the PWA service worker caches aggressively,
  and without unique filenames browsers serve a stale bundle after a deploy.
- **The `vue-i18n` alias.** Points at the CJS build to avoid runtime template
  compilation and keep the bundle smaller.
- **PWA manifest.** Icons, theme colour and app name. Change these only if you
  are rebranding your own instance.

### Backend — `server/.env`

Secrets live here, separately from the frontend. Anything Vite loads with a
`VITE_` prefix is compiled into the browser bundle and is public, so keeping
server secrets in the frontend project is one rename away from leaking them.

| Variable | Required | What it does |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | **yes** | Encrypts credentials stored in `system_settings`. |
| `JWT_ACCESS_SECRET` | **yes** | Signs access tokens. |
| `JWT_REFRESH_SECRET` | **yes** | Signs refresh tokens. Must differ from the access secret. |
| `FRONTEND_URL` | yes | Origin allowed to call the API (CORS). |
| `PORT` | no | Backend listen port. Default `3009`. |

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ **`SETTINGS_ENCRYPTION_KEY` is not optional.** `settingsService.js` falls
back to a hardcoded placeholder when it is unset, and that placeholder is
visible in this public repository — leaving it unset means stored credentials
are protected by a key anyone can read.

⚠️ **Changing it invalidates existing values.** Anything encrypted with the old
key will not decrypt with the new one, and `decrypt()` returns `null` on
failure rather than throwing. A wrong key therefore looks like *empty*
credentials, not an error. After changing it, re-enter the affected settings
through the UI.

Everything else — inverter addresses, cloud credentials, poll intervals,
strategy tuning — is configured through the Settings UI and stored in the
database.

---

## Architecture

### Backend - Node.js + Express

The server-side application is built on **Node.js with Express** and is responsible for data collection, API endpoints, real-time communication, and system orchestration.

**Core services:**

- **Data Collector** (`dataCollector.js`) - Central orchestrator that manages data acquisition from all configured sources. It implements automatic failover logic: Cloud API is the primary source, with ModBus TCP/RTU as a local fallback. Snapshots are collected every 10–60 seconds depending on the active source and stored in SQLite.
- **WebSocket Server** (`websocket.js`) - Provides real-time push updates to connected frontend clients. Broadcasts power data, connection status changes, and source-switch notifications so dashboards update instantly.
- **Scheduler** (`scheduler.js`) - Manages timed tasks including periodic data collection, minute/hourly aggregation, and daily summary generation at 00:05.
- **Database Service** (`database.js`) - Handles all SQLite interactions including snapshot storage, multi-tier aggregation, event logging, and dispatch history tracking.
- **System Architecture Service** (`systemArchitectureService.js`) - Reads the component hierarchy and energy flow definitions from the database, enabling a fully dynamic system diagram on the frontend.
- **Settings Service** (`settingsService.js`) - Database-driven configuration management with change history and live reload capability.

### Frontend — Vue.js 3

The single-page application is built with **Vue.js 3**, **Pinia** for state management, **PrimeVue** for UI components, and **Chart.js** for data visualization.

**Key pages and components:**

- **Dashboard** (`Dashboard.vue`) - Live overview with real-time power flow, battery SOC, solar generation, grid import/export, and home consumption.
- **Dynamic System Diagram** (`DynamicSystemDiagram.vue`) - Renders the energy system topology directly from the database-defined architecture, showing components, sub-components, and animated power flows.
- **History** (`History.vue`) - Interactive charts for historical energy data with smart granularity selection (15-minute intervals for daily views, hourly for weekly, daily for monthly).
- **Analytics** (`Analytics.vue`) - Deeper energy analysis and performance metrics.
- **Control** (`Control.vue`) - Manual dispatch operations such as grid charging and discharging (requires ModBus connection).
- **Settings** (`Settings.vue`) - System configuration UI with live Cloud API and ModBus connection testing.
- **Setup Wizard** (`SetupWizard.vue`) - Guided initial configuration flow.

### Communication Protocols

| Protocol | Purpose | Notes |
|---|---|---|
| **AlphaESS Cloud API** | Primary data source for real-time and historical inverter data | Rate-limited; 60s polling interval |
| **ModBus TCP/RTU** | Local inverter communication; required for control operations | Lower latency; 10s polling |
| **RS485 Serial** | Planned direct inverter connection via USB-RS485 cable | DSD TECH adapter |
| **HomeWizard Local API** | Smart socket and P1 meter monitoring | LAN-based discovery |
| **HTTP REST** | Frontend ↔ Backend communication for config and historical data | Express routes |
| **WebSocket** | Real-time data push to frontend clients | Auto-reconnect with 5s retry |

---

## Database Design

The system uses **SQLite** (via `better-sqlite3`) with a multi-tier time-series storage strategy optimized for both real-time performance and long-term analysis. A single file, no database server to install or maintain.

### Data Tables

| Table | Granularity | Retention | Purpose |
|---|---|---|---|
| `energy_snapshots` | 10–60 seconds | 7 days | Raw real-time measurements |
| `energy_minutes` | 1 minute | Weeks | First-level aggregation with min/max/avg |
| `energy_hours` | 1 hour | Months | Energy totals (Wh) for charting |
| `energy_daily` | 1 day | Indefinite | Daily KPIs including self-consumption and self-sufficiency rates |

### Supporting Tables

- `system_components` — Hierarchical component definitions (locations → groups → devices) with specs and data source mappings.
- `component_flows` — Defines energy flow relationships and directions between components for the dynamic diagram.
- `system_events` — Timestamped event log with severity levels.
- `dispatch_history` — Records of manual and automated charge/discharge operations.
- `system_settings` — All configuration stored in the database with change tracking.

### Aggregation Pipeline

Snapshots are collected continuously and aggregated through an automated pipeline:

1. **Every minute** - Raw snapshots → `energy_minutes` (averages, min/max)
2. **Every hour** - Minute data → `energy_hours` (energy in Wh, import/export separation)
3. **Daily at 00:05** - Hourly data → `energy_daily` (kWh totals, self-consumption rate, self-sufficiency rate, peak power)
4. **After daily aggregation** - Snapshots older than 7 days are purged

This pre-aggregation approach delivers 5–10× query performance improvements over on-the-fly calculations.

---

## Data Collection & Failover

The data collector implements a resilient multi-source strategy:

```
Primary: AlphaESS Cloud API (reliable, rate-limited)
    ↓ on failure
Fallback: ModBus TCP/RTU (local, low-latency)
    ↓ on failure
Graceful degradation: cached data / historical display
```

Key behaviors:
- Source switches are logged and broadcast to frontend clients in real-time.
- ModBus connection loss never blocks the application — the system continues operating with Cloud API data.
- Control operations (charge/discharge) require an active ModBus connection since the Cloud API is read-only.
- Connection status is continuously monitored and reported to the UI.

---

## Modular Design

Each energy source is implemented as a self-contained module following a standardized structure:

```
modules/
  alphaess/
    manifest.json        # Module metadata and capabilities
    services/
      api.js             # External API communication
      collector.js       # Data collection logic
    routes/              # Express API endpoints
    config-schema.json   # Configuration definition
  homewizard/
    ...
  solar-forecast/
    ...
  electricity-pricing/
    ...
```

The **Collector Manager** discovers and loads modules at startup, orchestrating collection intervals and error handling uniformly across all sources.

---

## Key Design Principles

1. **Cloud-first, local-enhanced** - Cloud API provides reliable baseline data; local protocols add detail and control capabilities.
2. **Database-driven configuration** - UI layouts, system topology, and settings are all stored in the database rather than hardcoded, enabling diverse system architectures without code changes.
3. **Graceful degradation** - The system remains functional even when individual data sources are unavailable.
4. **Separation of concerns** - API communication lives in dedicated service files; collectors consume those services rather than making direct external calls.
5. **Pre-aggregated analytics** - Multi-tier aggregation ensures fast historical queries at any time scale.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | Vue.js 3 + Vite |
| State management | Pinia |
| UI components | PrimeVue |
| Charts | Chart.js |
| Backend runtime | Node.js |
| Web framework | Express |
| Database | SQLite |
| Real-time | WebSocket (native) |
| ModBus | modbus-serial library |
| Authentication | JWT + refresh tokens |
| Dev environment | Windows |

### External Integrations

- **AlphaESS Cloud API** — Inverter and battery data
- **HomeWizard Local API** — Smart sockets and P1 meters
- **Forecast.Solar** — Solar production forecasting
- **Fraunhofer ISE Energy Charts** — Day-ahead electricity pricing

---

## Current Status & Roadmap

### Working

- AlphaESS Cloud API integration with real-time and historical data
- AlphaESS Modbus TCP local-connection
- AlphaESS RS485 serial communication (USB-RS485 cable)
- Live dashboard with WebSocket-powered updates
- Dynamic system diagram rendered from database architecture
- Historical data visualization with smart granularity
- Multi-tier data aggregation pipeline
- JWT authentication with role-based access
- Settings management with database persistence and live reload
- Solar forecast and electricity pricing modules
- HomeWizard Energy module (energy-socket devices manually added, based on api v1)
- SolarEdge integration
- Universal UI component system (dynamic rendering from backend schemas)

### In Progress

- HomeWizard Energy module (device discovery, P1 meter, smart sockets)
- A strategy module that determines when or if to charge from grid (low-prices) based on morning usage. Combined with the expected Solar production for next day.(hence solar-forecast)

### Planned

- Data retention policy automation
- Multi-building / multi-location support
- VLAN-isolated ModBus security hardening
- Long-term database optimization

---

*Wolffie — Manage your energy offline.*