// modules/alphaess-cloud/services/api.js
import axios from 'axios';
import crypto from 'crypto';
import settingsService from '../../../core/system/services/settingsService.js';
import { url } from 'inspector';
import { padName } from '../../../core/utils/logger.js';
import { localTimestamp } from '../../../core/utils/localTimestamp.js';
const PREFIX = padName('AlphaESS CloudAPI');
/**
 * AlphaESS Cloud API Client
 * Documentation: https://open.alphaess.com
 * 
 * Authentication uses:
 * - appId: Your application ID
 * - appSecret: Your application secret
 * - timeStamp: Current Unix timestamp (seconds)
 * - sign: SHA512 hash signature
 */
class AlphaESSCloudAPI {
  constructor() {
    this.baseURL = 'https://openapi.alphaess.com/api';
    this.lastError = null;
    this.requestCount = 0;
    this.lastRequestTime = 0;
    
    // Rate limiting: AlphaESS limits requests per minute
    this.minRequestInterval = 1000; // 1 second between requests
  }

  /**
   * Get API credentials from settings service
   */
  async getCredentials() {
    const appId = await settingsService.get('alphaess-cloud', 'app_id');
    const appSecret = await settingsService.get('alphaess-cloud', 'app_secret');
    const systemSn = await settingsService.get('alphaess-cloud', 'system_sn');
    const endpointUrl = (await settingsService.get('alphaess-cloud', 'endpoint_url')) || this.baseURL;

    if (!appId || !appSecret) {
      throw new Error(`\x1b[31m   • ${PREFIX} - API credentials not configured (missing app_id or app_secret)`);
    }

    return { appId, appSecret, systemSn, endpointUrl };
  }

  /**
   * Generate signature for API request
   * sign = SHA512(appId + appSecret + timestamp)
   */
  generateSignature(appId, appSecret, timestamp) {
    // Debug: Check timestamp drift
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.abs(now - parseInt(timestamp));
    
    if (diff > 300) {  // More than 5 minutes difference
      console.warn(`\x1b[31m   • ${PREFIX} ⚠️ Timestamp drift: ${diff} seconds. Server clock may be wrong!`);
    }
    
    const signSource = `${appId}${appSecret}${timestamp}`;
    const sign = crypto.createHash('sha512').update(signSource).digest('hex');
    
    /*console.log('  🔐 Signature generated:', {
      appId: appId.substring(0, 10) + '...',
      timestamp,
      signLength: sign.length
    });*/
    
    return sign;
  }

  /**
   * Make authenticated request to AlphaESS API
   */
  async makeRequest(endpoint, params = {}, method = 'GET') {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest)
      );
    }

    const { appId, appSecret, endpointUrl } = await this.getCredentials();
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const sign = this.generateSignature(appId, appSecret, timeStamp);

    try {
      const config = {
        method,
        url: `${endpointUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'appId': appId,
          'timeStamp': timeStamp,
          'sign': sign
        },
        timeout: 10000
      };

      // Add params based on method
      if (method === 'GET' && Object.keys(params).length > 0) {
        config.params = params;
      } else if (method === 'POST' && Object.keys(params).length > 0) {
        config.data = params;
      }

      /*console.log('  📡 Cloud-API Request:', {
        url: config.url,
        method: config.method,
        headers: {
          appId: config.headers.appId.substring(0, 10) + '...',
          timeStamp: config.headers.timeStamp,
          sign: config.headers.sign.substring(0, 20) + '...'
        },
        params: Object.keys(params).length > 0 ? params : 'none'
      });*/

      this.lastRequestTime = Date.now();
      this.requestCount++;

      const response = await axios(config);
      
      console.log(`\x1b[37m   • ${PREFIX} - ${localTimestamp()} - API `, config.url, ' / ', response.status, ' / ', !!response.data.data);

      // AlphaESS API returns code in response body
      if (response.data.code !== 200) {
        throw new Error(response.data.msg || `API request failed with code ${response.data.code}`);
      }

      this.lastError = null;
      return response.data;

    } catch (error) {
      this.lastError = {
        message: error.message,
        timestamp: Date.now(),
        endpoint,
        response: error.response?.data
      };
      
      console.error(`\x1b[31m   • ${PREFIX} - ${localTimestamp()} - API Error:`, 
      //{
      // endpoint,
      // error: error.message,
      // response: error.response?.data
      //}
      );
      
      throw error;
    }
  }

  /**
   * Get list of all ESS systems
   * Endpoint: /getEssList
   */
  async getSystemList() {
    const response = await this.makeRequest('/getEssList');
    return response.data;
  }

  /**
   * Get last power data (real-time)
   * Endpoint: /getLastPowerData
   * 
   * Returns current power flow data:
   * - ppv: PV power (W)
   * - pbat: Battery power (W, positive = charging, negative = discharging)
   * - soc: Battery state of charge (%)
   * - pgrid: Grid power (W, positive = import, negative = export)
   * - pload: Load power (W)
   */
  async getLastPowerData(sysSn = null) {
    const { systemSn } = await this.getCredentials();
    const sn = sysSn || systemSn;
    
    if (!sn) {
      throw new Error('System serial number not configured');
    }

    const response = await this.makeRequest('/getLastPowerData', { sysSn: sn });
    return response.data;
  }

  /**
   * Get one day power data (15-minute intervals)
   * Endpoint: /getOneDatePowerBySn
   * 
   * @param {string} queryDate - Format: YYYY-MM-DD
   */
  async getOneDayPowerData(queryDate, sysSn = null) {
    const { systemSn } = await this.getCredentials();
    const sn = sysSn || systemSn;
    
    if (!sn) {
      throw new Error('System serial number not configured');
    }

    const response = await this.makeRequest('/getOneDatePowerBySn', {
      sysSn: sn,
      queryDate: queryDate
    });
    return response.data;
  }

  /**
   * Get one day energy statistics (daily totals)
   * Endpoint: /getOneDateEnergy
   * 
   * Returns:
   * - epvTotal: Total PV generation (kWh)
   * - eCharge: Battery charged (kWh)
   * - eDischarge: Battery discharged (kWh)
   * - eGridCharge: Grid to battery (kWh)
   * - eInput: Grid import (kWh)
   * - eOutput: Grid export (kWh)
   * - eLoad: Load consumption (kWh)
   */
  async getOneDayEnergy(queryDate, sysSn = null) {
    const { systemSn } = await this.getCredentials();
    const sn = sysSn || systemSn;
    
    if (!sn) {
      throw new Error('System serial number not configured');
    }

    const response = await this.makeRequest('/getOneDateEnergy', {
      sysSn: sn,
      queryDate: queryDate
    });
    return response.data;
  }

  /**
   * Get charging and discharging periods
   * Endpoint: /getChargeConfigInfo
   */
  async getChargeConfig(sysSn = null) {
    const { systemSn } = await this.getCredentials();
    const sn = sysSn || systemSn;
    
    if (!sn) {
      throw new Error('System serial number not configured');
    }

    const response = await this.makeRequest('/getChargeConfigInfo', { sysSn: sn });
    return response.data;
  }

  /**
   * Get daily summary data for customer
   * Endpoint: /getSumDataForCustomer
   * 
   * Returns daily energy totals and environmental impact:
   * - epvtoday: Today's PV generation (kWh)
   * - eload: Today's load consumption (kWh)
   * - einput: Today's grid import (kWh)
   * - eoutput: Today's grid export (kWh)
   * - echarge: Today's battery charge (kWh)
   * - edischarge: Today's battery discharge (kWh)
   * - treeNum: Equivalent trees planted
   * - carbonNum: CO2 offset (kg)
   */
  async getDailySummary(sysSn = null) {
    const { systemSn } = await this.getCredentials();
    const sn = sysSn || systemSn;
    
    if (!sn) {
      throw new Error('System serial number not configured');
    }

    const response = await this.makeRequest('/getSumDataForCustomer', { sysSn: sn });
    return response.data;
  }

  /**
   * Normalize AlphaESS API data to our internal format
   */
  normalizeRealTimeData(apiData) {
    return {
      battery: {
        soc: apiData.soc || apiData.cbat || 0,
        power: apiData.pbat || 0,
        voltage: apiData.vbat || 0,
        temperature: apiData.tbat || 0,
        current: apiData.ibat || 0
      },
      grid: {
        power: apiData.pgrid || 0,
        voltage: apiData.uagrid || apiData.ugrid || 0,
        frequency: apiData.fgrid || 0,
        current: apiData.igrid || 0
      },
      pv: {
        power:    apiData.ppv  || 0,
        pv1Power: apiData.ppv1 || 0,
        pv2Power: apiData.ppv2 || 0,
        pv3Power: apiData.ppv3 || 0,
        pv4Power: apiData.ppv4 || 0
      },
      load: {
        power: apiData.pload || 0
      },
      inverter: {
        power: apiData.pinv || 0,
        temperature: apiData.tinv || 0
      },
      timestamp: apiData.uploadTime || Date.now()
    };
  }

  /**
   * Normalize daily energy data
   */
  normalizeDailyData(apiData) {
    return {
      date: apiData.uploadDate || apiData.theDate,
      generation: {
        pv: apiData.epvTotal || apiData.epv || 0
      },
      battery: {
        charged: apiData.echarge || apiData.eCharge || 0,
        discharged: apiData.edischarge || apiData.eDischarge || 0
      },
      grid: {
        imported: apiData.eimport || apiData.eInput || 0,
        exported: apiData.efeedIn || apiData.eOutput || 0,
        toBattery: apiData.eGridCharge || 0
      },
      load: {
        consumed: apiData.eload || apiData.eLoad || 0
      }
    };
  }

  /**
   * Check if API is available and authenticated
   */
  async healthCheck() {
    try {
      await this.getSystemList();
      return {
        available: true,
        authenticated: true,
        lastError: null
      };
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        lastError: error.message
      };
    }
  }

  /**
   * Test API connection
   */
  async testConnection() {
    try {
      console.log(' - Testing AlphaESS Cloud API connection...');
      const systems = await this.getSystemList();
      console.log(' - ✅ Connection successful, systems:', systems);
      return { 
        success: true, 
        message: 'Connection successful',
        systems: systems
      };
    } catch (error) {
      console.error(' - ❌ Connection test failed:', error.message);
      return { 
        success: false, 
        message: error.message,
        details: this.lastError
      };
    }
  }

  /**
   * Get API statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      lastRequestTime: this.lastRequestTime,
      lastError: this.lastError
    };
  }

  /**
   * Check if API is available
   */
  isAvailable() {
    return this.lastError === null || 
           (Date.now() - this.lastError.timestamp) > 60000; // Retry after 1 minute
  }
}

export default new AlphaESSCloudAPI();