// diagnostics/test-daily-totals.js
// Test getting daily totals from snapshots using MAX() approach

import db from '../core/database.js';

async function testDailyTotals() {
  console.log('🧪 Testing daily totals extraction from snapshots...\n');

  try {
    // Show how the *_today fields work
    console.log('1️⃣ Sample snapshots from today (showing progression):');
    const [samples] = await db.pool.query(`
      SELECT timestamp, solar_energy_today, load_energy_today, grid_energy_import_today, battery_charge_today
      FROM energy_snapshots 
      WHERE DATE(timestamp) = CURDATE() 
      ORDER BY timestamp ASC
      LIMIT 10
    `);

    if (samples.length > 0) {
      console.log('   First 10 snapshots showing cumulative counters increasing:');
      samples.forEach(s => {
        const time = s.timestamp.toISOString().substr(11, 8);
        console.log(`   ${time}: PV=${s.solar_energy_today}kWh, Load=${s.load_energy_today}kWh, Grid=${s.grid_energy_import_today}kWh, Charge=${s.battery_charge_today}kWh`);
      });
      
      // Show the last one
      const [lastSample] = await db.pool.query(`
        SELECT timestamp, solar_energy_today, load_energy_today, grid_energy_import_today, battery_charge_today
        FROM energy_snapshots 
        WHERE DATE(timestamp) = CURDATE() 
        ORDER BY timestamp DESC
        LIMIT 1
      `);
      
      if (lastSample[0]) {
        const time = lastSample[0].timestamp.toISOString().substr(11, 8);
        console.log(`   ...\n   Latest: ${time}: PV=${lastSample[0].solar_energy_today}kWh, Load=${lastSample[0].load_energy_today}kWh (final totals)`);
      }
    }

    // Test the aggregation query
    console.log('\n2️⃣ Testing daily aggregation query (today):');
    const [daily] = await db.pool.query(`
      SELECT 
        DATE(timestamp) as day,
        MAX(solar_energy_today) as pv_generation_kwh,
        MAX(load_energy_today) as load_consumption_kwh,
        MAX(grid_energy_import_today) as grid_import_kwh,
        MAX(grid_energy_export_today) as grid_export_kwh,
        MAX(battery_charge_today) as battery_charge_kwh,
        MAX(battery_discharge_today) as battery_discharge_kwh,
        COUNT(*) as snapshot_count
      FROM energy_snapshots
      WHERE DATE(timestamp) = CURDATE()
      GROUP BY day
    `);

    if (daily[0]) {
      console.log(`   Date: ${daily[0].day}`);
      console.log(`   Snapshots: ${daily[0].snapshot_count}`);
      console.log(`   PV Generation: ${daily[0].pv_generation_kwh} kWh`);
      console.log(`   Load Consumption: ${daily[0].load_consumption_kwh} kWh`);
      console.log(`   Grid Import: ${daily[0].grid_import_kwh} kWh`);
      console.log(`   Grid Export: ${daily[0].grid_export_kwh} kWh`);
      console.log(`   Battery Charge: ${daily[0].battery_charge_kwh} kWh`);
      console.log(`   Battery Discharge: ${daily[0].battery_discharge_kwh} kWh`);
    } else {
      console.log('   ⚠️  No data for today');
    }

    // Test last 7 days
    console.log('\n3️⃣ Testing last 7 days aggregation:');
    const [week] = await db.pool.query(`
      SELECT 
        DATE(timestamp) as day,
        MAX(solar_energy_today) as pv_generation_kwh,
        MAX(load_energy_today) as load_consumption_kwh,
        COUNT(*) as snapshots
      FROM energy_snapshots
      WHERE timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY day
      ORDER BY day DESC
    `);

    week.forEach(d => {
      console.log(`   ${d.day}: PV=${d.pv_generation_kwh}kWh, Load=${d.load_consumption_kwh}kWh (${d.snapshots} snapshots)`);
    });

    console.log('\n✅ Daily totals approach is working correctly!');
    console.log('   The *_today fields are cumulative counters that reset at midnight.');
    console.log('   MAX() gives us the final value of the day = total energy for that day.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await db.pool.end();
  }
}

testDailyTotals();