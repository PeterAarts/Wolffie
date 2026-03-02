import db from '../../../core/database.js';
import matterAPI from './api.js';

class MatterCollector {
  constructor() {
    this.devices = [];
    this.devicesLoaded = false;
    this.lastCollectionTime = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  /**
   * Load devices configured for the Matter module from DB
   */
  async loadDevices() {
    const [rows] = await db.pool.query(
      "SELECT * FROM device_settings WHERE module = 'matter' AND enabled = 1"
    );
    this.devices = rows;
    this.devicesLoaded = true;
  }

  /**
   * Main collection cycle called by CollectorManager
   */
async collect() {
    try {
      if (!this.devicesLoaded) await this.loadDevices();
      if (this.devices.length === 0) return true;

      // Use allSettled so one dead plug doesn't kill the whole loop
      const results = await Promise.allSettled(
        this.devices.map(device => this.collectFromDevice(device))
      );

      this.lastCollectionTime = new Date();
      
      // Determine if the overall cycle was successful
      const failures = results.filter(r => r.status === 'rejected');
      this.consecutiveErrors = failures.length;

      if (failures.length > 0) {
        this.lastError = failures[0].reason?.message || 'Partial collection failure';
        // If ALL devices failed, tell the manager this cycle was a failure
        return failures.length < this.devices.length; 
      }
      
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error.message;
      return false; // Tells CollectorManager to increment error count and potentially pause
    }
  }

  /**
   * Fetches data for a specific Matter Node
   */
  async collectFromDevice(device) {
    // device.serial contains the Matter NodeID
    const data = await matterAPI.getDeviceAttributes(device.serial);
    
    // Map Matter Clusters to WattsOn Schema
    // Matter uses 'activePower' in milliWatts usually, or 'activeCurrent'
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, energy_total, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date(),
        device.serial,
        device.product_type || 'matter-device',
        device.name,
        'matter',
        (data.activePower / 1000) || 0, // Convert mW to W
        data.cumulativeEnergy / 1000 || 0, // Convert Wh to kWh
        JSON.stringify({
            voltage: data.voltage / 1000,
            current: data.current / 1000,
            matter_node_id: device.serial
        })
      ]
    );
  }

  getStatus() {
    return {
      deviceCount: this.devices.length,
      lastCollection: this.lastCollectionTime,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export default new MatterCollector();