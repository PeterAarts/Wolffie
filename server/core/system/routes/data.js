// server/core/system/routes/data.js
// Updated to read from your existing energy_snapshots table structure
import express from 'express';
import db from '../../database.js';
import systemConfigService from '../services/systemconfigservice.js';

const router = express.Router();

/**
 * GET /api/system/summary
 * Complete dashboard data from latest snapshot
 */
router.get('/summary', async (req, res) => {
  try {
    // Get the latest snapshot with all fields
    const [snapshots] = await db.pool.query(
      `SELECT 
        timestamp,
        source,
        
        -- Real-time power (W)
        solar_power,
        battery_power,
        battery_soc,
        grid_power,
        load_power,
        
        -- Today's energy (kWh)
        solar_energy_today,
        grid_energy_import_today,
        grid_energy_export_today,
        load_energy_today,
        battery_charge_today,
        battery_discharge_today,
        
        -- Environmental
        trees_equivalent,
        co2_offset_kg
      FROM energy_snapshots 
      ORDER BY timestamp DESC 
      LIMIT 1`
    );

    // Check if we have data
    if (snapshots.length === 0) {
      return res.json({
        collector: { connected: false, message: 'No data yet' },
        today: {},
        realtime: {},
        environmental: {}
      });
    }

    const snapshot = snapshots[0];
    const lastUpdate = new Date(snapshot.timestamp);
    const dataAge = Date.now() - lastUpdate.getTime();
    const isConnected = dataAge < 300000; // Less than 5 minutes

    res.json({
      // Collector status
      collector: {
        connected: isConnected,
        lastUpdate: lastUpdate.toISOString(),
        ageSeconds: Math.floor(dataAge / 1000),
        source: snapshot.source
      },

      // Today's accumulated energy (kWh)
      today: {
        pv_generation: parseFloat(snapshot.solar_energy_today) || 0,
        load_consumption: parseFloat(snapshot.load_energy_today) || 0,
        grid_import: parseFloat(snapshot.grid_energy_import_today) || 0,
        grid_export: parseFloat(snapshot.grid_energy_export_today) || 0,
        battery_charge: parseFloat(snapshot.battery_charge_today) || 0,
        battery_discharge: parseFloat(snapshot.battery_discharge_today) || 0
      },

      // Current real-time values (W)
      realtime: {
        timestamp: snapshot.timestamp,
        battery: {
          soc: parseFloat(snapshot.battery_soc) || 0,
          power: parseFloat(snapshot.battery_power) || 0
        },
        solar: {
          total: parseFloat(snapshot.solar_power) || 0,
          pv1: 0,
          pv2: 0,
          pv3: 0
        },
        grid: {
          power: parseFloat(snapshot.grid_power) || 0
        },
        home: {
          power: parseFloat(snapshot.load_power) || 0
        }
      },

      // Environmental impact
      environmental: {
        co2_saved: parseFloat(snapshot.co2_offset_kg) || 0,
        trees_equivalent: parseFloat(snapshot.trees_equivalent) || 0
      }
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ 
      error: error.message,
      collector: { connected: false },
      today: {},
      realtime: {},
      environmental: {}
    });
  }
});

/**
 * GET /api/system/collector-status
 * Simple status: are we getting data?
 */
router.get('/collector-status', async (req, res) => {
  try {
    const [recent] = await db.pool.query(
      'SELECT timestamp, source FROM energy_snapshots ORDER BY timestamp DESC LIMIT 1'
    );

    if (recent.length === 0) {
      return res.json({
        connected: false,
        message: 'No data yet'
      });
    }

    const lastUpdate = new Date(recent[0].timestamp);
    const ageMs = Date.now() - lastUpdate.getTime();
    const ageSec = Math.floor(ageMs / 1000);
    const isConnected = ageMs < 300000; // Less than 5 minutes

    res.json({
      connected: isConnected,
      lastUpdate: lastUpdate.toISOString(),
      ageSeconds: ageSec,
      source: recent[0].source
    });
  } catch (error) {
    console.error('Error getting collector status:', error);
    res.json({
      connected: false,
      error: error.message
    });
  }
});

/**
 * GET /api/system/realtime
 * Current power values (W)
 */
router.get('/realtime', async (req, res) => {
  console.log(`  • Front-End - [${new Date().toLocaleString()}] - Collect Power measurements...`);
  try {
    const [snapshots] = await db.pool.query(
      `SELECT 
        battery_soc,
        battery_power,
        solar_power,
        grid_power,
        load_power,
        timestamp
      FROM energy_snapshots 
      ORDER BY timestamp DESC 
      LIMIT 1`
    );

    if (snapshots.length === 0) {
      return res.status(503).json({
        error: 'No data available'
      });
    }

    const s = snapshots[0];

    res.json({
      timestamp: s.timestamp,
      battery: {
        soc: parseFloat(s.battery_soc) || 0,
        power: parseFloat(s.battery_power) || 0
      },
      solar: {
        total: parseFloat(s.solar_power) || 0,
        pv1: 0,
        pv2: 0,
        pv3: 0
      },
      grid: {
        power: parseFloat(s.grid_power) || 0
      },
      home: {
        power: parseFloat(s.load_power) || 0
      }
    });
  } catch (error) {
    console.error('Error getting realtime data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/system/devices
 * Returns latest measurements for all devices
 */
router.get('/devices', async (req, res) => {
  try {
    console.log(`  • Front-End - [${new Date().toLocaleString()}] - Fetching device measurements...`);
    
    // Get latest measurement for each device
    // Using a subquery to get the most recent measurement per device_id
    const [devices] = await db.pool.query(`
      SELECT 
        dm.*, ds.*
      FROM device_measurements dm
        INNER JOIN (
          SELECT 
              device_id, MAX(timestamp) as latest_timestamp
        FROM device_measurements
        GROUP BY device_id
        ) latest ON dm.device_id = latest.device_id AND dm.timestamp = latest.latest_timestamp
        LEFT JOIN device_settings ds ON ds.serial = dm.device_id
      WHERE ds.enabled=1
      ORDER BY dm.power DESC
    `);

    console.log(`   - Found ${devices.length} devices with measurements`);

    // Parse extra_metrics JSON for each device
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

      return {
        id: device.id,
        timestamp: device.timestamp,
        device_id: device.device_id,
        device_type: device.device_type,
        device_name: device.device_name,
        source: device.source,
        brightness: device.brightness,
        switch_lock: device.switch_lock,
        power: parseFloat(device.power) || 0,
        voltage: parseFloat(device.voltage) || 0,
        current: parseFloat(device.current) || 0,
        energy_today: parseFloat(device.energy_today) || 0,
        energy_total: parseFloat(device.energy_total) || 0,
        extra_metrics: extraMetrics,
        // Add computed fields for convenience
        wifi_ssid: extraMetrics?.wifi_ssid || null,
        wifi_strength: extraMetrics?.wifi_strength || null,
        ipaddress: device.ip_address,
        enabled:device.enabled
      };
    });

    res.json({
      devices: devicesWithParsedMetrics,
      count: devicesWithParsedMetrics.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('✗ Error fetching device measurements:', error);
    res.status(500).json({ 
      error: 'Failed to fetch device measurements',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.get('/schemas/active', async (req, res) => {
  try {
    // 1. Get unique modules currently registered in settings
    const [modules] = await db.pool.query(
      'SELECT module FROM device_settings GROUP BY module'
    );

    const activeSchemas = {};

    // 2. Iterate and collect schemas for each active module
    for (const row of modules) {
      const moduleName = row.module;
      if (!moduleName) continue;

      const schema = await systemConfigService.getSchemaByModule(moduleName);
      if (schema) {
        activeSchemas[moduleName] = schema;
      }
    }

    res.json({ 
      success: true, 
      schemas: activeSchemas,
      count: Object.keys(activeSchemas).length 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
/**
 * GET /api/system/devices/:deviceId
 * Returns latest measurement for a specific device
 */
router.get('/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`  • FrontEnd - [${new Date().toLocaleString()}] - Fetching measurements for device: ${deviceId}`);
    
    // Get latest measurement for this specific device
    const [devices] = await db.pool.query(`
      SELECT 
        dm.*
      FROM device_measurements dm
      WHERE dm.device_id = ?
      ORDER BY dm.timestamp DESC
      LIMIT 1
    `, [deviceId]);

    if (devices.length === 0) {
      return res.status(404).json({ 
        error: 'Device not found',
        message: `No measurements found for device ${deviceId}`
      });
    }

    const device = devices[0];

    // Parse extra_metrics JSON
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

    const deviceData = {
      id: device.id,
      timestamp: device.timestamp,
      device_id: device.device_id,
      device_type: device.device_type,
      device_name: device.device_name,
      source: device.source,
      power: parseFloat(device.power) || 0,
      voltage: parseFloat(device.voltage) || 0,
      current: parseFloat(device.current) || 0,
      energy_today: parseFloat(device.energy_today) || 0,
      energy_total: parseFloat(device.energy_total) || 0,
      extra_metrics: extraMetrics,
      wifi_ssid: extraMetrics?.wifi_ssid || null,
      wifi_strength: extraMetrics?.wifi_strength || null
    };

    console.log(`✔ Found device: ${device.device_name}`);
    res.json(deviceData);

  } catch (error) {
    console.error('✗ Error fetching device measurement:', error);
    res.status(500).json({ 
      error: 'Failed to fetch device measurement',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/system/devices-usage
 * Returns a complete list of all enabled devices from multiple suppliers
 * along with their pre-aggregated energy totals for today.
 */
router.get('/devices-list', async (req, res) => {
  try {
    const now = new Date().toLocaleString();
    console.log(`  • FrontEnd - [${now}] - Fetching aggregated device usage...`);

    // The query joins device_settings with the daily aggregation table.
    // This allows support for HomeWizard, Matter, and other modules in one list.
    const [devices] = await db.pool.query(`
      SELECT 
        ds.*,
        COALESCE(ddu.usage_kwh, 0) AS usage_today,
        ddu.last_update
      FROM device_settings ds
      LEFT JOIN device_daily_usage ddu 
        ON ds.serial = ddu.device_id 
        AND ddu.date = CURDATE()
      ORDER BY usage_today DESC
    `);

    //console.log(`   - Successfully retrieved ${devices.length} devices from the aggregate table`);

    // Normalize the data for the Vue.js frontend
    const normalizedDevices = devices.map(device => ({
      id: device.id,
      name: device.name,
      brightness: device.brightness,
      switch_lock: device.switch_lock,
      power: parseFloat(device.power) || 0,
      serial: device.serial,
      module: device.module,           // e.g., 'homewizard', 'matter'
      product_type: device.product_type, // e.g., 'HWE-P1', 'Matter_Plug'
      ip_address: device.ip_address,
      usage_today: parseFloat(device.usage_today) || 0,
      last_update: device.last_update,
      priority: device.priority,
      enabled: device.enabled,
      poll_interval: device.poll_interval
    }));

    res.json({
      success: true,
      count: normalizedDevices.length,
      devices: normalizedDevices,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('✗ Error fetching aggregated device usage:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch device usage data',
      message: error.message 
    });
  }
});
router.post('/charge', async (req, res) => {
  const { watts, targetSoc } = req.body;
  const userId = req.user.id; // Extracted from JWT token

  // 1. Execute the command on the inverter
  await alphaModule.setGridCharge(true, watts);

  // 2. Log the event with User ID
  await eventService.log({
    category: 'MANUAL',
    action: 'CHARGE',
    source: 'dashboard_ui',
    userId: userId,
    details: { watts, targetSoc, reason: 'User initiated charge' }
  });
  res.json({ success: true });
});

router.get('/events', async (req, res) => {
  try {
    const [rows] = await db.pool.query(`
      SELECT e.*, u.username 
      FROM events e 
      LEFT JOIN users u ON e.userId= u.id 
      ORDER BY e.timestamp DESC LIMIT 100
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function
function avg(arr) {
  if (arr.length === 0) return 0;
  return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
}

export default router;