// modules/solar-forecast/services/collector.js
import api from './api.js';
import db from '../../../core/database.js';
import settingsService from '../../../core/system/services/settingsService.js';

/**
 * Solar Forecast Collector
 * Fetches daily solar generation predictions from Forecast.Solar API
 * Free API - No registration required!
 */
class SolarForecastCollector {
  constructor() {
    this.name = 'solar-forecast';
    this.lastError = null;
    this.lastRun = null;
  }

  /**
   * Main collection method called by collectorManager
   */
  async collect() {
    this.lastError = null;
    let recordsCollected = 0;

    try {
      console.log('☀️  Solar Forecast: Starting collection...');

      // Load settings from database (same as other modules)
      const settings = await settingsService.getCategory('solar-forecast');

      if (!settings || settings.enabled === false) {
        console.log('⏭️  Solar Forecast: Disabled in settings');
        return false; // Return false instead of object
      }

      // Validate required settings
      const { latitude, longitude, tilt, azimuth, kwp } = settings;

      if (!latitude || !longitude || !kwp) {
        this.lastError = 'Missing required settings: latitude, longitude, or kwp';
        console.error('✗ Solar Forecast: Missing required configuration');
        return false;
      }

      console.log(`  📍 Location: ${latitude}°, ${longitude}°`);
      console.log(`  ⚡ Panel: ${kwp} kWp, Tilt: ${tilt || 35}°, Azimuth: ${azimuth || 180}°`);

      // Fetch forecast from Forecast.Solar API
      const forecast = await api.getForecast({
        latitude,
        longitude,
        tilt: tilt || 35,
        azimuth: azimuth || 180,
        kwp
      });

      // Store forecasts in database
      recordsCollected = await this.storeForecast(forecast.wattHoursDay);

      // Update actual values from historical data (runs automatically)
      await this.updateActualValues();

      // Calculate accuracy (runs automatically)
      await this.calculateAccuracy();

      this.lastRun = new Date();

      console.log(`✅ Solar Forecast: Collected ${recordsCollected} forecast days`);

      return true; // Return true for success

    } catch (error) {
      this.lastError = error.message;
      console.error('✗ Solar Forecast Error:', error.message);
      return false; // Return false for failure
    }
  }

  /**
   * Store forecast data in database
   */
  async storeForecast(wattHoursDay) {
    if (!wattHoursDay || Object.keys(wattHoursDay).length === 0) {
      throw new Error('No daily forecast data in API response');
    }

    let recordsStored = 0;

    for (const [dateStr, wattHours] of Object.entries(wattHoursDay)) {
      const expectedKwh = wattHours / 1000; // Convert Wh to kWh

      await db.pool.query(`
        INSERT INTO solar_forecasts (date, expected_kwh, data_source)
        VALUES (?, ?, 'forecast.solar')
        ON DUPLICATE KEY UPDATE 
          expected_kwh = VALUES(expected_kwh),
          updated_at = CURRENT_TIMESTAMP
      `, [dateStr, expectedKwh]);

      recordsStored++;
    }

    console.log(`  💾 Stored ${recordsStored} forecast records`);
    return recordsStored;
  }

  /**
   * Update actual solar generation from energy tables
   * Tries energy_daily first, falls back to calculating from energy_snapshots
   */
  async updateActualValues() {
    try {
      let updatedCount = 0;
      
      // Method 1: Try energy_daily table first (if it exists and is populated)
      try {
        const [tables] = await db.pool.query(`SHOW TABLES LIKE 'energy_daily'`);
        
        if (tables.length > 0) {
          const [result] = await db.pool.query(`
            UPDATE solar_forecasts sf
            INNER JOIN energy_daily ed ON sf.date = ed.date
            SET sf.actual_kwh = ed.pv_generation_kwh
            WHERE sf.actual_kwh IS NULL 
              AND ed.pv_generation_kwh IS NOT NULL
              AND ed.pv_generation_kwh > 0
              AND sf.date < CURDATE()
          `);
          
          updatedCount = result.affectedRows;
          
          if (updatedCount > 0) {
            console.log(`  ✓ Updated ${updatedCount} days from energy_daily`);
            return; // Success, exit early
          }
        }
      } catch (error) {
        // energy_daily not available or query failed, continue to fallback
      }
      
      // Method 2: Fallback - Calculate from energy_snapshots
      // Get dates that need updating (only past dates)
      const [datesToUpdate] = await db.pool.query(`
        SELECT DISTINCT sf.date
        FROM solar_forecasts sf
        WHERE sf.actual_kwh IS NULL
          AND sf.date < CURDATE()
          AND sf.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY sf.date DESC
      `);
      
      if (datesToUpdate.length === 0) {
        return; // Nothing to update
      }
      
      // Process each date
      for (const row of datesToUpdate) {
        const date = row.date;
        
        // Get daily production from snapshots
        // solar_energy_today resets at midnight, so MAX = total for the day
        const [production] = await db.pool.query(`
          SELECT 
            MAX(solar_energy_today) as daily_kwh
          FROM energy_snapshots
          WHERE DATE(timestamp) = ?
            AND solar_energy_today IS NOT NULL
          HAVING daily_kwh > 0
        `, [date]);
        
        if (production.length > 0 && production[0].daily_kwh > 0) {
          const dailyKwh = production[0].daily_kwh;
          
          // Update solar_forecasts table
          await db.pool.query(`
            UPDATE solar_forecasts
            SET actual_kwh = ?
            WHERE date = ?
              AND actual_kwh IS NULL
          `, [dailyKwh, date]);
          
          updatedCount++;
        }
      }
      
      if (updatedCount > 0) {
        console.log(`  ✓ Updated ${updatedCount} days from energy_snapshots`);
      }
      
    } catch (error) {
      console.warn('  ⚠️  Could not update actual values:', error.message);
    }
  }

  /**
   * Calculate forecast accuracy percentage
   */
  async calculateAccuracy() {
    try {
      const [result] = await db.pool.query(`
        UPDATE solar_forecasts
        SET accuracy_percentage = CASE
          WHEN actual_kwh IS NOT NULL AND expected_kwh > 0 THEN
            100 - ABS((actual_kwh - expected_kwh) / expected_kwh * 100)
          ELSE NULL
        END
        WHERE actual_kwh IS NOT NULL 
          AND accuracy_percentage IS NULL
      `);

      if (result.affectedRows > 0) {
        console.log(`  ✓ Calculated accuracy for ${result.affectedRows} days`);
        
        // Show quick accuracy summary if we have data
        const [summary] = await db.pool.query(`
          SELECT 
            COUNT(*) as days,
            ROUND(AVG(accuracy_percentage), 1) as avg_accuracy
          FROM solar_forecasts
          WHERE accuracy_percentage IS NOT NULL
            AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        `);
        
        if (summary.length > 0 && summary[0].days > 0) {
          console.log(`  📊 Last 7 days avg accuracy: ${summary[0].avg_accuracy}% (${summary[0].days} days)`);
        }
      }
    } catch (error) {
      console.warn('  ⚠️  Could not calculate accuracy:', error.message);
    }
  }

  /**
   * Get forecast for specific date
   */
  async getForecast(date) {
    const [rows] = await db.pool.query(`
      SELECT date, expected_kwh, actual_kwh, accuracy_percentage, data_source
      FROM solar_forecasts
      WHERE date = ?
    `, [date]);

    return rows[0] || null;
  }

  /**
   * Get forecast range
   */
  async getForecastRange(startDate, endDate) {
    const [rows] = await db.pool.query(`
      SELECT date, expected_kwh, actual_kwh, accuracy_percentage, data_source
      FROM solar_forecasts
      WHERE date BETWEEN ? AND ?
      ORDER BY date ASC
    `, [startDate, endDate]);

    return rows;
  }

  /**
   * Get average accuracy statistics
   */
  async getAccuracyStats() {
    const [rows] = await db.pool.query(`
      SELECT 
        AVG(accuracy_percentage) as avg_accuracy,
        MIN(accuracy_percentage) as min_accuracy,
        MAX(accuracy_percentage) as max_accuracy,
        COUNT(*) as total_days,
        COUNT(CASE WHEN actual_kwh IS NOT NULL THEN 1 END) as completed_days,
        SUM(expected_kwh) as total_expected_kwh,
        SUM(actual_kwh) as total_actual_kwh
      FROM solar_forecasts
      WHERE accuracy_percentage IS NOT NULL
    `);

    return rows[0] || { 
      avg_accuracy: null, 
      min_accuracy: null,
      max_accuracy: null,
      total_days: 0, 
      completed_days: 0,
      total_expected_kwh: 0,
      total_actual_kwh: 0
    };
  }

  /**
   * Get collector status
   */
  getStatus() {
    return {
      name: this.name,
      lastRun: this.lastRun,
      lastError: this.lastError,
      healthy: this.lastError === null
    };
  }

  /**
   * Test API connection
   */
  async testConnection() {
    console.log('🔍 Testing Forecast.Solar API connection...');
    const health = await api.healthCheck();
    
    if (health.available) {
      console.log('✅ API is available');
    } else {
      console.log('❌ API is unavailable:', health.error);
    }
    
    return health;
  }
}

export default new SolarForecastCollector();