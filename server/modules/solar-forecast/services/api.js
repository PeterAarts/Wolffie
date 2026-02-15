// modules/solar-forecast/services/api.js
import axios from 'axios';

/**
 * Forecast.Solar API Service
 * Free solar production forecasting API - No registration required!
 * Documentation: https://doc.forecast.solar/
 */
class ForecastSolarAPI {
  constructor() {
    this.baseUrl = 'https://api.forecast.solar';
    this.timeout = 15000;
  }

  /**
   * Get solar production forecast
   * @param {object} config - Configuration object
   * @param {number} config.latitude - Location latitude
   * @param {number} config.longitude - Location longitude
   * @param {number} config.tilt - Panel tilt angle (0-90 degrees)
   * @param {number} config.azimuth - Panel azimuth (0-360 degrees, 0=North, 90=East, 180=South, 270=West)
   * @param {number} config.kwp - Installed peak power in kWp
   * @returns {object} Forecast data with watt_hours, watt_hours_day, watts
   */
  async getForecast({ latitude, longitude, tilt = 35, azimuth = 180, kwp }) {
    // Validate required parameters
    if (!latitude || !longitude || !kwp) {
      throw new Error('Missing required parameters: latitude, longitude, and kwp are required');
    }

    // Build URL: /estimate/:lat/:lon/:dec/:az/:kwp
    const url = `${this.baseUrl}/estimate/${latitude}/${longitude}/${tilt}/${azimuth}/${kwp}`;

    try {
      console.log(`  🌐 Fetching forecast: lat=${latitude}, lon=${longitude}, ${kwp}kWp`);
      
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'WattsOn/1.0'
        }
      });

      if (!response.data) {
        throw new Error('Empty response from Forecast.Solar API');
      }

      if (!response.data.result) {
        throw new Error('Invalid response format from Forecast.Solar API');
      }

      // Parse and return result
      return this.normalizeResponse(response.data);

    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 400) {
          throw new Error(`Invalid parameters: ${data?.message || 'Bad request'}`);
        } else if (status === 422) {
          throw new Error(`Invalid location or panel configuration: ${data?.message || 'Unprocessable entity'}`);
        } else if (status === 429) {
          throw new Error('API rate limit exceeded - please try again later');
        } else if (status === 500) {
          throw new Error('Forecast.Solar API server error');
        }
        
        throw new Error(`Forecast.Solar API error ${status}: ${data?.message || 'Unknown error'}`);
      } else if (error.request) {
        throw new Error('No response from Forecast.Solar API - check internet connection');
      } else {
        throw new Error(`Request failed: ${error.message}`);
      }
    }
  }

  /**
   * Normalize API response
   * Returns: { wattHours, wattHoursDay, watts, wattsDay }
   */
  normalizeResponse(data) {
    if (!data.result) {
      throw new Error('Missing result in API response');
    }

    const result = data.result;

    return {
      // Hourly cumulative production (Wh)
      wattHours: result.watt_hours || result.wattHours || {},
      
      // Daily total production (Wh per day)
      wattHoursDay: result.watt_hours_day || result.wattHoursDay || {},
      
      // Instantaneous power per timestamp (W)
      watts: result.watts || {},
      
      // Peak power per day (W)
      wattsDay: result.watts_day || result.wattsDay || {},
      
      // Raw result for reference
      raw: result
    };
  }

  /**
   * Get API information
   */
  getAPIInfo() {
    return {
      provider: 'Forecast.Solar',
      documentation: 'https://doc.forecast.solar/',
      registration: 'Not required - Free API!',
      updateFrequency: 'Every 15 minutes recommended',
      advantages: [
        'No API token needed',
        'Simple RESTful API',
        'Global coverage',
        'Accurate forecasts',
        'Free for personal use'
      ],
      parameters: {
        latitude: 'Location latitude (-90 to 90)',
        longitude: 'Location longitude (-180 to 180)',
        tilt: 'Panel tilt angle in degrees (0-90, default: 35)',
        azimuth: 'Panel direction in degrees (0=N, 90=E, 180=S, 270=W, default: 180)',
        kwp: 'Installed peak power in kWp'
      }
    };
  }

  /**
   * Health check for API availability
   */
  async healthCheck() {
    try {
      // Simple test request with example coordinates
      await this.getForecast({
        latitude: 52.52,    // Berlin
        longitude: 13.405,
        tilt: 35,
        azimuth: 180,
        kwp: 5
      });
      
      return { available: true, error: null };
    } catch (error) {
      return { 
        available: false, 
        error: error.message 
      };
    }
  }
}

export default new ForecastSolarAPI();