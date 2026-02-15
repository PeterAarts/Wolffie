# Module Test Script - Usage Guide

## Overview
Each module should have a `test.js` file in its root directory that tests:
- API connectivity (if applicable)
- Database connectivity
- Settings loading from database
- Module initialization
- Full data collection
- Data retrieval/querying

## File Location
```
modules/[module-name]/test.js
```

## Usage
```bash
# Run from project root
node modules/[module-name]/test.js

# Or from module directory
cd modules/[module-name]
node test.js
```

## Test Structure

### 1. Imports and Setup
```javascript
import api from './services/api.js';
import collector from './services/collector.js';
import moduleInstance from './index.js';
import db from '../../core/database.js';
import settingsService from '../../core/system/services/settingsService.js';

// ANSI Colors
const colors = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
};

// Helper functions
const log = {
  section: (msg) => console.log(`\n${colors.cyan}${colors.bold}═══ ${msg} ═══${colors.reset}\n`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.gray}ℹ${colors.reset} ${msg}`),
  data: (label, value) => console.log(`  ${colors.gray}${label}:${colors.reset} ${value}`),
};
```

### 2. Required Tests

#### Test 1: API Information (if module has external API)
```javascript
async function testAPIInfo() {
  log.section('API Information');
  
  try {
    const apiInfo = api.getAPIInfo();
    log.success('API Information retrieved');
    log.data('Provider', apiInfo.provider);
    // ... show API details
    return true;
  } catch (error) {
    log.error(`Failed: ${error.message}`);
    return false;
  }
}
```

#### Test 2: API Health Check
```javascript
async function testAPIHealth() {
  log.section('API Health Check');
  
  try {
    const health = await api.healthCheck();
    
    if (health.available) {
      log.success('API is available');
      return true;
    } else {
      log.error(`API unavailable: ${health.error}`);
      return false;
    }
  } catch (error) {
    log.error(`Health check failed: ${error.message}`);
    return false;
  }
}
```

#### Test 3: Database Connection
```javascript
async function testDatabase() {
  log.section('Database Connection');
  
  try {
    const [rows] = await db.pool.query('SELECT 1 as test');
    log.success('Database connection successful');
    
    // Check if module table exists
    const [tables] = await db.pool.query(`SHOW TABLES LIKE 'module_table_name'`);
    
    if (tables.length > 0) {
      log.success('Table "module_table_name" exists');
      
      const [count] = await db.pool.query(`SELECT COUNT(*) as count FROM module_table_name`);
      log.data('Current records', count[0].count);
      
      return true;
    } else {
      log.error('Table does not exist');
      return false;
    }
  } catch (error) {
    log.error(`Database test failed: ${error.message}`);
    return false;
  }
}
```

#### Test 4: Load Settings
```javascript
async function testSettings() {
  log.section('Load Settings from Database');
  
  try {
    const settings = await settingsService.getCategory('module-name');
    
    if (!settings) {
      log.error('No settings found');
      return false;
    }
    
    log.success('Settings loaded successfully');
    log.data('Enabled', settings.enabled);
    // ... show other settings
    
    // Validate required settings
    const required = ['setting1', 'setting2'];
    const missing = required.filter(key => !settings[key]);
    
    if (missing.length > 0) {
      log.warning(`Missing: ${missing.join(', ')}`);
      return false;
    }
    
    return true;
  } catch (error) {
    log.error(`Settings test failed: ${error.message}`);
    return false;
  }
}
```

#### Test 5: Module Initialization
```javascript
async function testModuleInit() {
  log.section('Module Initialization');
  
  try {
    await moduleInstance.initialize();
    
    if (moduleInstance.initialized) {
      log.success('Module initialized successfully');
      
      const status = moduleInstance.getStatus();
      log.data('Enabled', status.enabled);
      log.data('Has Config', status.hasConfig);
      
      return true;
    } else {
      log.warning('Module not enabled');
      return false;
    }
  } catch (error) {
    log.error(`Initialization failed: ${error.message}`);
    return false;
  }
}
```

#### Test 6: Full Collection
```javascript
async function testFullCollection() {
  log.section('Full Collection Test');
  
  try {
    log.info('Running collection...');
    
    const success = await collector.collect();
    
    if (success) {
      log.success('Collection completed');
      
      const status = collector.getStatus();
      log.data('Last Run', status.lastRun ? status.lastRun.toISOString() : 'Never');
      log.data('Last Error', status.lastError || 'None');
      
      // Show recently collected data
      // ... query database
      
      return true;
    } else {
      log.error('Collection failed');
      return false;
    }
  } catch (error) {
    log.error(`Collection test failed: ${error.message}`);
    return false;
  }
}
```

#### Test 7: Data Query
```javascript
async function testQueryData() {
  log.section('Query Collected Data');
  
  try {
    // Query data from database or collector
    // ... show results
    
    return true;
  } catch (error) {
    log.error(`Query test failed: ${error.message}`);
    return false;
  }
}
```

### 3. Test Runner
```javascript
async function runAllTests() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Module Name - Test Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(colors.reset);
  
  const results = {
    apiInfo: false,
    apiHealth: false,
    database: false,
    settings: false,
    moduleInit: false,
    fullCollection: false,
    queryData: false,
  };
  
  try {
    // Run tests in sequence
    results.apiInfo = await testAPIInfo();
    results.apiHealth = await testAPIHealth();
    results.database = await testDatabase();
    results.settings = await testSettings();
    results.moduleInit = await testModuleInit();
    results.fullCollection = await testFullCollection();
    results.queryData = await testQueryData();
    
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
    await db.pool.end();
    console.log(`${colors.gray}Database connection closed${colors.reset}\n`);
  }
}

// Run the test suite
runAllTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
```

## Example Output

```
═══════════════════════════════════════════════════════════
  Module Name - Test Suite
═══════════════════════════════════════════════════════════

═══ API Information ═══

✓ API Information retrieved
  Provider: Example API
  Documentation: https://api.example.com/docs

═══ API Health Check ═══

ℹ Testing connection to Example API...
✓ API is available and responding

═══ Database Connection ═══

✓ Database connection successful
✓ Table "module_table" exists
  Current records: 150

═══ Load Settings from Database ═══

ℹ Loading module-name settings...
✓ Settings loaded successfully
  Enabled: true
  Setting1: value1

═══ Module Initialization ═══

ℹ Initializing Module...
   - module-name 
     - Configuration loaded
     - Module ready ✓
✓ Module initialized successfully
  Enabled: true
  Has Config: true

═══ Full Collection Test ═══

ℹ Running collection...
☀️  Module: Starting collection...
  ... collection output ...
✅ Module: Collected 10 records
✓ Collection completed
  Last Run: 2026-02-15T10:30:00.000Z
  Last Error: None

═══ Query Collected Data ═══

ℹ Querying collected data...
✓ Found data for today

═══ Test Summary ═══

  ✓ api Info
  ✓ api Health
  ✓ database
  ✓ settings
  ✓ module Init
  ✓ full Collection
  ✓ query Data

Results: 7/7 tests passed

✓ All tests passed!

Database connection closed
```

## Customization Per Module

### For Modules with External API
Include:
- API info test
- API health check
- Test fetch with example data

### For Modules without External API
Skip API tests, focus on:
- Database tests
- Settings tests
- Data collection tests

### For Modules with Device Discovery
Add:
- Device discovery test
- Device connectivity test

### For Modules with Control Features
Add:
- Control command test
- State verification test

## Common Test Patterns

### Pattern 1: Data Collector Module
```javascript
// Tests: API, Database, Settings, Collection, Query
// Example: solar-forecast, day-ahead-prices
```

### Pattern 2: Device Integration Module
```javascript
// Tests: Database, Settings, Device Discovery, Collection, Control
// Example: homewizard, alphaess-modbus
```

### Pattern 3: Cloud API Module
```javascript
// Tests: API Auth, API Health, Database, Collection, Query
// Example: alphaess-cloud
```

## Prerequisites Checklist

Before running tests, ensure:
- [ ] Database table exists
- [ ] Module settings in system_settings table
- [ ] Database connection configured
- [ ] Required npm packages installed
- [ ] API credentials (if required)
- [ ] Network connectivity (for external APIs)

## Troubleshooting

### "Settings not found"
```sql
-- Add module settings
INSERT INTO system_settings (module_id, category, setting_key, setting_value, value_type)
VALUES ('module-name', 'module-name', 'enabled', 'true', 'boolean');
```

### "Table doesn't exist"
Run the CREATE TABLE statement for your module.

### "API unavailable"
- Check internet connection
- Verify API is online
- Check firewall settings

### "Module not initialized"
- Check if enabled in settings
- Verify required settings are present
- Check console for initialization errors

## Best Practices

1. **Always test with database settings** - Don't hardcode config
2. **Use colored output** - Makes results easy to read
3. **Show sample data** - Help users understand what's happening
4. **Clear error messages** - Guide users to solutions
5. **Test in sequence** - Validate prerequisites before complex tests
6. **Clean up** - Close database connections
7. **Handle failures gracefully** - Continue with other tests

## Files Required

For each module test.js, you need:
```
modules/[module-name]/
├── test.js              ← THIS FILE
├── index.js             ← Module main file
├── services/
│   ├── api.js          ← API client (if applicable)
│   └── collector.js    ← Data collector
└── ...
```

## Running Tests for All Modules

Create a test runner script:
```bash
#!/bin/bash
# test-all-modules.sh

echo "Testing all modules..."

node modules/solar-forecast/test.js
node modules/day-ahead-prices/test.js
node modules/homewizard/test.js
# ... add other modules

echo "All module tests complete!"
```
