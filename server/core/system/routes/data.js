// server/core/system/routes/data.js
//
// Wijzigingen t.o.v. MySQL-versie:
//   CURDATE()                           →  date('now')
//   DATE_SUB(CURDATE(), INTERVAL 1 DAY) →  date('now', '-1 day')

import express from 'express';
import db from '../../database.js';
import systemConfigService from '../services/systemconfigservice.js';

const router = express.Router();

// ── GET /api/system/summary ────────────────────────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    // Fetch the latest snapshot per source within the last 2 hours.
    // This ensures each module (SolarEdge, AlphaESS, HomeWizard) contributes
    // its own fields, instead of a single LIMIT 1 always returning the module
    // that collects most frequently (HomeWizard), whose solar/battery fields are null.
    // When AlphaESS Cloud is the only source, GROUP BY returns one row with all
    // fields — firstNonNull() reads from that single row, so it works identically.
    const [rows] = await db.pool.query(`
      SELECT s.timestamp, s.source,
             s.solar_power, s.battery_power, s.battery_soc, s.grid_power, s.load_power,
             s.solar_energy_today, s.grid_energy_import_today, s.grid_energy_export_today,
             s.load_energy_today, s.battery_charge_today, s.battery_discharge_today,
             s.trees_equivalent, s.co2_offset_kg
      FROM energy_snapshots s
      INNER JOIN (
        SELECT source, MAX(timestamp) AS latest
        FROM energy_snapshots
        WHERE timestamp >= datetime('now', '-2 hours')
        GROUP BY source
      ) latest ON s.source = latest.source AND s.timestamp = latest.latest
      ORDER BY s.timestamp DESC
    `);

    if (rows.length === 0) {
      return res.json({
        collector:     { connected: false, message: 'No data yet' },
        today:         {},
        realtime:      {},
        environmental: {},
      });
    }

    // Return the first non-null value for a field across all source rows.
    // Rows are ordered newest-first, so the freshest value always wins.
    const firstNonNull = (field) => {
      for (const row of rows) {
        if (row[field] !== null && row[field] !== undefined) return row[field];
      }
      return null;
    };

    const newest     = rows[0]; // Most recent row overall — used for timestamp/source reporting
    const lastUpdate = new Date(newest.timestamp);
    const dataAge    = Date.now() - lastUpdate.getTime();
    const isConnected = dataAge < 300000;

    // Resolve shared power values used for derivation
    const rawSolarP   = parseFloat(firstNonNull('solar_power'))   || 0;
    const rawBatteryP = parseFloat(firstNonNull('battery_power')) || 0;
    const rawGridP    = parseFloat(firstNonNull('grid_power'))    || 0;
    const rawHomeP    = firstNonNull('load_power');

    // Home consumption is not directly measured in AC-coupled topology.
    // Derive from power balance: home = solar + battery + grid
    //   battery_power < 0 → charging (consuming)   grid_power < 0 → exporting
    // Use a direct load_power measurement when available and non-zero.
    const homePower = (rawHomeP !== null && parseFloat(rawHomeP) > 0)
      ? parseFloat(rawHomeP)
      : Math.max(0, rawSolarP + rawBatteryP + rawGridP);

    // Resolve daily energy totals — reuse named vars to avoid double firstNonNull calls
    const pvGen         = parseFloat(firstNonNull('solar_energy_today'))       || 0;
    const battCharge    = parseFloat(firstNonNull('battery_charge_today'))     || 0;
    const battDischarge = parseFloat(firstNonNull('battery_discharge_today'))  || 0;
    const gridImport    = parseFloat(firstNonNull('grid_energy_import_today')) || 0;
    const gridExport    = parseFloat(firstNonNull('grid_energy_export_today')) || 0;
    const rawLoadEnergy = firstNonNull('load_energy_today');

    // Daily home consumption: pv_gen + batt_discharge − batt_charge + import − export
    const loadEnergy = (rawLoadEnergy !== null && parseFloat(rawLoadEnergy) > 0)
      ? parseFloat(rawLoadEnergy)
      : Math.max(0, pvGen + battDischarge - battCharge + gridImport - gridExport);

    res.json({
      collector: {
        connected:  isConnected,
        lastUpdate: lastUpdate.toISOString(),
        ageSeconds: Math.floor(dataAge / 1000),
        source:     newest.source,
      },
      today: {
        pv_generation:     pvGen,
        load_consumption:  loadEnergy,
        grid_import:       gridImport,
        grid_export:       gridExport,
        battery_charge:    battCharge,
        battery_discharge: battDischarge,
      },
      realtime: {
        timestamp: newest.timestamp,
        battery: {
          soc:   parseFloat(firstNonNull('battery_soc')) || 0,
          power: rawBatteryP,
        },
        solar: {
          total: rawSolarP,
          pv1: 0, pv2: 0, pv3: 0,
        },
        grid: { power: rawGridP },
        home: { power: homePower },
      },
      environmental: {
        co2_saved:        parseFloat(firstNonNull('co2_offset_kg'))    || 0,
        trees_equivalent: parseFloat(firstNonNull('trees_equivalent')) || 0,
      },
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({
      error:         error.message,
      collector:     { connected: false },
      today:         {},
      realtime:      {},
      environmental: {},
    });
  }
});

// ── GET /api/system/collector-status ──────────────────────────────────────

router.get('/collector-status', async (req, res) => {
  try {
    const [recent] = await db.pool.query(
      'SELECT timestamp, source FROM energy_snapshots ORDER BY timestamp DESC LIMIT 1'
    );

    if (recent.length === 0) {
      return res.json({ connected: false, message: 'No data yet' });
    }

    const lastUpdate = new Date(recent[0].timestamp);
    const ageMs      = Date.now() - lastUpdate.getTime();

    res.json({
      connected:   ageMs < 300000,
      lastUpdate:  lastUpdate.toISOString(),
      ageSeconds:  Math.floor(ageMs / 1000),
      source:      recent[0].source,
    });
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.json({ connected: false, error: error.message });
  }
});

// ── GET /api/system/realtime ───────────────────────────────────────────────

router.get('/realtime', async (req, res) => {
  console.log(`   • Front-End - [${new Date().toLocaleString()}] - Collect Power measurements...`);
  try {
    // Same per-source strategy as /summary — see comment there.
    const [rows] = await db.pool.query(`
      SELECT s.battery_soc, s.battery_power, s.solar_power, s.grid_power, s.load_power, s.timestamp, s.source
      FROM energy_snapshots s
      INNER JOIN (
        SELECT source, MAX(timestamp) AS latest
        FROM energy_snapshots
        WHERE timestamp >= datetime('now', '-2 hours')
        GROUP BY source
      ) latest ON s.source = latest.source AND s.timestamp = latest.latest
      ORDER BY s.timestamp DESC
    `);

    if (rows.length === 0) {
      return res.status(503).json({ error: 'No data available' });
    }

    const firstNonNull = (field) => {
      for (const row of rows) {
        if (row[field] !== null && row[field] !== undefined) return row[field];
      }
      return null;
    };

    const rawSolarP   = parseFloat(firstNonNull('solar_power'))   || 0;
    const rawBatteryP = parseFloat(firstNonNull('battery_power')) || 0;
    const rawGridP    = parseFloat(firstNonNull('grid_power'))    || 0;
    const rawHomeP    = firstNonNull('load_power');
    const homePower   = (rawHomeP !== null && parseFloat(rawHomeP) > 0)
      ? parseFloat(rawHomeP)
      : Math.max(0, rawSolarP + rawBatteryP + rawGridP);

    res.json({
      timestamp: rows[0].timestamp,
      battery: {
        soc:   parseFloat(firstNonNull('battery_soc')) || 0,
        power: rawBatteryP,
      },
      solar: { total: rawSolarP, pv1: 0, pv2: 0, pv3: 0 },
      grid:  { power: rawGridP },
      home:  { power: homePower },
    });
  } catch (error) {
    console.error('Error getting realtime data:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/system/devices ────────────────────────────────────────────────
//
// Wijzigingen:
//   CURDATE()                           →  date('now')
//   DATE_SUB(CURDATE(), INTERVAL 1 DAY) →  date('now', '-1 day')
//
// SQLite ondersteunt geen correlated subqueries in het FROM-deel op dezelfde manier,
// maar de subqueries IN de SELECT zijn wel ondersteund.

router.get('/devices', async (req, res) => {
  try {
    console.log(`   • Front-End - [${new Date().toLocaleString()}] - Fetching device measurements...`);

    const [devices] = await db.pool.query(`
      SELECT
        dm.*,ds.id as device_settings_id,
        ds.name, ds.ip_address, ds.product_type, ds.module,
        ds.enabled, ds.brightness, ds.switch_lock, ds.priority,
        (
          SELECT energy_total
          FROM device_measurements
          WHERE device_id = dm.device_id
            AND date(timestamp) = date('now')
          ORDER BY timestamp DESC
          LIMIT 1
        )
        -
        (
          SELECT energy_total
          FROM device_measurements
          WHERE device_id = dm.device_id
            AND date(timestamp) = date('now', '-1 day')
          ORDER BY timestamp DESC
          LIMIT 1
        )
        AS energy_today_calc

      FROM device_measurements dm
        INNER JOIN (
          SELECT device_id, MAX(timestamp) AS latest_timestamp
          FROM device_measurements
          GROUP BY device_id
        ) latest ON dm.device_id = latest.device_id
               AND dm.timestamp  = latest.latest_timestamp
        LEFT JOIN device_settings ds ON ds.serial = dm.device_id
      WHERE ds.enabled = 1
      ORDER BY dm.power DESC
    `);

    console.log(`   - Found ${devices.length} devices with measurements`);

    const devicesWithParsedMetrics = devices.map(device => {
      let extraMetrics = null;
      if (device.extra_metrics) {
        try {
          extraMetrics = typeof device.extra_metrics === 'string'
            ? JSON.parse(device.extra_metrics)
            : device.extra_metrics;
        } catch (error) {
          console.warn(`Failed to parse extra_metrics for device ${device.device_id}:`, error);
        }
      }

      const energyToday = device.energy_today_calc !== null && device.energy_today_calc !== undefined
        ? parseFloat(device.energy_today_calc)
        : parseFloat(device.energy_today) || 0;

      return {
        id:            device.id,
        device_settings_id: device.device_settings_id,
        timestamp:     device.timestamp,
        device_id:     device.device_id,
        device_type:   device.device_type,
        device_name:   device.device_name,
        source:        device.source,
        brightness:    device.brightness,
        switch_lock:   device.switch_lock,
        power:         parseFloat(device.power)        || 0,
        voltage:       parseFloat(device.voltage)      || 0,
        current:       parseFloat(device.current)      || 0,
        energy_today:  energyToday,
        energy_total:  parseFloat(device.energy_total) || 0,
        extra_metrics: extraMetrics,
        wifi_ssid:     extraMetrics?.wifi_ssid     || null,
        wifi_strength: extraMetrics?.wifi_strength || null,
        ipaddress:     device.ip_address,
        enabled:       device.enabled,
      };
    });

    res.json({
      devices:   devicesWithParsedMetrics,
      count:     devicesWithParsedMetrics.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('✗ Error fetching device measurements:', error);
    res.status(500).json({
      error:   'Failed to fetch device measurements',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ── GET /api/system/schemas/active ────────────────────────────────────────

router.get('/schemas/active', async (req, res) => {
  try {
    const [modules] = await db.pool.query(
      'SELECT module FROM device_settings GROUP BY module'
    );

    const activeSchemas = {};
    for (const row of modules) {
      const moduleName = row.module;
      if (!moduleName) continue;
      const schema = await systemConfigService.getSchemaByModule(moduleName);
      if (schema) activeSchemas[moduleName] = schema;
    }

    res.json({ success: true, schemas: activeSchemas, count: Object.keys(activeSchemas).length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/system/devices/:deviceId ─────────────────────────────────────

router.get('/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`   • FrontEnd - [${new Date().toLocaleString()}] - Fetching measurements for device: ${deviceId}`);

    const [devices] = await db.pool.query(
      `SELECT * FROM device_measurements WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1`,
      [deviceId]
    );

    if (devices.length === 0) {
      return res.status(404).json({
        error:   'Device not found',
        message: `No measurements found for device ${deviceId}`,
      });
    }

    const device = devices[0];
    let extraMetrics = null;
    if (device.extra_metrics) {
      try {
        extraMetrics = typeof device.extra_metrics === 'string'
          ? JSON.parse(device.extra_metrics)
          : device.extra_metrics;
      } catch (error) {
        console.warn(`Failed to parse extra_metrics for device ${deviceId}:`, error);
      }
    }

    res.json({
      id:            device.id,
      timestamp:     device.timestamp,
      device_id:     device.device_id,
      device_type:   device.device_type,
      device_name:   device.device_name,
      source:        device.source,
      power:         parseFloat(device.power)        || 0,
      voltage:       parseFloat(device.voltage)      || 0,
      current:       parseFloat(device.current)      || 0,
      energy_today:  parseFloat(device.energy_today) || 0,
      energy_total:  parseFloat(device.energy_total) || 0,
      extra_metrics: extraMetrics,
      wifi_ssid:     extraMetrics?.wifi_ssid     || null,
      wifi_strength: extraMetrics?.wifi_strength || null,
    });

  } catch (error) {
    console.error('✗ Error fetching device measurement:', error);
    res.status(500).json({
      error:   'Failed to fetch device measurement',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ── GET /api/system/devices-list ──────────────────────────────────────────
//
// Wijziging:
//   ddu.date = CURDATE()  →  ddu.date = date('now')

router.get('/devices-list', async (req, res) => {
  try {
    console.log(`   • FrontEnd - [${new Date().toLocaleString()}] - Fetching aggregated device usage...`);

    const [devices] = await db.pool.query(`
      SELECT
        ds.*,
        COALESCE(ddu.usage_kwh, 0) AS usage_today,
        ddu.last_update
      FROM device_settings ds
      LEFT JOIN device_daily_usage ddu
        ON ds.serial = ddu.device_id
        AND ddu.date = date('now')
      ORDER BY usage_today DESC
    `);

    const normalizedDevices = devices.map(device => ({
      id:            device.id,
      name:          device.name,
      brightness:    device.brightness,
      switch_lock:   device.switch_lock,
      power:         parseFloat(device.power) || 0,
      serial:        device.serial,
      module:        device.module,
      product_type:  device.product_type,
      ip_address:    device.ip_address,
      usage_today:   parseFloat(device.usage_today) || 0,
      last_update:   device.last_update,
      priority:      device.priority,
      enabled:       device.enabled,
      poll_interval: device.poll_interval,
    }));

    res.json({
      success:   true,
      count:     normalizedDevices.length,
      devices:   normalizedDevices,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('✗ Error fetching aggregated device usage:', error.message);
    res.status(500).json({
      success: false,
      error:   'Failed to fetch device usage data',
      message: error.message,
    });
  }
});

// ── GET /api/system/events ─────────────────────────────────────────────────

router.get('/events', async (req, res) => {
  try {
    const [rows] = await db.pool.query(`
      SELECT e.*, u.username
      FROM events e
      LEFT JOIN users u ON e.userId = u.id
      ORDER BY e.timestamp DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ── GET /api/system/devices/chart ─────────────────────────────────────────
//
// Returns time-bucketed average power per smart device for a given date.
// Excludes P1 meter (HWE-P1). Only returns devices with actual usage (MAX > 0).
// Device name always sourced from device_settings to avoid stale names in
// device_measurements (some rows have generic "Energy Socket" as device_name).

router.get('/devices-chart', async (req, res) => {
  try {
    const { date, granularity = '5' } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }

    const interval = Math.max(1, Math.min(60, parseInt(granularity, 10) || 5));
    const start    = `${date} 00:00:00`;
    const end      = `${date} 23:59:59`;

    // interval appears twice: once for integer division, once for multiplication
    const [rows] = await db.pool.query(`
      SELECT
        dm.device_id,
        ds.name                                             AS device_name,
        STRFTIME('%Y-%m-%d %H:', dm.timestamp) ||
          PRINTF('%02d',
            (CAST(STRFTIME('%M', dm.timestamp) AS INTEGER) / ?) * ?
          )                                                 AS bucket,
        ROUND(AVG(dm.power), 1)                             AS avg_power,
        ROUND(MAX(dm.power), 1)                             AS peak_power
      FROM device_measurements dm
      JOIN device_settings ds ON ds.serial = dm.device_id
      WHERE dm.device_type  = 'HWE-SKT'
        AND dm.timestamp   >= ?
        AND dm.timestamp   <= ?
        AND dm.power       IS NOT NULL
      GROUP BY dm.device_id, bucket
      HAVING MAX(dm.power) >= 0
      ORDER BY ds.name, bucket
    `, [interval, interval, start, end]);

    // Pivot flat rows → one entry per device, preserving insertion order (sorted by name)
    const deviceMap = new Map();
    for (const row of rows) {
      if (!deviceMap.has(row.device_id)) {
        deviceMap.set(row.device_id, {
          device_id:   row.device_id,
          device_name: row.device_name,
          data:        [],
        });
      }
      deviceMap.get(row.device_id).data.push({
        bucket:     row.bucket,
        avg_power:  row.avg_power,
        peak_power: row.peak_power,
      });
    }

    res.json({
      date,
      granularity: interval,
      devices:     [...deviceMap.values()],
      count:       deviceMap.size,
    });

  } catch (error) {
    console.error('✗ Error fetching device chart data:', error.message);
    res.status(500).json({
      error:   'Failed to fetch device chart data',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});
router.get('/devices-daily', async (req, res) => {
  try {
    const { date } = req.query;
 
    if (!date) {
      return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    }
 
    const [rows] = await db.pool.query(`
      SELECT
        ds.serial AS device_id,
        ds.name   AS device_name,
        ROUND(
          COALESCE((
            SELECT energy_total FROM device_measurements
            WHERE device_id       = ds.serial
              AND date(timestamp) = ?
            ORDER BY timestamp DESC LIMIT 1
          ), 0)
          -
          COALESCE((
            SELECT energy_total FROM device_measurements
            WHERE device_id       = ds.serial
              AND date(timestamp) = date(?, '-1 day')
            ORDER BY timestamp DESC LIMIT 1
          ), 0)
        , 3) AS daily_kwh
      FROM device_settings ds
      WHERE ds.product_type = 'HWE-SKT'
        AND ds.enabled      = 1
      ORDER BY daily_kwh DESC
    `, [date, date]);
 
    res.json({
      date,
      devices: rows,
      count:   rows.length,
    });
 
  } catch (error) {
    console.error('✗ Error fetching daily device usage:', error.message);
    res.status(500).json({
      error:   'Failed to fetch daily device usage',
      message: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});
export default router;