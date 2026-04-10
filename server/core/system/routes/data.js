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
    const [snapshots] = await db.pool.query(
      `SELECT
         timestamp, source,
         solar_power, battery_power, battery_soc, grid_power, load_power,
         solar_energy_today, grid_energy_import_today, grid_energy_export_today,
         load_energy_today, battery_charge_today, battery_discharge_today,
         trees_equivalent, co2_offset_kg
       FROM energy_snapshots
       ORDER BY timestamp DESC
       LIMIT 1`
    );

    if (snapshots.length === 0) {
      return res.json({
        collector:     { connected: false, message: 'No data yet' },
        today:         {},
        realtime:      {},
        environmental: {},
      });
    }

    const snapshot  = snapshots[0];
    const lastUpdate = new Date(snapshot.timestamp);
    const dataAge   = Date.now() - lastUpdate.getTime();
    const isConnected = dataAge < 300000;

    res.json({
      collector: {
        connected:  isConnected,
        lastUpdate: lastUpdate.toISOString(),
        ageSeconds: Math.floor(dataAge / 1000),
        source:     snapshot.source,
      },
      today: {
        pv_generation:     parseFloat(snapshot.solar_energy_today)        || 0,
        load_consumption:  parseFloat(snapshot.load_energy_today)         || 0,
        grid_import:       parseFloat(snapshot.grid_energy_import_today)  || 0,
        grid_export:       parseFloat(snapshot.grid_energy_export_today)  || 0,
        battery_charge:    parseFloat(snapshot.battery_charge_today)      || 0,
        battery_discharge: parseFloat(snapshot.battery_discharge_today)   || 0,
      },
      realtime: {
        timestamp: snapshot.timestamp,
        battery: { soc: parseFloat(snapshot.battery_soc) || 0, power: parseFloat(snapshot.battery_power) || 0 },
        solar:   { total: parseFloat(snapshot.solar_power) || 0, pv1: 0, pv2: 0, pv3: 0 },
        grid:    { power: parseFloat(snapshot.grid_power) || 0 },
        home:    { power: parseFloat(snapshot.load_power) || 0 },
      },
      environmental: {
        co2_saved:        parseFloat(snapshot.co2_offset_kg)    || 0,
        trees_equivalent: parseFloat(snapshot.trees_equivalent) || 0,
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
    const [snapshots] = await db.pool.query(
      `SELECT battery_soc, battery_power, solar_power, grid_power, load_power, timestamp
       FROM energy_snapshots
       ORDER BY timestamp DESC
       LIMIT 1`
    );

    if (snapshots.length === 0) {
      return res.status(503).json({ error: 'No data available' });
    }

    const s = snapshots[0];
    res.json({
      timestamp: s.timestamp,
      battery: { soc: parseFloat(s.battery_soc) || 0, power: parseFloat(s.battery_power) || 0 },
      solar:   { total: parseFloat(s.solar_power) || 0, pv1: 0, pv2: 0, pv3: 0 },
      grid:    { power: parseFloat(s.grid_power) || 0 },
      home:    { power: parseFloat(s.load_power) || 0 },
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
        dm.*,
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

export default router;