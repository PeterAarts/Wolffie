// modules/solar-forecast/services/api.js
import axios from 'axios';
import { padName } from '../../../core/utils/logger.js';
const PREFIX = padName('Solar Forecast');

/**
 * Forecast.Solar API Service
 * Free solar production forecasting API - No registration required!
 * Documentation: https://doc.forecast.solar/
 *
 * Endpoint used: /estimate/watthours/:lat/:lon/:dec/:az/:kwp
 * Returns cumulative watt-hours per hour for the coming days.
 */
class ForecastSolarAPI {
  constructor() {
    this.baseUrl = 'https://api.forecast.solar';
    this.timeout = 15000;
  }

  /**
   * Get solar production forecast (watt-hours per hour, cumulative).
   *
   * @param {object} config
   * @param {number} config.latitude   - Location latitude
   * @param {number} config.longitude  - Location longitude
   * @param {number} config.tilt       - Panel tilt angle 0-90° (default 35)
   * @param {number} config.azimuth    - Panel azimuth 0-360° (0=N 90=E 180=S 270=W, default 180)
   * @param {number} config.kwp        - Installed peak power in kWp
   * @returns {Promise<NormalizedForecast>}
   */
  async getForecast({ latitude, longitude, tilt = 35, azimuth = 180, kwp }) {
    if (!latitude || !longitude || !kwp) {
      throw new Error('Missing required parameters: latitude, longitude, and kwp are required');
    }

    // /estimate/watthours returns cumulative Wh per timestamp
    const url = `${this.baseUrl}/estimate/watthours/${latitude}/${longitude}/${tilt}/${azimuth}/${kwp}`;

    try {
      console.log(`\x1b[37m   • ${PREFIX} - lat=${latitude} lon=${longitude} ${kwp}kWp\x1b[0m`);

      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'Accept'    : 'application/json',
          'User-Agent': 'WattsOn/1.0',
        },
      });

      if (!response.data?.result) {
        throw new Error('Invalid or empty response from Forecast.Solar API');
      }

      return this.normalizeResponse(response.data);

    } catch (error) {
      if (error.response) {
        const { status, data } = error.response;
        const msg = data?.message || 'Unknown error';
        if (status === 400) throw new Error(`Invalid parameters: ${msg}`);
        if (status === 422) throw new Error(`Invalid location/config: ${msg}`);
        if (status === 429) throw new Error('API rate limit exceeded – try again later');
        if (status === 500) throw new Error('Forecast.Solar server error');
        throw new Error(`Forecast.Solar API error ${status}: ${msg}`);
      }
      if (error.request) throw new Error('No response from Forecast.Solar API – check internet connection');
      throw new Error(`Request failed: ${error.message}`);
    }
  }

  /**
   * Normalize API response.
   *
   * The /estimate/watthours endpoint returns:
   *   result.watt_hours      → { "2026-02-22 08:00:00": 0, "2026-02-22 09:00:00": 150, ... }
   *                            Cumulative Wh from midnight; each value is the TOTAL so far that day.
   *   result.watt_hours_day  → { "2026-02-22": 4820, ... }
   *                            Total Wh per calendar day.
   *   result.watts           → { "2026-02-22 08:00:00": 0, ... }
   *                            Instantaneous power (W) at each timestamp.
   *
   * We also compute hourlyWh (delta between consecutive cumulative values)
   * which is what we store in solar_forecast_hourly.
   *
   * @returns {{
   *   wattHours    : Record<string, number>,  raw cumulative Wh (timestamp → Wh)
   *   wattHoursDay : Record<string, number>,  daily totals (date → Wh)
   *   watts        : Record<string, number>,  instantaneous power
   *   hourlyWh     : Record<string, Record<number, number>>  date → { hour → Wh }
   * }}
   */
  normalizeResponse(data) {
    const result = data.result;

    // The /estimate/watthours endpoint returns timestamps DIRECTLY as result keys:
    // { "2026-02-27 08:00:00": 102, "2026-02-27 09:00:00": 686, ... }
    // NOT nested under result.watt_hours
    const wattHours = result;

    // Compute daily totals from the max cumulative value per day
    const wattHoursDay = this.computeDailyTotals(wattHours);

    // Convert cumulative timestamps into per-hour production deltas
    const hourlyWh = this.computeHourlyDeltas(wattHours);

    console.log(`\x1b[37m   • ${PREFIX} - ${Object.keys(hourlyWh).length} days, daily totals: ${JSON.stringify(wattHoursDay)}\x1b[0m`);

    return { wattHours, wattHoursDay, hourlyWh };
  }

  /**
   * Derive daily Wh totals from the cumulative timestamp map.
   * The maximum cumulative value per day = total production that day.
   */
  computeDailyTotals(wattHours) {
    const totals = {};
    for (const [ts, cumWh] of Object.entries(wattHours)) {
      const date = ts.split(' ')[0];
      if (!totals[date] || cumWh > totals[date]) {
        totals[date] = Number(cumWh);
      }
    }
    return totals;
  }

  /**
   * Convert the cumulative watt_hours map into per-hour production deltas.
   *
   * The API returns cumulative Wh building up through the day.
   * e.g.  08:00 → 0 Wh, 09:00 → 150 Wh, 10:00 → 420 Wh
   * → hour 8 produced 150 Wh (150-0), hour 9 produced 270 Wh (420-150)
   *
   * Keys are "YYYY-MM-DD HH:MM:SS" in the location's local time.
   * We parse the date and hour from the key string directly (no Date() parsing)
   * to avoid any UTC / timezone drift.
   *
   * @param {Record<string, number>} wattHours  raw cumulative map
   * @returns {Record<string, Record<number, number>>}  { "YYYY-MM-DD": { 8: 150, 9: 270, ... } }
   */
  computeHourlyDeltas(wattHours) {
    // The API includes non-round sunrise/sunset timestamps e.g. "2026-02-27 07:25:09"
    // Strategy: for each date, find the max cumulative Wh per whole hour.
    // The delta between consecutive hourly max values = production that hour.
    // Non-round timestamps are naturally absorbed into the preceding whole hour.

    // Step 1: group by date, track max cumWh seen up to and including each hour
    const byDate = {};

    for (const [ts, cumWh] of Object.entries(wattHours)) {
      const [datePart, timePart] = ts.split(' ');
      const [hStr, mStr] = timePart.split(':');
      const hour = parseInt(hStr, 10);
      const mins = parseInt(mStr, 10);

      // Assign non-round timestamps to current hour (sunrise at 07:25 → hour 7)
      // They represent the cumulative value at that moment, not a full-hour value
      if (!byDate[datePart]) byDate[datePart] = {};
      const key = hour;
      const cur = byDate[datePart][key];
      // Keep the highest cumulative value seen for this hour
      if (cur === undefined || Number(cumWh) > cur) {
        byDate[datePart][key] = Number(cumWh);
      }
    }

    // Step 2: for each date, compute deltas between consecutive hours
    const result = {};

    for (const [date, hourMap] of Object.entries(byDate)) {
      const hours = Object.keys(hourMap).map(Number).sort((a, b) => a - b);
      result[date] = {};

      for (let i = 0; i < hours.length; i++) {
        const hour    = hours[i];
        const cumWh   = hourMap[hour];
        const prevWh  = i === 0 ? 0 : hourMap[hours[i - 1]];
        result[date][hour] = Math.max(0, cumWh - prevWh);
      }
    }

    return result;
  }

  getAPIInfo() {
    return {
      provider      : 'Forecast.Solar',
      documentation : 'https://doc.forecast.solar/',
      registration  : 'Not required - Free API',
      endpoint      : '/estimate/watthours',
      updateFrequency: 'Every 15 minutes recommended',
    };
  }

  async healthCheck() {
    try {
      await this.getForecast({ latitude: 52.52, longitude: 13.405, tilt: 35, azimuth: 180, kwp: 5 });
      return { available: true, error: null };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }
}

export default new ForecastSolarAPI();