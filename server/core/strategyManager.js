// server/core/strategyManager.js
import smartStrategy from './strategies/SmartEcoStrategy.js';
import moduleLoader from './moduleLoader.js';
import profilingService from './system/services/profilingService.js';
import db from './database.js';

class StrategyManager {
  constructor() {
    this.activeStrategyName = 'Smart Morning Buffer';
  }

  /**
   * De centrale 'tick' van de strategy engine
   */
  async run() {
    try {
      console.log(`🧠 [Strategy] Checking logic for: ${this.activeStrategyName}`);

      // 1. Haal de benodigde modules op
      const alphaModule = moduleLoader.getModule('alphaess-modbus-tcp');
      if (!alphaModule) {
        console.warn('⚠️ [Strategy] AlphaESS Modbus module niet geladen. Sla over.');
        return;
      }

      // 2. Stel de context samen (dit is wat de strategie nodig heeft)
      // We halen de meest recente SOC en prijzen op
      const morningUsageKwh = await profilingService.getMorningBuffer();
      
      // Haal de laatste SOC uit de database (of direct uit de module)
      const [rows] = await db.pool.query('SELECT battery_soc FROM energy_minutes ORDER BY timestamp DESC LIMIT 1');
      const currentSoc = rows[0]?.battery_soc || 0;

      const context = {
        soc: currentSoc,
        morningUsageKwh: morningUsageKwh,
        currentPrice: 0.15, // TODO: Koppelen aan prijs-service/API
        isNight: new Date().getHours() < 6
      };

      // 3. Laat de specifieke strategie een besluit nemen
      const decision = await smartStrategy.decide(context);

      // 4. Voer actie uit op de AlphaESS
      if (decision.action === 'CHARGE_FROM_GRID') {
        console.log(`⚡ [Strategy] ACTIE: ${decision.reason}`);
        await alphaModule.setGridCharge(true, decision.power || 3000);
      } else {
        await alphaModule.setGridCharge(false);
      }

    } catch (error) {
      console.error('❌ [Strategy] Fout tijdens run:', error.message);
    }
  }
  async checkCurtailment(context) {
    const { soc, gridExportWatts, autoCurtailEnabled } = context;
    const solaredge = moduleLoader.getModule('solaredge');

    if (!autoCurtailEnabled || !solaredge) return;

    // CONDITIE: Batterij > 98% en we exporteren meer dan 100W naar het net
    if (soc >= 98 && gridExportWatts > 100) {
      console.log("🚫 Batterij vol & Export gedetecteerd. SolarEdge uitschakelen...");
      await solaredge.setPowerLimit(0);
      this.isCurtailed = true;
    } 
    // HERSTEL: Als de batterij weer onder de 95% komt, mag de zon weer aan
    else if (soc < 95 && this.isCurtailed) {
      await solaredge.setPowerLimit(100);
      this.isCurtailed = false;
    }
  }
}

// BELANGRIJK: Exporteer een NIEUWE instantie van de class
export default new StrategyManager();