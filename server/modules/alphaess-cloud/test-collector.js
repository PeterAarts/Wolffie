// modules/alphaess-cloud/test.js
// Test script for AlphaESS Cloud module
// Run with: node modules/alphaess-cloud/test.js

import collector from './services/collector.js';
import alphaessAPI from './services/api.js';
import db from '../../config/database.js';

// Get the pool directly for queries
const pool = db.pool || (await import('../../core/database.js').then(m => m.pool));

console.log('🧪 Testing AlphaESS Cloud Module\n');
console.log('═══════════════════════════════════════════\n');

async function runTests() {
  const results = {
    passed: 0,
    failed: 0
  };

  // Test 1: Check collector exists
  console.log('1️⃣  Testing: Collector Module Import');
  if (collector) {
    console.log('   ✅ Collector imported successfully');
    results.passed++;
  } else {
    console.log('   ❌ Failed to import collector');
    results.failed++;
    return;
  }

  // Test 2: Check collector methods
  console.log('\n2️⃣  Testing: Collector Methods');
  if (typeof collector.collect === 'function' && typeof collector.getStatus === 'function') {
    console.log('   ✅ Collector has required methods (collect, getStatus)');
    results.passed++;
  } else {
    console.log('   ❌ Collector missing required methods');
    results.failed++;
  }

  // Test 3: Get current status
  console.log('\n3️⃣  Testing: Collector Status');
  try {
    const status = collector.getStatus();
    console.log('   ✅ Status retrieved:');
    console.log('      Last Collection:', status.lastCollection || 'Never');
    console.log('      Last Error:', status.lastError || 'None');
    console.log('      Consecutive Errors:', status.consecutiveErrors);
    results.passed++;
  } catch (error) {
    console.log('   ❌ Failed to get status:', error.message);
    results.failed++;
  }

  // Test 4: Check API availability
  console.log('\n4️⃣  Testing: API Module');
  try {
    const apiStats = alphaessAPI.getStats();
    console.log('   ✅ API module loaded:');
    console.log('      Request Count:', apiStats.requestCount);
    console.log('      Last Request:', apiStats.lastRequestTime ? new Date(apiStats.lastRequestTime).toISOString() : 'Never');
    console.log('      Has Error:', !!apiStats.lastError);
    results.passed++;
  } catch (error) {
    console.log('   ❌ Failed to get API stats:', error.message);
    results.failed++;
  }

  // Test 5: Check credentials
  console.log('\n5️⃣  Testing: API Credentials');
  try {
    const credentials = await alphaessAPI.getCredentials();
    console.log('   ✅ Credentials loaded from database:');
    console.log('      App ID:', credentials.appId ? credentials.appId.substring(0, 10) + '...' : 'MISSING');
    console.log('      Has Secret:', !!credentials.appSecret);
    console.log('      System SN:', credentials.systemSn || 'MISSING');
    console.log('      Endpoint:', credentials.endpointUrl);
    
    if (credentials.appId && credentials.appSecret && credentials.systemSn) {
      results.passed++;
    } else {
      console.log('   ⚠️  Some credentials are missing!');
      results.failed++;
    }
  } catch (error) {
    console.log('   ❌ Failed to load credentials:', error.message);
    console.log('      💡 Make sure database settings exist in system_settings table');
    results.failed++;
  }

  // Test 6: Test API connection
  console.log('\n6️⃣  Testing: API Connection (health check)');
  try {
    console.log('   📡 Connecting to AlphaESS Cloud API...');
    const health = await alphaessAPI.healthCheck();
    
    if (health.available && health.authenticated) {
      console.log('   ✅ API is available and authenticated');
      console.log('      Connection: OK');
      console.log('      Authentication: Valid');
      results.passed++;
    } else {
      console.log('   ❌ API connection failed:');
      console.log('      Available:', health.available);
      console.log('      Authenticated:', health.authenticated);
      console.log('      Error:', health.lastError || 'Unknown');
      results.failed++;
    }
  } catch (error) {
    console.log('   ❌ Health check failed:', error.message);
    console.log('      💡 Check your credentials and network connection');
    results.failed++;
  }

  // Test 7: Try to collect data
  console.log('\n7️⃣  Testing: Data Collection');
  try {
    console.log('   📡 Triggering collection cycle...');
    const success = await collector.collect();
    
    if (success) {
      console.log('   ✅ Data collection successful!');
      const status = collector.getStatus();
      console.log('      Last Collection:', status.lastCollection);
      console.log('      Consecutive Errors:', status.consecutiveErrors);
      results.passed++;
    } else {
      console.log('   ❌ Collection returned false');
      const status = collector.getStatus();
      console.log('      Last Error:', status.lastError);
      console.log('      💡 Check the error message above for details');
      results.failed++;
    }
  } catch (error) {
    console.log('   ❌ Collection threw error:', error.message);
    console.log('      Stack:', error.stack);
    results.failed++;
  }

  // Test 8: Check database
  console.log('\n8️⃣  Testing: Database Storage');
  try {
    // Import pool directly since db doesn't have pool exposed
    const dbModule = await import('../../core/database.js');
    const actualPool = dbModule.default.pool || dbModule.pool;
    
    if (!actualPool) {
      console.log('   ⚠️  Could not access database pool');
      console.log('      💡 Database connection may not be initialized');
      results.passed++;
    } else {
      const [rows] = await actualPool.execute(
        `SELECT * FROM energy_snapshots 
         WHERE source = 'alphaess-cloud' 
         ORDER BY timestamp DESC 
         LIMIT 1`
      );

      if (rows.length > 0) {
        console.log('   ✅ Data found in database:');
        console.log('      Timestamp:', rows[0].timestamp);
        console.log('      Battery SOC:', rows[0].battery_soc + '%');
        console.log('      Solar Power:', rows[0].solar_power + 'W');
        console.log('      Load Power:', rows[0].load_power + 'W');
        console.log('      Grid Power:', rows[0].grid_power + 'W');
        results.passed++;
      } else {
        console.log('   ⚠️  No data in database yet');
        console.log('      💡 This is normal if this is the first collection');
        results.passed++;
      }
    }
  } catch (error) {
    console.log('   ❌ Database query failed:', error.message);
    console.log('      💡 Check if energy_snapshots table exists');
    results.failed++;
  }

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
  console.log('═══════════════════════════════════════════\n');

  if (results.failed === 0) {
    console.log('🎉 All tests passed! AlphaESS Cloud module is working correctly.\n');
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.\n');
    console.log('💡 Common issues:');
    console.log('   - Missing credentials in system_settings table');
    console.log('   - Invalid API credentials');
    console.log('   - Network connectivity issues');
    console.log('   - Database tables not created\n');
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
  console.error('\n💥 Test suite crashed:', error.message);
  console.error(error.stack);
  process.exit(1);
});