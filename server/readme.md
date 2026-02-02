# Alpha ESS Local Monitor - Backend

Local monitoring and control system for Alpha ESS battery systems via Modbus TCP.

## Features

- ✅ Real-time data collection via Modbus TCP
- ✅ Historical data storage and aggregation
- ✅ Battery charge/discharge control
- ✅ RESTful API
- ✅ Automatic daily aggregation
- ✅ Event logging

## Requirements

- Node.js 18+ 
- MariaDB/MySQL 8+
- Alpha ESS system with Modbus TCP enabled
- Network access to Alpha ESS inverter

## Installation

1. Clone repository and install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. Initialize database:
```bash
npm run init-db
```

4. Start server:
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### System Status
- `GET /api/alphaess/status` - Current system status
- `GET /api/alphaess/pv-details` - AC-coupled PV details
- `GET /api/alphaess/dispatch-status` - Current dispatch mode
- `GET /api/alphaess/collector-status` - Data collector status

### Control
- `POST /api/alphaess/charge` - Charge from grid
- `POST /api/alphaess/discharge` - Discharge to grid
- `POST /api/alphaess/prevent-discharge` - Prevent grid discharge
- `POST /api/alphaess/stop` - Stop dispatch mode
- `POST /api/alphaess/normal` - Return to normal operation

### History
- `GET /api/history/last-24-hours` - Last 24 hours data
- `GET /api/history/date/:date` - Specific date data
- `GET /api/history/daily?start=&end=` - Daily summary range
- `GET /api/history/today` - Today's summary

## Configuration

Key environment variables:

- `ALPHA_ESS_IP` - Inverter IP address
- `ALPHA_ESS_PORT` - Modbus TCP port (default: 502)
- `ALPHA_ESS_SLAVE_ID` - Modbus slave ID (default: 85)
- `SNAPSHOT_INTERVAL` - Data collection interval in ms (default: 10000)
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Database config

## License

MIT