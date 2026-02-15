// modules/homewizard/services/api.js
import axios from 'axios';

class HomeWizardAPI {
  /**
   * Fetch data from a HomeWizard device
   */
  async getData(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/data`, {
        timeout: 3000
      });

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout');
      }
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      }
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Fetch device information/status
   */
  async getInfo(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api`, {
        timeout: 3000
      });

      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Request timeout');
      }
      if (error.response) {
        throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      }
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Fetch system information (firmware, product type, etc.)
   */
  async getSystem(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/system`, {
        timeout: 3000
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get system info: ${error.message}`);
    }
  }

  /**
   * Identify device (blink LED)
   */
  async identify(ipAddress, port = 80) {
    try {
      const response = await axios.put(`http://${ipAddress}:${port}/api/v1/identify`, {}, {
        timeout: 3000
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to identify device: ${error.message}`);
    }
  }

  /**
   * Set device state (control power switch and lock)
   * @param {string} ipAddress - Device IP address
   * @param {number} port - Device port (default 80)
   * @param {object} state - State object with power_on and/or switch_lock
   * @param {boolean} state.power_on - Turn device on (true) or off (false)
   * @param {boolean} state.switch_lock - Lock (true) or unlock (false) the switch
   * 
   * Examples:
   * - Turn on: setState(ip, 80, { power_on: true })
   * - Turn off: setState(ip, 80, { power_on: false })
   * - Lock switch: setState(ip, 80, { switch_lock: true })
   * - Turn on and lock: setState(ip, 80, { power_on: true, switch_lock: true })
   */
  async setState(ipAddress, port = 80, state = {}) {
    try {
      // Validate state object
      const validKeys = ['power_on', 'switch_lock'];
      const invalidKeys = Object.keys(state).filter(k => !validKeys.includes(k));
      
      if (invalidKeys.length > 0) {
        throw new Error(`Invalid state keys: ${invalidKeys.join(', ')}. Valid keys: ${validKeys.join(', ')}`);
      }

      if (Object.keys(state).length === 0) {
        throw new Error('State object cannot be empty. Must include power_on and/or switch_lock');
      }

      // Validate boolean values
      if ('power_on' in state && typeof state.power_on !== 'boolean') {
        throw new Error('power_on must be a boolean');
      }

      if ('switch_lock' in state && typeof state.switch_lock !== 'boolean') {
        throw new Error('switch_lock must be a boolean');
      }

      const response = await axios.put(
        `http://${ipAddress}:${port}/api/v1/state`,
        state,
        {
          timeout: 3000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (status === 400) {
          throw new Error(`Bad request: ${data?.message || 'Invalid state parameters'}`);
        } else if (status === 403) {
          throw new Error('Device API is disabled or locked');
        } else if (status === 422) {
          throw new Error('Device does not support state control (e.g., P1 meter)');
        }
        
        throw new Error(`HTTP ${status}: ${error.response.statusText}`);
      }
      
      throw new Error(`Failed to set device state: ${error.message}`);
    }
  }

  /**
   * Get current device state
   * @param {string} ipAddress - Device IP address
   * @param {number} port - Device port (default 80)
   * @returns {object} Current state with power_on and switch_lock
   */
  async getState(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/state`, {
        timeout: 3000
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 422) {
        throw new Error('Device does not support state control (e.g., P1 meter)');
      }
      throw new Error(`Failed to get device state: ${error.message}`);
    }
  }

  /**
   * Test connection to device
   */
  async testConnection(ipAddress, port = 80) {
    try {
      await this.getData(ipAddress, port);
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Discover devices on local network (basic implementation)
   * Note: This requires network scanning which may not work in all environments
   */
  async discoverDevices(ipRange = '192.168.1') {
    const devices = [];
    const promises = [];

    // Scan common IP range (1-254)
    for (let i = 1; i <= 254; i++) {
      const ip = `${ipRange}.${i}`;
      
      promises.push(
        this.getInfo(ip)
          .then(info => {
            devices.push({
              ip_address: ip,
              product_type: info.product_type,
              product_name: info.product_name,
              serial: info.serial,
              firmware: info.firmware_version
            });
          })
          .catch(() => {
            // Device not found or not a HomeWizard device
          })
      );
    }

    // Wait for all promises with timeout
    await Promise.allSettled(promises);

    return devices;
  }
}

export default new HomeWizardAPI();