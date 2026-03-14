// src/services/moduleController.js
import dataCollector from './dataCollector.js';
import settingsService from './settingsService.js';

class ModuleController {
  async restartModule(moduleKey) {
    switch (moduleKey) {
      case 'alphaess_cloud':
      case 'alphaess_modbus':
        return this._restartAlphaESS();
      // future: case 'homewizard': return this._restartHomeWizard();
      default:
        throw new Error(`Unknown module: ${moduleKey}`);
    }
  }

  async stopModule(moduleKey) {
    switch (moduleKey) {
      case 'alphaess_cloud':
      case 'alphaess_modbus':
        await dataCollector.stop();
        return { stopped: true };
      default:
        throw new Error(`Unknown module: ${moduleKey}`);
    }
  }

  async _restartAlphaESS() {
    // Stop if running
    if (dataCollector.isRunning) {
      await dataCollector.stop();
    }

    // Re-read fresh config from DB
    settingsService.clearCache();
    const modbus  = await settingsService.getCategory('modbus');
    const cloud   = await settingsService.getCategory('cloud_api');
    const collect = await settingsService.getCategory('data_collection');

    const config = {};

    if (modbus.modbus_enabled === '1') {
      config.modbusIp      = modbus.modbus_ip_address;
      config.modbusPort    = parseInt(modbus.modbus_port) || 502;
      config.modbusSlaveId = parseInt(modbus.modbus_slave_id) || 85;
    }

    if (cloud.cloud_api_enabled === '1') {
      config.cloudAppId    = cloud.cloud_api_app_id;
      config.cloudAppSecret= cloud.cloud_api_app_secret;
      config.cloudSystemSn = cloud.cloud_api_system_sn;
    }

    config.primarySource    = collect.primary_source || 'cloud';
    config.snapshotInterval = parseInt(collect.snapshot_interval) || 10000;

    await dataCollector.start(config);
    return { started: true, source: dataCollector.currentSource };
  }

  getStatus(moduleKey) {
    if (['alphaess_cloud', 'alphaess_modbus'].includes(moduleKey)) {
      return {
        running: dataCollector.isRunning,
        source:  dataCollector.currentSource,
        ...dataCollector.getStatus()
      };
    }
    throw new Error(`Unknown module: ${moduleKey}`);
  }
}

export default new ModuleController();