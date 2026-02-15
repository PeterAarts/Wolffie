// modules/alphaess-cloud/services/collector.js
// Fixed: Exact column matching for your table structure
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';
import alphaessAPI from './api.js';

class AlphaESSCloudCollector {
  constructor() {
    this.lastCollectionTime = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  async collect() {
    try {
      console.log(`   - [${new Date().toISOString()}] - Collecting from AlphaESS Cloud API...`);



      const systemSn = await settingsService.get('cloud_api', 'system_sn');

      // Fetch both API endpoints (atomic operation)
      const [powerData, summaryData] = await Promise.all([
        alphaessAPI.getLastPowerData(),
        alphaessAPI.getDailySummary()
      ]);

      // Store complete snapshot
      await this.storeSnapshot(powerData, summaryData, systemSn);

      this.lastCollectionTime = new Date();
      this.lastError = null;
      this.consecutiveErrors = 0;

      //console.log('✅ AlphaESS Cloud data collected successfully');
      return true;

    } catch (error) {
      this.lastError = error.message;
      this.consecutiveErrors++;
      console.error('❌ AlphaESS Cloud collection failed:', error.message);
      return false;
    }
  }

  async storeSnapshot(powerData, summaryData, systemSn = 'unknown') {
    const timestamp = new Date();

    // All 27 columns (excluding id and created_at which are auto)
    await db.pool.query(
      `INSERT INTO energy_snapshots (
        timestamp,
        source,
        device_id,
        solar_power,
        solar_energy_today,
        battery_power,
        battery_soc,
        battery_voltage,
        battery_current,
        battery_temp,
        grid_power,
        grid_voltage_l1,
        grid_voltage_l2,
        grid_voltage_l3,
        grid_current_l1,
        grid_current_l2,
        grid_current_l3,
        grid_frequency,
        grid_energy_import_today,
        grid_energy_export_today,
        load_power,
        load_energy_today,
        inverter_temp,
        inverter_power,
        battery_charge_today,
        battery_discharge_today,
        trees_equivalent,
        co2_offset_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        // 1. timestamp
        timestamp,
        // 2. source
        'alphaess-cloud',
        // 3. device_id
        systemSn,
        // 4. solar_power
        powerData.ppv || 0,
        // 5. solar_energy_today
        summaryData.epvtoday || 0,
        // 6. battery_power
        powerData.pbat || 0,
        // 7. battery_soc
        powerData.soc || powerData.cbat || 0,
        // 8. battery_voltage
        powerData.vbat || 0,
        // 9. battery_current
        powerData.ibat || 0,
        // 10. battery_temp
        powerData.batTemperature || 0,
        // 11. grid_power
        powerData.pgrid || 0,
        // 12. grid_voltage_l1
        powerData.uagrid || powerData.ugrid || 0,
        // 13. grid_voltage_l2
        0,
        // 14. grid_voltage_l3
        0,
        // 15. grid_current_l1
        0,
        // 16. grid_current_l2
        0,
        // 17. grid_current_l3
        0,
        // 18. grid_frequency
        powerData.fgrid || 50.0,
        // 19. grid_energy_import_today
        summaryData.einput || 0,
        // 20. grid_energy_export_today
        summaryData.eoutput || 0,
        // 21. load_power
        powerData.pload || 0,
        // 22. load_energy_today
        summaryData.eload || 0,
        // 23. inverter_temp
        powerData.tempInv || powerData.tinv || 0,
        // 24. inverter_power
        powerData.pinv || 0,
        // 25. battery_charge_today
        summaryData.echarge || 0,
        // 26. battery_discharge_today
        summaryData.edischarge || 0,
        // 27. trees_equivalent
        summaryData.treeNum || 0,
        // 28. co2_offset_kg
        summaryData.carbonNum || 0
      ]
    );

    console.log(`     - Complete energy_snapshot stored `);
 //     Power: SOC=${powerData.soc}%, Solar=${powerData.ppv}W, Grid=${powerData.pgrid}W, Load=${powerData.pload}W
 //     Today: PV=${summaryData.epvtoday}kWh, Load=${summaryData.eload}kWh, Import=${summaryData.einput}kWh, Export=${summaryData.eoutput}kWh
  //    Battery: Charge=${summaryData.echarge}kWh, Discharge=${summaryData.edischarge}kWh
  //    Impact: Trees=${summaryData.treeNum}, CO2=${summaryData.carbonNum}kg`);
  }

  getStatus() {
    return {
      lastCollection: this.lastCollectionTime,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export default new AlphaESSCloudCollector();