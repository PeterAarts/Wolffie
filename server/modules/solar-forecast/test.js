// modules/solar-forecast/test.js
// Test script for Solar Forecast module
// Usage: node modules/solar-forecast/test.js

import api from './services/api.js';
import collector from './services/collector.js';
import solarForecastModule from './index.js';
import db from '../../core/database.js';
import settingsService from '../../core/system/services/settingsService.js';

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
    log.data('Update Frequency', apiInfo.updateFrequency);
    
    console.log(`\n  ${colors.gray}Parameters:${colors.reset}`);
    Object.entries(apiInfo.parameters).forEach(([key, desc]) => {
      console.log(`    ${colors.gray}${key}:${colors.reset} ${desc}`);
    });
    
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
    log.info('Testing connection to Forecast.Solar API...');
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
 * Test 3: Fetch Test Forecast (API Test Only)
 */
async function testFetchForecast() {
  log.section('Fetch Test Forecast (API Test)');
  
  try {
    // Use example configuration (Berlin)
    const testConfig = {
      latitude: 52.52,
      longitude: 13.405,
      tilt: 35,
      azimuth: 180,
      kwp: 5
    };
    
    log.info('Testing API with example location (Berlin, 5kWp)');
    log.data('Latitude', testConfig.latitude);
    log.data('Longitude', testConfig.longitude);
    log.data('Tilt', `${testConfig.tilt}°`);
    log.data('Azimuth', `${testConfig.azimuth}° (South)`);
    log.data('Panel Power', `${testConfig.kwp} kWp`);
    
    const forecast = await api.getForecast(testConfig);
    
    if (forecast && forecast.wattHoursDay) {
      const days = Object.keys(forecast.wattHoursDay);
      log.success(`Retrieved forecast for ${days.length} days`);
      
      // Show first few days
      console.log(`\n  ${colors.gray}Sample forecast data:${colors.reset}`);
      days.slice(0, 3).forEach(date => {
        const kwh = (forecast.wattHoursDay[date] / 1000).toFixed(2);
        console.log(`    ${date}: ${kwh} kWh`);
      });
      
      return { success: true, forecast };
    } else {
      log.error('No forecast data received from API');
      return { success: false };
    }
  } catch (error) {
    log.error(`Failed to fetch forecast: ${error.message}`);
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
    const [rows] = await db.pool.query('SELECT 1 as test');
    log.success('Database connection successful');
    
    // Check if solar_forecasts table exists
    const [tables] = await db.pool.query(`
      SHOW TABLES LIKE 'solar_forecasts'
    `);
    
    if (tables.length > 0) {
      log.success('Table "solar_forecasts" exists');
      
      // Get record count
      const [count] = await db.pool.query(`
        SELECT COUNT(*) as count FROM solar_forecasts
      `);
      log.data('Current records', count[0].count);
      
      // Get latest forecast
      const [latest] = await db.pool.query(`
        SELECT date, expected_kwh 
        FROM solar_forecasts 
        ORDER BY date DESC 
        LIMIT 1
      `);
      
      if (latest.length > 0) {
        log.data('Latest forecast', `${latest[0].date} (${latest[0].expected_kwh} kWh)`);
      }
      
      return true;
    } else {
      log.error('Table "solar_forecasts" does not exist');
      log.warning('Please create the table first');
      return false;
    }
  } catch (error) {
    log.error(`Database test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 5: Load Settings from Database
 */
async function testSettings() {
  log.section('Load Settings from Database');
  
  try {
    log.info('Loading solar-forecast settings...');
    
    const settings = await settingsService.getCategory('solar-forecast');
    
    if (!settings) {
      log.error('No settings found in database');
      log.warning('Please add module settings to system_settings table');
      return false;
    }
    
    log.success('Settings loaded successfully');
    log.data('Enabled', settings.enabled);
    log.data('Latitude', settings.latitude || 'Not set');
    log.data('Longitude', settings.longitude || 'Not set');
    log.data('Tilt', settings.tilt ? `${settings.tilt}°` : 'Not set');
    log.data('Azimuth', settings.azimuth ? `${settings.azimuth}°` : 'Not set');
    log.data('Panel Power', settings.kwp ? `${settings.kwp} kWp` : 'Not set');
    
    // Validate required settings
    const required = ['latitude', 'longitude', 'kwp'];
    const missing = required.filter(key => !settings[key]);
    
    if (missing.length > 0) {
      log.warning(`Missing required settings: ${missing.join(', ')}`);
      return false;
    }
    
    return true;
  } catch (error) {
    log.error(`Settings test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 6: Module Initialization
 */
async function testModuleInit() {
  log.section('Module Initialization');
  
  try {
    log.info('Initializing Solar Forecast module...');
    
    await solarForecastModule.initialize();
    
    if (solarForecastModule.initialized) {
      log.success('Module initialized successfully');
      
      const status = solarForecastModule.getStatus();
      log.data('Enabled', status.enabled);
      log.data('Has Config', status.hasConfig);
      log.data('Location', status.latitude && status.longitude 
        ? `${status.latitude}°, ${status.longitude}°` 
        : 'N/A');
      log.data('Panel Power', status.panelPower ? `${status.panelPower} kWp` : 'N/A');
      
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
 * Test 7: Full Collection Test
 */
async function testFullCollection() {
  log.section('Full Collection Test');
  
  try {
    log.info('Running full collection with database settings...');
    
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
          date,
          expected_kwh,
          data_source
        FROM solar_forecasts
        ORDER BY created_at DESC
        LIMIT 7
      `);
      
      if (recentRecords.length > 0) {
        console.log(`\n  ${colors.gray}Recently stored forecasts:${colors.reset}`);
        recentRecords.forEach(record => {
          console.log(`    ${record.date} | ${record.expected_kwh.toFixed(2)} kWh | ${record.data_source}`);
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
 * Test 8: Query Forecasts
 */
async function testQueryForecasts() {
  log.section('Query Stored Forecasts');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    log.info(`Querying forecast for ${today}...`);
    
    const forecast = await collector.getForecast(today);
    
    if (forecast) {
      log.success(`Found forecast for today`);
      
      console.log(`\n  ${colors.gray}Today's forecast:${colors.reset}`);
      log.data('  Date', forecast.date);
      log.data('  Expected', `${forecast.expected_kwh.toFixed(2)} kWh`);
      log.data('  Actual', forecast.actual_kwh ? `${forecast.actual_kwh.toFixed(2)} kWh` : 'Not yet available');
      log.data('  Accuracy', forecast.accuracy_percentage ? `${forecast.accuracy_percentage.toFixed(1)}%` : 'N/A');
      
      // Get next 7 days
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const weekLater = new Date(today);
      weekLater.setDate(weekLater.getDate() + 7);
      
      const forecasts = await collector.getForecastRange(
        tomorrow.toISOString().split('T')[0],
        weekLater.toISOString().split('T')[0]
      );
      
      if (forecasts.length > 0) {
        console.log(`\n  ${colors.gray}Next 7 days:${colors.reset}`);
        forecasts.forEach(f => {
          console.log(`    ${f.date}: ${f.expected_kwh.toFixed(2)} kWh`);
        });
      }
      
      return true;
    } else {
      log.warning('No forecast found for today');
      log.info('Run collection first to fetch forecasts');
      return false;
    }
  } catch (error) {
    log.error(`Query test failed: ${error.message}`);
    return false;
  }
}

/**
 * Test 9: Accuracy Statistics
 */
async function testAccuracyStats() {
  log.section('Accuracy Statistics');
  
  try {
    log.info('Calculating forecast accuracy...');
    
    const stats = await collector.getAccuracyStats();
    
    if (stats.completed_days > 0) {
      log.success(`Found ${stats.completed_days} completed forecasts`);
      
      console.log(`\n  ${colors.gray}Statistics:${colors.reset}`);
      log.data('  Average Accuracy', stats.avg_accuracy ? `${stats.avg_accuracy.toFixed(1)}%` : 'N/A');
      log.data('  Best Accuracy', stats.max_accuracy ? `${stats.max_accuracy.toFixed(1)}%` : 'N/A');
      log.data('  Worst Accuracy', stats.min_accuracy ? `${stats.min_accuracy.toFixed(1)}%` : 'N/A');
      log.data('  Total Days', stats.total_days);
      log.data('  Completed Days', stats.completed_days);
      log.data('  Total Expected', stats.total_expected_kwh ? `${stats.total_expected_kwh.toFixed(2)} kWh` : 'N/A');
      log.data('  Total Actual', stats.total_actual_kwh ? `${stats.total_actual_kwh.toFixed(2)} kWh` : 'N/A');
      
      return true;
    } else {
      log.warning('No completed forecasts with actual data yet');
      log.info('Accuracy is calculated once actual solar production data is available');
      return true; // Not an error - just no data yet
    }
  } catch (error) {
    log.error(`Accuracy test failed: ${error.message}`);
    return false;
  }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Solar Forecast Module - Test Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(colors.reset);
  
  const results = {
    apiInfo: false,
    apiHealth: false,
    fetchForecast: false,
    database: false,
    settings: false,
    moduleInit: false,
    fullCollection: false,
    queryForecasts: false,
    accuracyStats: false,
  };
  
  try {
    // Run tests in sequence
    results.apiInfo = await testAPIInfo();
    results.apiHealth = await testAPIHealth();
    results.fetchForecast = (await testFetchForecast()).success;
    results.database = await testDatabase();
    results.settings = await testSettings();
    results.moduleInit = await testModuleInit();
    results.fullCollection = await testFullCollection();
    results.queryForecasts = await testQueryForecasts();
    results.accuracyStats = await testAccuracyStats();
    
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