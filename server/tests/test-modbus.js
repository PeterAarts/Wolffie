#!/usr/bin/node

/**
 * Wolffie AlphaESS Comparison & Dispatch Test - v6.5
 * * Targeted: SMILE G3-T10
 * * Goal: Interrupt Cloud Charge and Force Local Dispatch.
 * * Strategy: "Clear and Claim" - Kill active mode before setting new one.
 */

import modbusApi from '../modules/alphaess-modbus-tcp/services/api.js';
import settingsService from '../core/system/services/settingsService.js';

async function runComparisonTest() {
    console.log("\n" + "=".repeat(75));
    console.log("🚀 WOLFFIE: SMILE G3-T10 CLOUD INTERRUPTER (v6.5)");
    console.log("=".repeat(75));

    const writeInt32BE = async (addr, val) => {
        const high = (val >> 16) & 0xFFFF;
        const low = val & 0xFFFF;
        return await modbusApi._safeCall(() => modbusApi.client.writeRegisters(addr, [high, low]));
    };

    const readInt32BE = async (addr) => {
        const res = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(addr, 2));
        if (!res || !res.data) return 0;
        let val = (res.data[0] << 16) | res.data[1];
        if (val > 2147483647) val -= 4294967296;
        return val;
    };

    try {
        const mbSettings = await settingsService.getModuleSettings('alphaess-modbus-tcp');
        await modbusApi.connect(mbSettings.host, mbSettings.port, mbSettings.unit_id);
        console.log("✅ ModBus Connected.");

        const fetchRealtime = async () => {
            const batRes = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(294, 1));
            let battery = batRes.data[0] > 32767 ? batRes.data[0] - 65536 : batRes.data[0];
            let grid = await readInt32BE(33);
            const socRes = await modbusApi._safeCall(() => modbusApi.client.readHoldingRegisters(258, 1));
            return { battery, grid, soc: socRes.data[0] * 0.1 };
        };

        const logStatus = (mb) => {
            const mbLoad = Math.max(0, mb.battery + mb.grid); 
            const now = new Date().toLocaleTimeString();
            const flow = mb.battery < -100 ? "🔌 CHG" : (mb.battery > 100 ? "🔋 DIS" : "💤 IDL");
            process.stdout.write(`\r[${now}] ${flow} | BAT: ${mb.battery.toFixed(0).padStart(6)}W | GRID: ${mb.grid.toFixed(0).padStart(6)}W | LOAD: ${mbLoad.toFixed(0).padStart(6)}W | SOC: ${mb.soc}% `);
        };

        console.log("\n⚡ Phase 1: Interrupting Cloud Control...");
        // Write Mode 0 to clear whatever the Cloud is doing
        await modbusApi._safeCall(() => modbusApi.client.writeRegister(2181, 0)); 
        await new Promise(r => setTimeout(r, 1000));
        console.log("   ✅ Interrupter signal sent.");

        console.log("\n💓 Phase 2: Starting Local Heartbeat (-4000W)...");
        
        const ADDR_DISP_START = 2176; 
        const ADDR_DISP_POWER = 2177; 
        const ADDR_DISP_MODE  = 2181; 
        const ADDR_DISP_TIME  = 2183; 

        const targetWatts = -4000; 
        const rawPower = Math.round(targetWatts + 32000); 

        let count = 0;
        const TEST_DURATION_CYCLES = 150; // 5 minutes

        while (count < TEST_DURATION_CYCLES) {
            // 1. Handshake / Authorization
            await modbusApi._safeCall(() => modbusApi.client.writeRegister(ADDR_DISP_START, 21930));

            // 2. Watchdog Refresh
            await writeInt32BE(ADDR_DISP_TIME, 600);

            // 3. Dispatch Mode 7 (Maximise Consumption)
            await modbusApi._safeCall(() => modbusApi.client.writeRegister(ADDR_DISP_MODE, 7));

            // 4. Power Buffer
            await writeInt32BE(ADDR_DISP_POWER, rawPower);

            // 5. Activation
            await modbusApi._safeCall(() => modbusApi.client.writeRegister(ADDR_DISP_START, 1));

            const mb = await fetchRealtime();
            logStatus(mb);
            
            await new Promise(r => setTimeout(r, 2000));
            count++;
        }

        console.log("\n\n🛑 STOPPING: Returning to Auto...");
        await modbusApi._safeCall(() => modbusApi.client.writeRegister(ADDR_DISP_START, 0));
        await modbusApi._safeCall(() => modbusApi.client.writeRegister(ADDR_DISP_MODE, 0));
        
    } catch (e) {
        console.error("\n❌ Test Failed:", e.stack);
    } finally {
        process.exit(0);
    }
}

runComparisonTest();