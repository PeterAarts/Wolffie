// modules/homewizard/services/deviceService.js
import db from '../../../core/database.js';
import homewizardAPI from './api.js';

class DeviceService {
  /**
   * Get all configured HomeWizard devices
   */
  async getAllDevices() {
    const [devices] = await db.pool.query(
      `SELECT * FROM device_settings WHERE module = 'homewizard' ORDER BY name`
    );
    return devices;
  }

  /**
   * Get a single device by ID
   */
  async getDevice(id) {
    const [rows] = await db.pool.query(
      `SELECT * FROM device_settings WHERE id = ? AND module = 'homewizard'`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Create a new device
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
   * Update an existing device – only allows known columns
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
   * Delete a device by ID
   */
  async deleteDevice(id) {
    await db.pool.query(
      `DELETE FROM device_settings WHERE id = ? AND module = 'homewizard'`,
      [id]
    );
  }

  /**
   * Scan local network for HomeWizard devices via API,
   * insert any that aren't already in device_settings
   */
  async discoverDevices() {
    try {
      const discovered = await homewizardAPI.discoverDevices();
      console.log(`HomeWizard discovery found ${discovered.length} device(s)`);

      for (const device of discovered) {
        // Skip if already tracked by IP
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