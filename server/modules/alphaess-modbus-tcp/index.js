// modules/alphaess-modbus-tcp/index.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ModbusRTU from 'modbus-serial';
import settingsService from '../../core/system/services/settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load manifest
const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/**
 * AlphaESS ModBus TCP Module
 * 
 * This module provides AlphaESS ModBus TCP integration for local monitoring
 * and control of the AlphaESS inverter via ModBus TCP protocol.
 */
class AlphaESSModbusTCPModule {
  constructor() {
    this.manifest = manifest;
    this.client = new ModbusRTU();
    this.initialized = false;
    this.connected = false;
    this.config = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
  }

  /**
   * Initialize the module
   */
  async initialize() {
    if (this.initialized) {
      console.log('   - AlphaESS ModBus TCP module already initialized');
      return;
    }
    try {
      console.log(`   - \x1b[93m${this.manifest.id} \x1b[37m`);
      this.config = await settingsService.getCategory(`${this.manifest.id}`);
      
      if (!this.config || this.config.enabled === false) return;
      
      if (!this.config.host || !this.config.port) {
        console.warn('     - Missing connection parameters');
        return;
      }
      
      console.log(`     - ModBus IP: ${this.config.host}:${this.config.port}`);
      console.log(`     - Slave ID: ${this.config.unit_id || 85}`);
      console.log(`     - Poll interval: ${this.config.poll_interval}ms`);

      // Test ModBus connection
      try {
        await this.client.connectTCP(this.config.host, { port: this.config.port });
        await this.client.setID(this.config.unit_id || 85);
        this.connected = true;
        console.log('     - ModBus connection established \x1b[32m✓\x1b[37m');
      } catch (e) {
        console.error('     - ModBus connection failed: \x1b[31m', e.message, '\x1b[37m');
        this.connected = false;
        this.lastError = e.message;
      }

      this.initialized = true;
    } catch (error) {
      console.error('✗ Failed to initialize AlphaESS ModBus TCP module:', error.message);
      throw error;
    }
  }

  /**
   * Start the module (called by module manager)
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Stop the module (called by module manager)
   */
  async stop() {
    console.log('⏹️  AlphaESS ModBus TCP module stopped');
    if (this.connected && this.client) {
      try {
        await this.client.close();
        this.connected = false;
      } catch (error) {
        console.error('Error closing ModBus connection:', error.message);
      }
    }
  }

  /**
   * Get module status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      enabled: this.config?.enabled || false,
      hasConfig: !!this.config,
      connected: this.connected,
      pollInterval: this.config?.poll_interval,
      connection: {
        ip: this.config?.ip,
        port: this.config?.port,
        slaveId: this.config?.slave_id || 85,
        connected: this.connected,
        lastError: this.lastError
      },
      collector: {
        consecutiveErrors: this.consecutiveErrors,
        healthy: this.consecutiveErrors < 3
      }
    };
  }

  /**
   * Collect data (called by CollectorManager)
   */
  async collect() {
    try {
      // Ensure connection
      if (!this.connected) {
        await this.client.connectTCP(this.config.ip, { port: this.config.port });
        await this.client.setID(this.config.slave_id || 85);
        this.connected = true;
      }

      // Read SOC (Register 0x0102)
      const data = await this.client.readHoldingRegisters(0x0102, 1);
      const soc = data.data[0] / 10;
      
      // TODO: Save to database via aggregatorService
      // await aggregatorService.saveSnapshot({ ... });
      
      this.consecutiveErrors = 0;
      this.lastError = null;
      return true;
      
    } catch (e) {
      this.lastError = e.message;
      this.consecutiveErrors++;
      this.connected = false;
      console.error('ModBus collect error:', e.message);
      return false;
    }
  }

  /**
   * Set Grid Charge mode (used by Strategy Engine)
   * @param {boolean} enabled - Enable or disable grid charging
   * @param {number} powerWatts - Charging power in watts (default: 3000)
   */
  async setGridCharge(enabled, powerWatts = 3000) {
    try {
      // Ensure connection
      if (!this.connected) {
        await this.client.connectTCP(this.config.ip, { port: this.config.port });
        await this.client.setID(this.config.slave_id || 85);
        this.connected = true;
      }

      if (enabled) {
        // 1. Set Dispatch Mode to Grid Charge (register 0x0801)
        await this.client.writeRegister(0x0801, 2);
        // 2. Set charging power
        await this.client.writeRegister(0x0802, powerWatts);
        console.log(`⚡ AlphaESS: Grid charging started at ${powerWatts}W`);
      } else {
        // Set back to Self-consumption mode
        await this.client.writeRegister(0x0801, 1);
        console.log(`🛑 AlphaESS: Grid charging stopped`);
      }
      return true;
    } catch (e) {
      console.error('✗ AlphaESS ModBus Write Error:', e.message);
      this.lastError = e.message;
      this.connected = false;
      return false;
    }
  }

  /**
   * Get API routes (if this module provides HTTP endpoints)
   */
  getRoutes() {
    // Import routes dynamically if they exist
    try {
      const routesPath = path.join(__dirname, 'routes', 'index.js');
      if (fs.existsSync(routesPath)) {
        return import('./routes/index.js');
      }
    } catch (error) {
      console.warn('No routes found for AlphaESS ModBus TCP module');
    }
    return null;
  }
}

// Export singleton instance
export default new AlphaESSModbusTCPModule();