// modules/day-ahead-prices/test.js
// Test script for Day-Ahead Electricity Prices module
// Usage: node modules/day-ahead-prices/test.js

import api from './services/api.js';
import collector from './services/collector.js';
import dayAheadModule from './index.js';
import db from '../../core/database.js';

// ANSI Colors for output
const colors = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
};

// Helper functions for pretty output
const log = {
  section: (msg) => console.log(`\n${colors.cyan}${colors.bold}═══ ${msg} ═══${colors.reset}\n`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.gray}ℹ${colors.reset} ${msg}`),
  data: (label, value) => console.log(`  ${colors.gray}${label}:${colors.reset} ${value}`),
};

/**
 * Test 1: API Information
 */
async function testAPIInfo() {
  log.section('API Information');
  
  try {
    const apiInfo = api.getAPIInfo();
    
    log.success('API Information retrieved');
    log.data('Provider', apiInfo.provider);
    log.data('Documentation', apiInfo.documentation);
    log.data('Registration', apiInfo.registration);
    log.data('Supported Zones', apiInfo.supportedZones.length);
    
    console.log(`\n  ${colors.gray}Zones:${colors.reset}`, apiInfo.supportedZones.join(', '));
    
    return true;
  } catch (error) {
    log.error(`Failed to get API info: ${error.message}`);
    return false;
  }
}

/**
 * Test 2: API Health Check
 */
async function testAPIHealth() {
  log.section('API Health Check');
  
  try {
    log.info('Testing connection to Energy Charts API...');
    const health = await api.healthCheck();
    
    if (health.available) {
      log.success('API is available and responding');
      return true;
    } else {
      log.error(`API is unavailable: ${health.error}`);
      return false;
    }
  } catch (error) {
    log.error(`Health check failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 3: Fetch Test Prices
 */
async function testFetchPrices(biddingZone = 'NL') {
  log.section('Fetch Test Prices');
  
  try {
    // Get yesterday's prices (should always be available)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    log.info(`Fetching prices for ${api.formatDateForAPI(yesterday)}`);
    log.data('Bidding Zone', biddingZone);
    
    const prices = await api.getDayAheadPrices(biddingZone, yesterday, today);
    
    if (prices && prices.length > 0) {
      log.success(`Retrieved ${prices.length} price points`);
      
      // Show sample data
      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      
      console.log(`\n  ${colors.gray}First price:${colors.reset}`);
      log.data('  Time', firstPrice.datetime.toISOString());
      log.data('  EUR/kWh', firstPrice.priceEurPerKWh.toFixed(5));
      log.data('  EUR/MWh', firstPrice.priceEurPerMWh.toFixed(2));
      
      console.log(`\n  ${colors.gray}Last price:${colors.reset}`);
      log.data('  Time', lastPrice.datetime.toISOString());
      log.data('  EUR/kWh', lastPrice.priceEurPerKWh.toFixed(5));
      log.data('  EUR/MWh', lastPrice.priceEurPerMWh.toFixed(2));
      
      // Calculate statistics
      const avgPrice = prices.reduce((sum, p) => sum + p.priceEurPerKWh, 0) / prices.length;
      const minPrice = Math.min(...prices.map(p => p.priceEurPerKWh));
      const maxPrice = Math.max(...prices.map(p => p.priceEurPerKWh));
      
      console.log(`\n  ${colors.gray}Statistics:${colors.reset}`);
      log.data('  Average', `${avgPrice.toFixed(5)} EUR/kWh`);
      log.data('  Minimum', `${minPrice.toFixed(5)} EUR/kWh`);
      log.data('  Maximum', `${maxPrice.toFixed(5)} EUR/kWh`);
      
      return { success: true, prices };
    } else {
      log.error('No prices received from API');
      return { success: false };
    }
  } catch (error) {
    log.error(`Failed to fetch prices: ${error.message}`);
    console.error(error.stack);
    return { success: false };
  }
}

/**
 * Test 4: Database Connection
 */
async function testDatabase() {
  log.section('Database Connection');
  
  try {
    // Test database connection
    const [rows] = await db.pool.query('SELECT 1 as system_settings');
    log.success('Database connection successful');
    
    // Check if day_ahead_prices table exists
    const [tables] = await db.pool.query(`
      SHOW TABLES LIKE 'day_ahead_prices'
    `);
    
    if (tables.length > 0) {
      log.success('Table "day_ahead_prices" exists');
      
      // Get record count
      const [count] = await db.pool.query(`
        SELECT COUNT(*) as count FROM day_ahead_prices
      `);
      log.data('Current records', count[0].count);
      
      return true;
    } else {
      log.error('Table "day_ahead_prices" does not exist');
      log.warning('Please create the table first');
      return false;
    }
  } catch (error) {
    log.error(`Database test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Module Initialization
 */
async function testModuleInit() {
  log.section('Module Initialization');
  
  try {
    log.info('Initializing Day-Ahead Prices module...');
    
    await dayAheadModule.initialize();
    
    if (dayAheadModule.initialized) {
      log.success('Module initialized successfully');
      
      const status = dayAheadModule.getStatus();
      log.data('Enabled', status.enabled);
      log.data('Has Config', status.hasConfig);
      log.data('Bidding Zone', status.biddingZone || 'N/A');
      log.data('Country Code', status.countryCode || 'N/A');
      
      return true;
    } else {
      log.warning('Module initialized but not enabled');
      return false;
    }
  } catch (error) {
    log.error(`Module initialization failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 6: Full Collection Test
 */
async function testFullCollection() {
  log.section('Full Collection Test');
  
  try {
    log.info('Running full collection...');
    
    const success = await collector.collect();
    
    if (success) {
      log.success('Collection completed successfully');
      
      const status = collector.getStatus();
      log.data('Last Run', status.lastRun ? status.lastRun.toISOString() : 'Never');
      log.data('Last Error', status.lastError || 'None');
      log.data('Healthy', status.healthy ? 'Yes' : 'No');
      
      // Check what was stored in database
      const [recentRecords] = await db.pool.query(`
        SELECT 
          datetime,
          price_eur_per_kwh,
          bidding_zone,
          country_code
        FROM day_ahead_prices
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      if (recentRecords.length > 0) {
        console.log(`\n  ${colors.gray}Recently stored records (last 5):${colors.reset}`);
        recentRecords.forEach(record => {
          console.log(`    ${record.datetime} | ${record.price_eur_per_kwh} EUR/kWh | ${record.bidding_zone}`);
        });
      }
      
      return true;
    } else {
      log.error('Collection failed');
      const status = collector.getStatus();
      log.data('Last Error', status.lastError || 'Unknown');
      return false;
    }
  } catch (error) {
    log.error(`Collection test failed: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

/**
 * Test 7: Query Stored Prices
 */
async function testQueryPrices() {
  log.section('Query Stored Prices');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    log.info(`Querying prices for ${today}...`);
    
    const prices = await collector.getPricesForDate(today, 'BE');
    
    if (prices.length > 0) {
      log.success(`Found ${prices.length} prices for today`);
      
      // Get summary
      const summary = await collector.getPriceSummary(today, 'BE');
      
      console.log(`\n  ${colors.gray}Summary for ${today}:${colors.reset}`);
      log.data('  Hours', summary.hours_count);
      log.data('  Average', summary.avg_price ? `${summary.avg_price.toFixed(5)} EUR/kWh` : 'N/A');
      log.data('  Minimum', summary.min_price ? `${summary.min_price.toFixed(5)} EUR/kWh` : 'N/A');
      log.data('  Maximum', summary.max_price ? `${summary.max_price.toFixed(5)} EUR/kWh` : 'N/A');
      
      // Get cheapest hours
      const extremes = await collector.getExtremeHours(today, 'BE', 3);
      
      if (extremes.cheapest.length > 0) {
        console.log(`\n  ${colors.gray}Cheapest 3 hours:${colors.reset}`);
        extremes.cheapest.forEach(hour => {
          const time = new Date(hour.datetime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
          console.log(`    ${time} | ${hour.price_eur_per_kwh.toFixed(5)} EUR/kWh`);
        });
      }
      
      if (extremes.expensive.length > 0) {
        console.log(`\n  ${colors.gray}Most expensive 3 hours:${colors.reset}`);
        extremes.expensive.forEach(hour => {
          const time = new Date(hour.datetime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
          console.log(`    ${time} | ${hour.price_eur_per_kwh.toFixed(5)} EUR/kWh`);
        });
      }
      
      return true;
    } else {
      log.warning('No prices found for today yet');
      log.info('Prices are usually published around 14:00 CET');
      return false;
    }
  } catch (error) {
    log.error(`Query test failed: ${error.message}`);
    return false;
  }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Day-Ahead Electricity Prices - Test Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(colors.reset);
  
  const results = {
    apiInfo: false,
    apiHealth: false,
    fetchPrices: false,
    database: false,
    moduleInit: false,
    fullCollection: false,
    queryPrices: false,
  };
  
  try {
    // Run tests in sequence
    results.apiInfo = await testAPIInfo();
    results.apiHealth = await testAPIHealth();
    results.fetchPrices = (await testFetchPrices()).success;
    results.database = await testDatabase();
    results.moduleInit = await testModuleInit();
    results.fullCollection = await testFullCollection();
    results.queryPrices = await testQueryPrices();
    
    // Summary
    log.section('Test Summary');
    
    const tests = Object.entries(results);
    const passed = tests.filter(([_, result]) => result).length;
    const total = tests.length;
    
    tests.forEach(([name, result]) => {
      const icon = result ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      const label = name.replace(/([A-Z])/g, ' $1').trim();
      console.log(`  ${icon} ${label}`);
    });
    
    console.log(`\n${colors.bold}Results: ${passed}/${total} tests passed${colors.reset}\n`);
    
    if (passed === total) {
      console.log(`${colors.green}${colors.bold}✓ All tests passed!${colors.reset}\n`);
    } else {
      console.log(`${colors.yellow}${colors.bold}⚠ Some tests failed${colors.reset}\n`);
    }
    
  } catch (error) {
    log.error(`Test suite error: ${error.message}`);
    console.error(error.stack);
  } finally {
    // Close database connection
    await db.pool.end();
    console.log(`${colors.gray}Database connection closed${colors.reset}\n`);
  }
}

// Run the test suite
runAllTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});