// server/core/strategyManager.js
import smartStrategy from './strategies/SmartEcoStrategy.js';
import moduleLoader from './moduleLoader.js';
import profilingService from './system/services/profilingService.js';
import settingsService from './system/services/systemConfigService.js';
import db from './database.js';

class StrategyManager {
  constructor() {
    this.activeStrategyName = 'Smart Morning Buffer';
  }

  async run() {
    const isShadowMode = await settingsService.get('smart_eco', 'shadow_mode');

    if (isShadowMode) {
      console.log("   • [Strategy] SHADOW MODE: Command suppressed, logic logged only.");
      return; // Stop here during testing!
    }
    try {

        // 1. Fetch the latest saved script from the DB
        const [plan] = await db.pool.query(
            'SELECT execution_plan FROM strategy_executions WHERE status = "active" ORDER BY calculated_at DESC LIMIT 1'
        );

        if (!plan[0]) {
            console.warn("   • Strategy - No active strategy script found. Defaulting to Normal.");
            return;
        }

        const script = plan[0].execution_plan; // Array of {time, action, watts}
        const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // 2. Find the action for the current time slot
        const currentAction = script.find(step => step.time === now);

        if (currentAction) {
            console.log(`[Strategy Engine] Executing: ${currentAction.action} at ${currentAction.watts}W`);
            // Execute via alphaModule logic...
            await alphaModule.setGridCharge(true, currentAction.watts);
  
            await eventService.log({
              category: 'STRATEGY',
              action: 'CHARGE',
              source: 'smart_eco',
              details: { watts: currentAction.watts, reason: currentAction.reason }
            });
        }

        // 3. MANDATORY OVERRIDE: Negative Pricing (Safety First)
        const currentPrice = await priceService.getCurrentPrice(); 
        if (currentPrice < 0) {
            await alphaModule.setGridCharge(false); 
            console.log("![Safety] Negative Price detected: Export blocked.");
        }

    } catch (error) {
        console.error('Strategy Execution Error:', error.message);
    }
} 
  /**
   * De centrale 'tick' van de strategy engine
   */
  async calculate() {
    try {
      console.log(`   • [Strategy] Checking logic for: ${this.activeStrategyName}`);

      // 1. Haal de benodigde modules op
      const alphaModule = moduleLoader.getModule('alphaess-modbus-tcp');
      if (!alphaModule) {
        console.warn('   • [Strategy] AlphaESS Modbus module niet geladen. Sla over.');
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

      const script = await this.generateFullDayPlan(context);
      await db.pool.query(
        'INSERT INTO strategy_executions (strategy_id, execution_plan, status) VALUES (?, ?, ?)',
        ['smart_eco', JSON.stringify(script), 'active']
      );

    } catch (error) {
      console.error('   • [Strategy] Fout tijdens run:', error.message);
    }
  }

  async checkCurtailment(context) {
    const { soc, gridExportWatts, autoCurtailEnabled } = context;
    const solaredge = moduleLoader.getModule('solaredge');

    if (!autoCurtailEnabled || !solaredge) return;

    // CONDITIE: Batterij > 98% en we exporteren meer dan 100W naar het net
    if (soc >= 98 && gridExportWatts > 100) {
      console.log("   • Battery max capacity & Export detected. SolarEdge disabling...");
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