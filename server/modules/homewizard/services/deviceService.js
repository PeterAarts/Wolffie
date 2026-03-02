// modules/homewizard/services/deviceService.js
import db from '../../../core/database.js';
import homewizardAPI from './api.js';

class DeviceService {
  /**
   * Get all configured HomeWizard devices.
   */
  async getAllDevices() {
    const [devices] = await db.pool.query(
      `SELECT * FROM device_settings WHERE module = 'homewizard' ORDER BY name`
    );
    return devices;
  }

  /**
   * Get a single device by ID.
   */
  async getDevice(id) {
    const [rows] = await db.pool.query(
      `SELECT * FROM device_settings WHERE id = ? AND module = 'homewizard'`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Create a new device.
   */
  async addDevice(data) {
    const { name, ip_address, port, serial, product_type, priority, enabled } = data;

    const [result] = await db.pool.query(
      `INSERT INTO device_settings (module, name, ip_address, port, serial, product_type, priority, enabled)
       VALUES ('homewizard', ?, ?, ?, ?, ?, ?, ?)`,
      [
        name || product_type || 'HomeWizard Device',
        ip_address,
        port || 80,
        serial || null,
        product_type || null,
        priority || 5,
        enabled ?? 1
      ]
    );

    return result.insertId;
  }

  /**
   * Update an existing device — only allows known columns.
   */
  async updateDevice(id, data) {
    const allowed = ['name', 'ip_address', 'port', 'serial', 'product_type', 'priority', 'enabled'];
    const keys = Object.keys(data).filter(k => allowed.includes(k));

    if (keys.length === 0) return;

    const setClauses = keys.map(k => `${k} = ?`);
    const values = keys.map(k => data[k]);

    await db.pool.query(
      `UPDATE device_settings SET ${setClauses.join(', ')} WHERE id = ? AND module = 'homewizard'`,
      [...values, id]
    );
  }

  /**
   * Delete a device by ID.
   */
  async deleteDevice(id) {
    await db.pool.query(
      `DELETE FROM device_settings WHERE id = ? AND module = 'homewizard'`,
      [id]
    );
  }

  /**
   * Enhanced getDailyStats to handle the "usage_today" calculation
   * using the optimized range filter.
   */
  async getDailyStats(id) {
    // First, get the serial for the internal device ID
    const [device] = await db.pool.query('SELECT serial FROM device_settings WHERE id = ?', [id]);
    if (!device.length) return null;

    const serial = device[0].serial;

    // Optimized query to get start and end readings of today
    const [rows] = await db.pool.query(
      `SELECT 
        SUBSTRING_INDEX(MIN(CONCAT(timestamp, '|', energy_total)), '|', -1) + 0 AS first_reading_kwh,
        SUBSTRING_INDEX(MAX(CONCAT(timestamp, '|', energy_total)), '|', -1) + 0 AS latest_reading_kwh
      FROM device_measurements
      WHERE device_id = ? 
        AND timestamp >= CURDATE()`,
      [serial]
    );

    if (!rows.length || rows[0].first_reading_kwh === null) {
      return { firstReadingToday: 0, latestReading: 0, dailyUsedPower: 0 };
    }

    const first = parseFloat(rows[0].first_reading_kwh);
    const latest = parseFloat(rows[0].latest_reading_kwh);

    return {
      firstReadingToday: Math.round(first * 1000),   // Wh
      latestReading:     Math.round(latest * 1000),   // Wh
      dailyUsedPower:    Math.round(Math.max(0, latest - first) * 1000) // Wh
    };
  }
  /**
   * Get the power history for a specific device for the current day.
   * Used for the "power" chart in the edit modal.
   */
  async getDailyHistory(id) {
    const [rows] = await db.pool.query(
      `SELECT 
        timestamp, 
        power 
      FROM device_measurements 
      WHERE device_id = (SELECT serial FROM device_settings WHERE id = ?)
        AND timestamp >= CURDATE()
      ORDER BY timestamp ASC`,
      [id]
    );
    
    return rows.map(r => ({
      timestamp: r.timestamp,
      power: parseFloat(r.power) || 0
    }));
  }
  /**
   * Scan the local network for HomeWizard devices and persist any new ones.
   */
  async discoverDevices() {
    try {
      const discovered = await homewizardAPI.discoverDevices();
      console.log(`HomeWizard discovery found ${discovered.length} device(s)`);

      for (const device of discovered) {
        const [existing] = await db.pool.query(
          `SELECT id FROM device_settings WHERE module = 'homewizard' AND ip_address = ?`,
          [device.ip_address]
        );

        if (existing.length === 0) {
          await this.addDevice({
            name: device.product_name || device.product_type,
            ip_address: device.ip_address,
            serial: device.serial,
            product_type: device.product_type
          });
          console.log(`  + Added: ${device.product_name || device.product_type} at ${device.ip_address}`);
        } else {
          console.log(`  = Already exists: ${device.ip_address}`);
        }
      }

      return discovered.length;
    } catch (error) {
      console.error('HomeWizard discovery failed:', error.message);
      throw error;
    }
  }
}

export default new DeviceService();