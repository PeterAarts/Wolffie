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