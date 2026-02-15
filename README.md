# WattsOn — Energy Monitoring & Management System

## Project Overview

WattsOn is a comprehensive, self-hosted energy monitoring and management platform designed for residential solar and battery systems. It collects, stores, and visualizes real-time and historical energy data from multiple sources — including AlphaESS solar/battery inverters, HomeWizard smart devices, and SolarEdge systems — through a modern web interface. The system is built for extensibility, allowing new energy sources to be integrated as modular plug-ins without changing the core application.

---

## Architecture

### Backend — Node.js + Express

The server-side application is built on **Node.js with Express** and is responsible for data collection, API endpoints, real-time communication, and system orchestration.

**Core services:**

- **Data Collector** (`dataCollector.js`) — Central orchestrator that manages data acquisition from all configured sources. It implements automatic failover logic: Cloud API is the primary source, with ModBus TCP/RTU as a local fallback. Snapshots are collected every 10–60 seconds depending on the active source and stored in MariaDB.
- **WebSocket Server** (`websocket.js`) — Provides real-time push updates to connected frontend clients. Broadcasts power data, connection status changes, and source-switch notifications so dashboards update instantly.
- **Scheduler** (`scheduler.js`) — Manages timed tasks including periodic data collection, minute/hourly aggregation, and daily summary generation at 00:05.
- **Database Service** (`database.js`) — Handles all MariaDB interactions including snapshot storage, multi-tier aggregation, event logging, and dispatch history tracking.
- **System Architecture Service** (`systemArchitectureService.js`) — Reads the component hierarchy and energy flow definitions from the database, enabling a fully dynamic system diagram on the frontend.
- **Settings Service** (`settingsService.js`) — Database-driven configuration management with change history and live reload capability.

### Frontend — Vue.js 3

The single-page application is built with **Vue.js 3**, **Pinia** for state management, **PrimeVue** for UI components, and **Chart.js** for data visualization.

**Key pages and components:**

- **Dashboard** (`Dashboard.vue`) — Live overview with real-time power flow, battery SOC, solar generation, grid import/export, and home consumption.
- **Dynamic System Diagram** (`DynamicSystemDiagram.vue`) — Renders the energy system topology directly from the database-defined architecture, showing components, sub-components, and animated power flows.
- **History** (`History.vue`) — Interactive charts for historical energy data with smart granularity selection (15-minute intervals for daily views, hourly for weekly, daily for monthly).
- **Analytics** (`Analytics.vue`) — Deeper energy analysis and performance metrics.
- **Control** (`Control.vue`) — Manual dispatch operations such as grid charging and discharging (requires ModBus connection).
- **Settings** (`Settings.vue`) — System configuration UI with live Cloud API and ModBus connection testing.
- **Setup Wizard** (`SetupWizard.vue`) — Guided initial configuration flow.

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

The system uses **MariaDB/MySQL** with a multi-tier time-series storage strategy optimized for both real-time performance and long-term analysis.

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

1. **Every minute** — Raw snapshots → `energy_minutes` (averages, min/max)
2. **Every hour** — Minute data → `energy_hours` (energy in Wh, import/export separation)
3. **Daily at 00:05** — Hourly data → `energy_daily` (kWh totals, self-consumption rate, self-sufficiency rate, peak power)
4. **After daily aggregation** — Snapshots older than 7 days are purged

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

## Modular Backend Architecture

The backend follows a clear separation between **core infrastructure** and **pluggable modules**. The `core/` directory contains shared services that every module depends on, while the `modules/` directory holds self-contained energy source integrations that are discovered and loaded at runtime.

### Project Structure Overview

```
project-root/
├── server.js                          # Application entry point
├── .env                               # Environment configuration
├── config/
│   ├── app.js                         # Express/CORS settings
│   ├── database.js                    # MariaDB connection pool
│   └── modbus.js                      # ModBus defaults & intervals
│
├── core/                              # Shared infrastructure
│   ├── collectorManager.js            # Module discovery & orchestration
│   ├── moduleLoader.js                # Dynamic module loading
│   ├── routeManager.js                # Auto-registers module routes
│   ├── strategyManager.js             # Energy strategy engine
│   ├── database.js                    # Shared DB service (pool, helpers)
│   │
│   ├── auth/                          # Authentication & authorization
│   │   ├── middleware/
│   │   │   ├── authenticate.js        # JWT verification
│   │   │   ├── authorize.js           # Role-based access control
│   │   │   ├── rateLimiter.js         # Request throttling
│   │   │   └── session.js             # Session management
│   │   ├── models/
│   │   │   ├── session.js
│   │   │   └── user.js
│   │   ├── routes/
│   │   │   └── auth.js                # Login/logout/refresh endpoints
│   │   └── services/
│   │       ├── authService.js
│   │       ├── tokenService.js
│   │       └── userService.js
│   │
│   ├── strategies/                    # Energy management strategies
│   │   └── SmartEcoStrategy.js        # Eco-optimized charge/discharge
│   │
│   └── system/                        # System-wide services & routes
│       ├── controllers/
│       │   └── historyController.js
│       ├── routes/
│       │   ├── config.js              # System configuration API
│       │   ├── data.js                # Generic data endpoints
│       │   ├── history.js             # Historical data queries
│       │   ├── settings.js            # Settings CRUD + testing
│       │   ├── setup.js               # Setup wizard API
│       │   └── system.js              # Architecture & component API
│       └── services/
│           ├── aggregatorService.js    # Multi-tier data aggregation
│           ├── profilingService.js     # Performance profiling
│           ├── settingsService.js      # DB-driven settings with cache
│           └── systemconfigservice.js  # System component management
│
├── modules/                           # Pluggable energy source modules
│   ├── alphaess-cloud/
│   ├── alphaess-modbus-tcp/
│   ├── alphaess-modbus-rs485/
│   ├── homewizard/
│   ├── solar-forecast/
│   ├── solaredge/
│   └── wheather/
│
├── diagnostics/                       # Standalone diagnostic scripts
│   ├── test-daily-totals.js
│   └── verify-aggregation.js
│
└── tests/                             # Integration test scripts
    ├── modbus-diagnostic.js
    ├── test-modbus-rs485.js
    └── test-modbus.js
```

### Module Anatomy

Every module lives in its own directory under `modules/` and follows a standardized structure. This convention ensures the core `collectorManager` and `moduleLoader` can discover, initialize, and orchestrate modules without any hardcoded references.

```
modules/[module-name]/
├── manifest.json                # Module identity & capabilities
├── index.js                     # Entry point (initialize, getStatus)
├── test.js                      # Self-contained test suite
│
├── config/
│   └── settings_schema.json     # Defines configurable settings for the UI
│
├── services/
│   ├── api.js                   # External API communication (if applicable)
│   ├── collector.js             # Data collection logic
│   └── deviceService.js         # Device discovery/management (if applicable)
│
└── routes/
    └── index.js                 # Express routes exposed under /api/modules/[name]
```

Each file has a specific responsibility:

**`manifest.json`** — Declarative module metadata that the loader reads at discovery time. Contains the module name, version, description, author, supported capabilities (e.g. `realtime`, `historical`, `control`), required settings, and default collection interval. The collector manager uses this to determine how to schedule and handle the module.

**`index.js`** — The module's entry point. Exports an object with standardized lifecycle methods: `initialize()` loads settings from the database and sets up the module, `getStatus()` returns the current health and configuration state, and optionally `shutdown()` for cleanup. The module loader calls these during application startup and shutdown.

**`services/api.js`** — Encapsulates all external communication (HTTP requests to cloud APIs, local device APIs, or protocol-level communication). This strict separation ensures that API keys, endpoints, authentication logic, and error handling are isolated from the collection logic. The api.js file typically exposes methods like `healthCheck()`, `fetchData()`, and `getAPIInfo()`.

**`services/collector.js`** — Implements the `collect()` method that the collector manager invokes on schedule. It calls the api service to fetch data, normalizes the response into the standard WattsOn data format, and stores results in the database. Also exposes `getStatus()` with last run time, error state, and record counts.

**`services/deviceService.js`** — Used by modules that manage physical devices (like HomeWizard). Handles device discovery on the local network, device registration, and per-device state tracking.

**`config/settings_schema.json`** — A JSON schema that defines which settings the module needs (API keys, endpoints, polling intervals, enabled/disabled flags). The Settings UI reads this schema to dynamically render configuration forms without custom frontend code per module.

**`routes/index.js`** — Express router that the route manager auto-mounts under `/api/modules/[module-name]`. Provides module-specific API endpoints for the frontend (e.g. device lists, manual data fetch, connection testing).

**`test.js`** — A standalone test suite that validates the full module stack: API connectivity, database tables, settings loading, module initialization, data collection, and data querying. Each test outputs colored console results and a pass/fail summary.

### Current Modules

| Module | Type | Protocol | Status | Description |
|---|---|---|---|---|
| `alphaess-cloud` | Cloud API | HTTPS | Active | AlphaESS Open API for real-time and historical inverter data |
| `alphaess-modbus-tcp` | Local | ModBus TCP | Active | Direct inverter communication over LAN (port 502) |
| `alphaess-modbus-rs485` | Local | RS485 Serial | Planned | Direct serial connection via USB-RS485 cable |
| `homewizard` | Local | HTTP (LAN) | In Progress | HomeWizard P1 meter and smart socket monitoring |
| `solar-forecast` | Cloud API | HTTPS | Active | Solar production forecasting via Forecast.Solar |
| `solaredge` | Cloud API | HTTPS | Planned | SolarEdge inverter integration |
| `wheather` | Cloud API | HTTPS | Planned | Weather data for forecast enrichment |

### Core Infrastructure

The core services that power module orchestration:

**`collectorManager.js`** — The central orchestrator. At startup it scans the `modules/` directory, reads each `manifest.json`, validates the module structure, and calls `initialize()` on each enabled module. It then schedules `collect()` calls at the intervals defined in the manifest or overridden in database settings. It handles errors per-module so a failing module never blocks others.

**`moduleLoader.js`** — Handles the dynamic `import()` of module entry points, validates that required exports exist, and maintains a registry of loaded modules with their status.

**`routeManager.js`** — Iterates over loaded modules, checks for a `routes/` directory, and auto-mounts each module's Express router under the appropriate API path. This means adding a new module's routes requires zero changes to the core route configuration.

**`strategyManager.js`** — Manages energy management strategies (like `SmartEcoStrategy`) that can consume data from multiple modules to make automated charge/discharge decisions.

### Module Lifecycle

```
Application Start
    │
    ▼
collectorManager.discoverModules()
    │  Scans modules/ directory
    │  Reads manifest.json from each
    │
    ▼
moduleLoader.load(module)
    │  Dynamic import of index.js
    │  Validates exports
    │
    ▼
module.initialize()
    │  Loads settings from database (via settingsService)
    │  Validates required configuration
    │  Sets up API client / device connections
    │
    ▼
routeManager.mountRoutes(module)
    │  Auto-registers /api/modules/[name]/*
    │
    ▼
collectorManager.scheduleCollection(module)
    │  Starts periodic collect() calls
    │  Per-module error isolation
    │
    ▼
Running ─── collect() → api.fetchData() → normalize → db.store()
    │
    ▼
Application Shutdown
    │
    ▼
module.shutdown()
    │  Close connections, cleanup
```

### Adding a New Module

To integrate a new energy source, a developer creates a new directory under `modules/` with the standard file structure and the core infrastructure handles the rest:

1. Create `modules/new-source/manifest.json` with module metadata
2. Implement `services/api.js` for external communication
3. Implement `services/collector.js` with a `collect()` method that normalizes data
4. Create `index.js` with `initialize()` and `getStatus()`
5. Optionally add `routes/index.js` for module-specific API endpoints
6. Optionally add `config/settings_schema.json` for dynamic settings UI
7. Create `test.js` following the module test template for validation

No changes to the core application, route configuration, or frontend components are required — the module loader discovers and integrates the new source automatically.

### Module Test Framework

Each module includes a `test.js` that validates its complete stack independently. Tests run in sequence and cover:

1. **API Information** — Verify API client metadata and endpoints
2. **API Health Check** — Test connectivity to external services
3. **Database Connection** — Verify table existence and record counts
4. **Settings Loading** — Load and validate module settings from the database
5. **Module Initialization** — Run the full `initialize()` lifecycle
6. **Full Collection** — Execute a real `collect()` cycle and verify data storage
7. **Data Query** — Retrieve and display collected data

Tests produce colored terminal output with a pass/fail summary, making it easy to validate a module in isolation before integrating it into the running system. A shell script can chain all module tests for full-system validation.

---

## Key Design Principles

1. **Cloud-first, local-enhanced** — Cloud API provides reliable baseline data; local protocols add detail and control capabilities.
2. **Database-driven configuration** — UI layouts, system topology, and settings are all stored in the database rather than hardcoded, enabling diverse system architectures without code changes.
3. **Graceful degradation** — The system remains functional even when individual data sources are unavailable.
4. **Separation of concerns** — API communication lives in dedicated service files; collectors consume those services rather than making direct external calls.
5. **Pre-aggregated analytics** — Multi-tier aggregation ensures fast historical queries at any time scale.

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
| Database | MariaDB / MySQL |
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
- Live dashboard with WebSocket-powered updates
- Dynamic system diagram rendered from database architecture
- Historical data visualization with smart granularity
- Multi-tier data aggregation pipeline
- JWT authentication with role-based access
- Settings management with database persistence and live reload
- Solar forecast and electricity pricing modules
- RS485 serial communication (USB-RS485 cable)
- HomeWizard Energy module (manual insertion)
- Day-ahead API for creating a strategy
- SolarEdge integration
- Universal UI component system (dynamic rendering from backend schemas)

### In Progress

- HomeWizard Energy module (device discovery, P1 meter, smart sockets)
- create a strategy module for planning when to charge, decharge combined with average usage in the morning/evening

### Planned

- Data retention policy automation
- Multi-building / multi-location support
- VLAN-isolated ModBus security hardening
- Long-term database optimization

---

*WattsOn — Making energy visible.*
