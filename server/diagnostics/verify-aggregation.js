// diagnostics/verify-aggregation.js
// Run this script to verify data is flowing through the aggregation chain
// Usage: node diagnostics/verify-aggregation.js

import db from '../core/database.js';

async function verifyAggregation() {
  console.log('🔍 Verifying aggregation chain...\n');

  try {
    // 1. Check energy_snapshots
    const [snapshots] = await db.pool.query(`
      SELECT 
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        AVG(solar_power) as avg_solar,
        AVG(battery_soc) as avg_soc
      FROM energy_snapshots
      WHERE DATE(timestamp) = CURDATE()
    `);

    console.log('📸 energy_snapshots (today):');
    console.log(`   Rows: ${snapshots[0].count}`);
    console.log(`   Range: ${snapshots[0].oldest} → ${snapshots[0].newest}`);
    console.log(`   Avg Solar: ${snapshots[0].avg_solar}W, Avg SOC: ${snapshots[0].avg_soc}%\n`);

    // 2. Check energy_minutes
    const [minutes] = await db.pool.query(`
      SELECT 
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        SUM(pv_energy_wh) as total_pv_wh,
        SUM(sample_count) as total_samples
      FROM energy_minutes
      WHERE DATE(timestamp) = CURDATE()
    `);

    console.log('⏱️  energy_minutes (today):');
    console.log(`   Rows: ${minutes[0].count}`);
    console.log(`   Range: ${minutes[0].oldest} → ${minutes[0].newest}`);
    console.log(`   Total PV Energy: ${(minutes[0].total_pv_wh / 1000).toFixed(2)} kWh`);
    console.log(`   Total Samples: ${minutes[0].total_samples}\n`);

    // 3. Check energy_hours
    const [hours] = await db.pool.query(`
      SELECT 
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest,
        SUM(solar_energy_kwh) as total_solar_kwh
      FROM energy_hours
      WHERE DATE(timestamp) = CURDATE()
    `);

    console.log('⏰ energy_hours (today):');
    console.log(`   Rows: ${hours[0].count}`);
    console.log(`   Range: ${hours[0].oldest} → ${hours[0].newest}`);
    console.log(`   Total Solar: ${parseFloat(hours[0].total_solar_kwh || 0).toFixed(2)} kWh\n`);

    // 4. Check energy_daily
    const [daily] = await db.pool.query(`
      SELECT 
        date,
        pv_generation_kwh,
        load_consumption_kwh,
        grid_import_kwh,
        grid_export_kwh,
        battery_charge_kwh,
        battery_discharge_kwh
      FROM energy_daily
      WHERE date = CURDATE()
    `);

    console.log('📅 energy_daily (today):');
    if (daily[0]) {
      console.log(`   Date: ${daily[0].date}`);
      console.log(`   PV Generation: ${daily[0].pv_generation_kwh} kWh`);
      console.log(`   Load: ${daily[0].load_consumption_kwh} kWh`);
      console.log(`   Grid Import: ${daily[0].grid_import_kwh} kWh`);
      console.log(`   Grid Export: ${daily[0].grid_export_kwh} kWh`);
      console.log(`   Battery Charge: ${daily[0].battery_charge_kwh} kWh`);
      console.log(`   Battery Discharge: ${daily[0].battery_discharge_kwh} kWh\n`);
    } else {
      console.log('   ⚠️  No data for today yet\n');
    }

    // 5. Validation checks
    console.log('✅ Validation:');
    
    if (snapshots[0].count === 0) {
      console.log('   ❌ No snapshots collected today!');
    } else if (minutes[0].count === 0) {
      console.log('   ❌ Snapshots exist but minutes aggregation not running!');
    } else if (hours[0].count === 0) {
      console.log('   ⚠️  Minutes exist but hours aggregation not running!');
    } else if (!daily[0]) {
      console.log('   ⚠️  Hours exist but daily aggregation not running!');
    } else {
      console.log('   ✅ Full aggregation chain is working!');
      
      // Check for data consistency
      const minutesTotalKwh = minutes[0].total_pv_wh / 1000;
      const hoursTotalKwh = parseFloat(hours[0].total_solar_kwh || 0);
      const dailyKwh = parseFloat(daily[0].pv_generation_kwh || 0);
      
      console.log('\n📊 Energy consistency check:');
      console.log(`   Minutes → Hours: ${minutesTotalKwh.toFixed(2)} → ${hoursTotalKwh.toFixed(2)} kWh`);
      console.log(`   Hours → Daily: ${hoursTotalKwh.toFixed(2)} → ${dailyKwh.toFixed(2)} kWh`);
      
      const minuteToHourDiff = Math.abs(minutesTotalKwh - hoursTotalKwh);
      const hourToDailyDiff = Math.abs(hoursTotalKwh - dailyKwh);
      
      if (minuteToHourDiff > 0.1) {
        console.log(`   ⚠️  Minutes→Hours mismatch: ${minuteToHourDiff.toFixed(2)} kWh difference`);
      }
      if (hourToDailyDiff > 0.1) {
        console.log(`   ⚠️  Hours→Daily mismatch: ${hourToDailyDiff.toFixed(2)} kWh difference`);
      }
      if (minuteToHourDiff <= 0.1 && hourToDailyDiff <= 0.1) {
        console.log('   ✅ Energy values are consistent across all levels!');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await db.pool.end();
  }
}

verifyAggregation();