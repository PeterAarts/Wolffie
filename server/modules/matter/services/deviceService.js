import db from '../../../core/database.js';
import matterAPI from './api.js';

class DeviceService {
  async getAllDevices() {
    const [devices] = await db.pool.query(
      `SELECT * FROM device_settings WHERE module = 'matter' ORDER BY name`
    );
    return devices;
  }

  async getDevice(id) {
    const [rows] = await db.pool.query(
      `SELECT * FROM device_settings WHERE id = ? AND module = 'matter'`,
      [id]
    );
    return rows[0] || null;
  }

  async getDailyHistory(id) {
    const [rows] = await db.pool.query(
      `SELECT timestamp, power 
       FROM device_measurements 
       WHERE device_id = (SELECT serial FROM device_settings WHERE id = ? AND module = 'matter')
         AND timestamp >= CURDATE()
       ORDER BY timestamp ASC`,
      [id]
    );
    return rows.map(r => ({
      timestamp: r.timestamp,
      power: parseFloat(r.power) || 0,
    }));
  }

  /**
   * Commission a new device and persist it to the database.
   *
   * @param {string} pairingCode  Manual code or QR string (MT:...)
   * @param {string} customName   Friendly display name
   * @param {string} ipAddress    Optional IP for cross-subnet commissioning
   * @param {number} port         Optional port, defaults to 5540
   */
  async commissionAndAdd(pairingCode, customName, ipAddress = null, port = 5540) {
    try {
      const nodeId = await matterAPI.commissionDevice(pairingCode, ipAddress, port);
      const info   = await matterAPI.getNodeInfo(nodeId);

      const [result] = await db.pool.query(
        `INSERT INTO device_settings (module, name, serial, product_type, enabled, priority)
         VALUES ('matter', ?, ?, ?, 1, 5)`,
        [
          customName || info.productName || 'New Matter Device',
          nodeId.toString(),
          info.deviceType || 'socket',
        ]
      );

      return { success: true, id: result.insertId, nodeId };
    } catch (error) {
      throw error;
    }
  }

  async updateDevice(id, data) {
    const { name, enabled, priority } = data;
    await db.pool.query(
      `UPDATE device_settings SET name = ?, enabled = ?, priority = ? 
       WHERE id = ? AND module = 'matter'`,
      [name, enabled, priority, id]
    );
    return { success: true };
  }

  async removeDevice(id) {
    const [device] = await db.pool.query(
      "SELECT serial FROM device_settings WHERE id = ? AND module = 'matter'",
      [id]
    );

    if (device.length > 0) {
      await matterAPI.unpairNode(device[0].serial);
      await db.pool.query("DELETE FROM device_settings WHERE id = ?", [id]);
    }
    return { success: true };
  }

  async discoverDevices() {
    try {
      const discovered = await matterAPI.discoverUncommissionedDevices();

      const [existing] = await db.pool.query(
        "SELECT serial FROM device_settings WHERE module = 'matter'"
      );
      const existingSerials = existing.map(d => d.serial);

      return discovered.filter(d => !existingSerials.includes(d.device_identifier));
    } catch (error) {
      console.error('Matter Discovery Error:', error);
      throw error;
    }
  }
}

export default new DeviceService();