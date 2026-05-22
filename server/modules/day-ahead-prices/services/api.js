// modules/day-ahead-prices/services/api.js
import axios from 'axios';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('Day-Ahead-prices');
/**
 * Energy Charts API Service (Fraunhofer ISE)
 * Alternative to ENTSO-E - No registration required!
 * Documentation: https://api.energy-charts.info/
 */
class EnergyChartsAPI {
  constructor() {
    this.baseUrl = 'https://api.energy-charts.info';
    this.timeout = 15000;
    
    // Supported bidding zones
    this.supportedZones = {
      'DE': 'DE',           // Germany
      'DE-LU': 'DE-LU',     // Germany-Luxembourg
      'AT': 'AT',           // Austria
      'BE': 'BE',           // Belgium
      'NL': 'NL',           // Netherlands
      'FR': 'FR',           // France
      'CH': 'CH',           // Switzerland
      'DK1': 'DK1',         // Denmark West
      'DK2': 'DK2',         // Denmark East
      'NO1': 'NO1',         // Norway 1
      'NO2': 'NO2',         // Norway 2
      'SE1': 'SE1',         // Sweden 1
      'SE2': 'SE2',         // Sweden 2
      'SE3': 'SE3',         // Sweden 3
      'SE4': 'SE4'          // Sweden 4
    };
  }

  /**
   * Get day-ahead electricity prices
   * @param {string} biddingZone - Bidding zone code (e.g., 'NL', 'DE-LU')
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async getDayAheadPrices(biddingZone, startDate, endDate) {
    // Validate bidding zone
    if (!this.supportedZones[biddingZone]) {
      throw new Error(`Unsupported bidding zone: ${biddingZone}. Supported: ${Object.keys(this.supportedZones).join(', ')}`);
    }

    // Format dates for API (YYYY-MM-DD)
    const start = this.formatDateForAPI(startDate);
    const end = this.formatDateForAPI(endDate);

    const url = `${this.baseUrl}/price`;
    
    const params = {
      bzn: biddingZone,
      start: start,
      end: end
    };

    try {
      console.log(`\x1b[37m   • ${PREFIX} - [${new Date().toISOString()}] - Fetching prices: ${url}?bzn=${biddingZone}&start=${start}&end=${end}`);
      const response = await axios.get(url, {
        params,
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Wolffie/1.0'
        }
      });

      if (!response.data) {
        throw new Error('Empty response from Energy Charts API');
      }

      // Parse and normalize response
      return this.normalizeResponse(response.data);

    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 400) {
          throw new Error(`Invalid request parameters: ${data?.message || 'Bad request'}`);
        } else if (status === 404) {
          throw new Error('No price data available for the requested period');
        } else if (status === 429) {
          throw new Error('API rate limit exceeded - please try again later');
        } else if (status === 500) {
          throw new Error('Energy Charts API server error');
        }
        
        throw new Error(`Energy Charts API error ${status}: ${data?.message || 'Unknown error'}`);
      } else if (error.request) {
        throw new Error('No response from Energy Charts API - check internet connection');
      } else {
        throw new Error(`Request failed: ${error.message}`);
      }
    }
  }

  /**
   * Normalize API response to standard format
   * Energy Charts returns: { unix_seconds: [...], price: [...] }
   * We convert to: [{ datetime, priceEurPerMWh, priceEurPerKWh }]
   */
  normalizeResponse(data) {
    const prices = [];

    try {
      // Energy Charts format
      if (!data.unix_seconds || !data.price) {
        throw new Error('Invalid response format from Energy Charts API');
      }

      const timestamps = data.unix_seconds;
      const priceValues = data.price;

      if (timestamps.length !== priceValues.length) {
        throw new Error('Mismatched timestamp and price arrays');
      }

      // Convert to standard format
      for (let i = 0; i < timestamps.length; i++) {
        // Skip null/undefined prices
        if (priceValues[i] === null || priceValues[i] === undefined) {
          continue;
        }

        const datetime = new Date(timestamps[i] * 1000); // Unix seconds to JS Date
        const priceEurPerMWh = priceValues[i];

        prices.push({
          datetime,
          priceEurPerMWh,
          priceEurPerKWh: priceEurPerMWh / 1000
        });
      }

      if (prices.length === 0) {
        throw new Error('No valid price data in API response');
      }

      console.log(`   • ${PREFIX} - Parsed \x1b[97m   ${prices.length} \x1b[37m   price points`);
      return prices;

    } catch (error) {
      throw new Error(`Failed to parse API response: ${error.message}`);
    }
  }

  /**
   * Format date for Energy Charts API (YYYY-MM-DD)
   */
  formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Get today's prices
   * @param {string} biddingZone - Bidding zone code
   */
  async getTodayPrices(biddingZone) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.getDayAheadPrices(biddingZone, today, tomorrow);
  }

  /**
   * Get tomorrow's prices
   * @param {string} biddingZone - Bidding zone code
   */
  async getTomorrowPrices(biddingZone) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    return this.getDayAheadPrices(biddingZone, tomorrow, dayAfter);
  }

  /**
   * Health check for API availability
   */
  async healthCheck() {
    try {
      // Simple test request for yesterday (should always have data)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await this.getDayAheadPrices('DE', yesterday, today);
      
      return { available: true, error: null };
    } catch (error) {
      return { 
        available: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get supported bidding zones
   */
  getSupportedZones() {
    return Object.keys(this.supportedZones);
  }

  /**
   * Get API information
   */
  getAPIInfo() {
    return {
      provider: 'Energy Charts (Fraunhofer ISE)',
      documentation: 'https://api.energy-charts.info/',
      registration: 'Not required - Free API!',
      pricePublication: 'Updated daily around 13:00-14:00 CET',
      supportedZones: this.getSupportedZones(),
      note: 'Free API with no registration required',
      advantages: [
        'No API token needed',
        'Simple JSON format',
        'Reliable data source',
        'Covers major European markets'
      ]
    };
  }
}

export default new EnergyChartsAPI();