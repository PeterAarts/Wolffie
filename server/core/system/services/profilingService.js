import db from '../../database.js';

class ProfilingService {
  /**
   * Haalt het gemiddelde verbruik op voor een specifiek tijdsblok.
   * Maakt onderscheid tussen weekdagen en weekenden.
   */
  async getTypicalConsumption(startHour, endHour) {
    const isWeekend = [0, 6].includes(new Date().getDay());
    
    try {
      // We kijken naar de laatste 30 dagen voor een relevant 'moving average'
      const [rows] = await db.pool.query(`
        SELECT 
          HOUR(timestamp) as hour,
          AVG(load_energy_kwh) as avg_consumption
        FROM energy_hours
        WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND (WEEKDAY(timestamp) < 5) = ?  -- Filter op weekdag/weekend
          AND HOUR(timestamp) BETWEEN ? AND ?
        GROUP BY hour
      `, [!isWeekend, startHour, endHour]);

      const totalExpected = rows.reduce((sum, row) => sum + row.avg_consumption, 0);
      return totalExpected || 0.5; // Fallback van 0.5kWh als er geen data is
    } catch (error) {
      console.error('❌ Profiling failed:', error.message);
      return 1.0; 
    }
  }

  /**
   * Berekent de benodigde buffer (in kWh) voor de ochtendpiek.
   * Kijkt naar het historisch gemiddelde tussen 'opstaan' en 'zon-start'.
   */
  async getMorningBuffer() {
    const isWeekend = [0, 6].includes(new Date().getDay());
    const dayType = isWeekend ? 'WEEKEND' : 'WEEKDAY';
    
    // Instellingen (dit kun je later via je Settings.vue configureerbaar maken)
    const wakeUpHour = 6;  // Start van het verbruik
    const solarStartHour = 9; // Tijdstip dat de zon het overneemt

    try {
      // We gebruiken de profieltabel die we in de vorige stap hebben ontworpen
      const [rows] = await db.pool.query(`
        SELECT SUM(avg_load_kwh) as morning_needs
        FROM energy_usage_profiles
        WHERE day_type = ? AND hour BETWEEN ? AND ?
      `, [dayType, wakeUpHour, solarStartHour - 1]);

      const buffer = rows[0]?.morning_needs || 1.5; // Fallback van 1.5 kWh
      const safetyMargin = 1.2; // 20% extra voor koude ochtenden
      
      return buffer * safetyMargin;
    } catch (error) {
      console.error('❌ Fout bij berekenen morning buffer:', error);
      return 2.0; // Veilige fallback
    }
  }
}



export default new ProfilingService();