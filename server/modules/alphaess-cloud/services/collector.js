// modules/alphaess-cloud/services/collector.js
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';
import alphaessAPI from './api.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('AlphaESS CloudAPI');

class AlphaESSCloudCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError          = null;
    this.consecutiveErrors  = 0;
  }

  async collect() {
    try {
      const systemSn = await settingsService.get('alphaess-cloud', 'system_sn');
      const [powerData, summaryData] = await Promise.all([
        alphaessAPI.getLastPowerData(),
        alphaessAPI.getDailySummary()
      ]);
      await this.storeSnapshot(powerData, summaryData, systemSn);
      this.lastCollectionTime = new Date();
      this.lastError          = null;
      this.consecutiveErrors  = 0;
      return true;
    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error(`\x1b[31m   • ${PREFIX} - collection failed:`, error.message, '\x1b[37m');
      return false;
    }
  }

  async storeSnapshot(powerData, summaryData, systemSn = 'unknown') {
    await db.pool.query(
      `INSERT INTO energy_snapshots (
        timestamp, source, device_id,
        solar_power, solar_energy_today,
        battery_power, battery_soc, battery_voltage, battery_current, battery_temp,
        grid_power, grid_voltage_l1, grid_voltage_l2, grid_voltage_l3,
        grid_current_l1, grid_current_l2, grid_current_l3, grid_frequency,
        grid_energy_import_today, grid_energy_export_today,
        load_power, load_energy_today, inverter_temp, inverter_power,
        battery_charge_today, battery_discharge_today,
        trees_equivalent, co2_offset_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localTimestamp(),
        'alphaess-cloud',
        systemSn,
        powerData.ppv          || 0,
        summaryData.epvtoday   || 0,
        powerData.pbat         || 0,
        powerData.soc          || powerData.cbat || 0,
        powerData.vbat         || 0,
        powerData.ibat         || 0,
        powerData.batTemperature || 0,
        powerData.pgrid        || 0,
        powerData.uagrid       || powerData.ugrid || 0,
        0, 0, 0, 0, 0,
        powerData.fgrid        || 50.0,
        summaryData.einput     || 0,
        summaryData.eoutput    || 0,
        powerData.pload        || 0,
        summaryData.eload      || 0,
        powerData.tempInv      || powerData.tinv || 0,
        powerData.pinv         || 0,
        summaryData.echarge    || 0,
        summaryData.edischarge || 0,
        summaryData.treeNum    || 0,
        summaryData.carbonNum  || 0,
      ]
    );
  }

  getStatus() {
    return {
      lastCollection:    this.lastCollectionTime,
      lastError:         this.lastError,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

export default new AlphaESSCloudCollector();