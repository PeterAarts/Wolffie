// modules/alphaess-cloud/services/api.js
import axios from 'axios';
import crypto from 'crypto';
import settingsService from '../../../core/system/services/settingsService.js';

/**
 * AlphaESS Cloud API Client
 * Documentation: https://open.alphaess.com
 * 
 * Authentication uses:
 * - appId: Your application ID
 * - appSecret: Your application secret
 * - timestamp: Current Unix timestamp (seconds)
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
    const appId = await settingsService.get('cloud_api', 'app_id');
    const appSecret = await settingsService.get('cloud_api', 'app_secret');
    const systemSn = await settingsService.get('cloud_api', 'system_sn');
    const endpointUrl = (await settingsService.get('cloud_api', 'endpoint_url')) || this.baseURL;

    if (!appId || !appSecret) {
      throw new Error('Cloud API credentials not configured (missing app_id or app_secret)');
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
      console.warn(`⚠️ Timestamp drift: ${diff} seconds. Server clock may be wrong!`);
    }
    
    const signString = `${appId}${appSecret}${timestamp}`;
    return crypto.createHash('sha512').update(signString).digest('hex');
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
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = this.generateSignature(appId, appSecret, timestamp);
    const time = new Date().toISOString();

    try {
      const config = {
        method,
        url: `${endpointUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'appId': appId,
          'timeStamp': timestamp,
          'sign': sign
        },
        params: params,  // Only endpoint-specific params here
        timeout: 10000
      };

      console.log('  - Cloud-API =>', time, 'Request', config.url);

      this.lastRequestTime = Date.now();
      this.requestCount++;

      const response = await axios(config);
      
      // AlphaESS API returns code in response body
      if (response.data.code !== 200) {
        throw new Error(response.data.msg || 'API request failed');
      }

      this.lastError = null;
      return response.data;

    } catch (error) {
      this.lastError = {
        message: error.message,
        timestamp: Date.now(),
        endpoint
      };
      console.error(`AlphaESS API Error [${endpoint}]:`, error.message);
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
   * Endpoint: /getOneDateEnergy
   * 
   * @param {string} queryDate - Format: YYYY-MM-DD
   */
  async getOneDayPowerData(queryDate, sysSn = null) {
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
   * Get one day energy statistics (daily totals)
   * Endpoint: /getOneDayEnergy
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

    const response = await this.makeRequest('/getOneDayEnergy', {
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
        power: apiData.ppv || 0,
        pv1Power: apiData.ppv1 || 0,
        pv2Power: apiData.ppv2 || 0,
        pv3Power: apiData.ppv3 || 0,
        pv4Power: apiData.ppv4 || 0,
        voltage1: apiData.upv1 || 0,
        voltage2: apiData.upv2 || 0,
        voltage3: apiData.upv3 || 0,
        voltage4: apiData.upv4 || 0
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
      await this.getLastPowerData();
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return { success: false, message: error.message };
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