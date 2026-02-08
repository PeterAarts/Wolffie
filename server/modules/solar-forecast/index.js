import axios from 'axios';
import db from '../../core/database.js';

export default {
  async collect() {
    try {
      // 1. Haal alle rijen op voor deze categorie
      const [rows] = await db.pool.query(`
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE category = 'solar_forecast'
      `);

      // 2. Transformeer rijen naar een handig object: { latitude: '50.8', ... }
      const config = rows.reduce((acc, row) => {
        acc[row.setting_key] = row.setting_value;
        return acc;
      }, {});

      if (!config.latitude || !config.kwp) {
        console.warn('⚠️ Solar Forecast: Instellingen incompleet in database');
        return false;
      }

      // 3. Aanroep naar Forecast.Solar met de variabelen
      const url = `https://api.forecast.solar/estimate/${config.latitude}/${config.longitude}/${config.tilt}/${config.azimuth}/${config.kwp}`;
      const response = await axios.get(url);
      
      const today = new Date().toISOString().split('T')[0];
      const expectedKwh = response.data.result.watt_hours_day[today] / 1000;

      // 4. Opslaan in de solar_forecasts tabel (voor de vergelijking later)
      await db.pool.query(`
        INSERT INTO solar_forecasts (date, expected_kwh) 
        VALUES (?, ?) 
        ON DUPLICATE KEY UPDATE expected_kwh = VALUES(expected_kwh)
      `, [today, expectedKwh]);

      return true;
    } catch (error) {
      this.lastError = error.message;
      console.error('❌ Solar Forecast Error:', error.message);
      return false;
    }
  }
};