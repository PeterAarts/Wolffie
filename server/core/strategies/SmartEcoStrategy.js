import profilingService from '../system/services/profilingService.js';

class SmartEcoStrategy {
  constructor() {
    this.name = 'Smart Morning Buffer';
    this.batteryCapacityKwh = 11.2;
  }

  async decide(context) {
    const currentHour = new Date().getHours();
    const { soc, currentPrice, isDynamicContract } = context;

    // We voeren deze check alleen uit tussen 00:00 en 05:00 (de daluren)
    if (currentHour >= 0 && currentHour < 5) {
      const neededBufferKwh = await profilingService.getMorningBuffer();
      const currentKwh = (soc / 100) * this.batteryCapacityKwh;

      console.log(`[Strategy] Ochtend buffer nodig: ${neededBufferKwh.toFixed(2)} kWh. Huidige inhoud: ${currentKwh.toFixed(2)} kWh.`);

      if (currentKwh < neededBufferKwh) {
        // Alleen laden als het goedkoop is (bijv. onder het gemiddelde of een vaste drempel)
        const priceThreshold = 0.25; // Voorbeeld drempelwaarde
        
        if (currentPrice < priceThreshold) {
          const shortageKwh = neededBufferKwh - currentKwh;
          const chargePowerWatts = 3000; // Laad met 3kW

          return {
            action: 'CHARGE_FROM_GRID',
            reason: `Buffer tekort (${shortageKwh.toFixed(1)} kWh). Laden voor ochtendpiek.`,
            power: chargePowerWatts,
            targetSoc: Math.ceil((neededBufferKwh / this.batteryCapacityKwh) * 100)
          };
        }
      }
    }

    return { action: 'IDLE', reason: 'Geen actie vereist' };
  }
}

export default new SmartEcoStrategy();