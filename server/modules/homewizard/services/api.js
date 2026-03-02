// modules/homewizard/services/api.js
import axios from 'axios';

class HomeWizardAPI {
  /**
   * Fetch measurement data from a HomeWizard device.
   * Returns: power_w, total_power_import_kwh, voltage_l1_v, etc.
   */
  async getData(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/data`, {
        timeout: 3000
      });
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') throw new Error('Request timeout');
      if (error.response) throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Fetch device identification info.
   * Returns: product_type, product_name, serial, firmware_version, api_version
   */
  async getInfo(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api`, {
        timeout: 3000
      });
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') throw new Error('Request timeout');
      if (error.response) throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Fetch system configuration from device.
   * Returns: status_led_brightness_pct, cloud_enabled, uptime_s, wifi_ssid, wifi_rssi_db
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
   * Push system-level settings to the device.
   * Supported fields: status_led_brightness_pct (0-100)
   *
   * Examples:
   *   setSystem(ip, 80, { status_led_brightness_pct: 0 })   // LED off
   *   setSystem(ip, 80, { status_led_brightness_pct: 100 }) // LED full brightness
   *
   * HomeWizard Local API endpoint: PUT /api/v1/system
   */
  async setSystem(ipAddress, port = 80, settings = {}) {
    try {
      const validKeys = ['status_led_brightness_pct'];
      const invalidKeys = Object.keys(settings).filter(k => !validKeys.includes(k));

      if (invalidKeys.length > 0) {
        throw new Error(`Invalid system keys: ${invalidKeys.join(', ')}. Valid keys: ${validKeys.join(', ')}`);
      }

      if (Object.keys(settings).length === 0) {
        throw new Error('settings object cannot be empty');
      }

      if ('status_led_brightness_pct' in settings) {
        const v = settings.status_led_brightness_pct;
        if (typeof v !== 'number' || v < 0 || v > 100) {
          throw new Error('status_led_brightness_pct must be a number between 0 and 100');
        }
      }

      const response = await axios.put(
        `http://${ipAddress}:${port}/api/v1/system`,
        settings,
        {
          timeout: 3000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        const { status, data } = error.response;
        if (status === 400) throw new Error(`Bad request: ${data?.message || 'Invalid system parameters'}`);
        if (status === 403) throw new Error('Device API is disabled');
        throw new Error(`HTTP ${status}: ${error.response.statusText}`);
      }
      throw new Error(`Failed to set system settings: ${error.message}`);
    }
  }

  /**
   * Get current device state.
   * Returns: power_on (bool), switch_lock (bool)
   */
  async getState(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/state`, {
        timeout: 3000
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 422) {
        throw new Error('Device does not support state control (e.g. P1 meter)');
      }
      throw new Error(`Failed to get device state: ${error.message}`);
    }
  }

    /**
   * Set device state (power switch, lock, and/or brightness).
   *
   * @param {string} ipAddress  - IP of the Energy Socket
   * @param {number} port       - API port (default 80)
   * @param {object} state      - State object to push
   * @param {boolean} [state.power_on]    - Turn on (true) / off (false)
   * @param {boolean} [state.switch_lock] - Lock (true) / unlock (false) physical button
   * @param {number} [state.brightness]  - LED brightness (0-255)
   *
   * HomeWizard Local API endpoint: PUT /api/v1/state
   */
  async setState(ipAddress, port = 80, state = {}) {
    try {
      // 1. ADD 'brightness' to validKeys to stop it from throwing an error
      const validKeys = ['power_on', 'switch_lock', 'brightness'];
      const invalidKeys = Object.keys(state).filter(k => !validKeys.includes(k));

      if (invalidKeys.length > 0) {
        throw new Error(`Invalid state keys: ${invalidKeys.join(', ')}`);
      }

      // 2. Validate brightness range
      if ('brightness' in state) {
        if (!Number.isInteger(state.brightness) || state.brightness < 0 || state.brightness > 255) {
          throw new Error('brightness must be an integer between 0 and 255');
        }
      }
      console.log({ message: 'Setting device state', ipAddress, port, state });
      // 3. Send to physical device
      const response = await axios.put(
        `http://${ipAddress}:${port}/api/v1/state`,
        state,
        { timeout: 3000, headers: { 'Content-Type': 'application/json' } }
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to set device state: ${error.message}`);
    }
  }


  /**
   * Identify device (blink LED briefly).
   * HomeWizard Local API endpoint: PUT /api/v1/identify
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
   * Quick connectivity test.
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
   * Discover HomeWizard devices on the local network by scanning an IP range.
   * Note: scanning 254 addresses can take a while; use with care.
   */
  async discoverDevices(ipRange = '192.168.1') {
    const devices = [];
    const promises = [];

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
          .catch(() => { /* not a HomeWizard device or unreachable */ })
      );
    }

    await Promise.allSettled(promises);
    return devices;
  }
}

export default new HomeWizardAPI();