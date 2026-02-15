# Wolffie Module Development Guide

This guide outlines the architecture and coding standards for creating new modules within the Wolffie home battery monitoring and control system. Use the HomeWizard module as the primary reference for standardized implementation.

## 1. Module Directory Structure

Modules must be located in server/modules/{module-id}/. A standard module follows this layout:

```
modules/
└── my-new-module/
    ├── index.js                # Main entry point (Required)
    ├── manifest.json           # Module metadata (Required)
    ├── config/
    │   └── settings_schema.json # UI and database settings (Recommended)
    ├── services/
    │   └── collector.js        # Data collection logic
    └── routes/
        └── index.js            # Module-specific API routes
```

## 2. The Manifest (manifest.json)

The manifest.json provides the core identity for your module.
| Field     | Description |
| ----------- | ----------- |
| id | A unique string identifier (e.g., homewizard) used as the database category for settings.|
| name | The display name shown in the UI.|
| version | Semantic versioning for the module.|
| capabilities | Boolean flags indicating supported features like dataCollection, api, ui, and discovery.|
| collector | Default configuration for the module's polling interval and priority.|
| routes | whether an api is available for collecting data or setting values |
| settings | enables the management of settings, layout vai settings_schema.json |

Example Implementation
```
JSON
{
  "id": "homewizard",
  "name": "HomeWizard Energy",
  "version": "1.0.0",
  "description": "HomeWizard P1 Meter and Energy Socket integration",
  "author": "Wolffie",
  "type": "data-collector",
  "capabilities": {
    "dataCollection": true,
    "api": true,
    "ui": true,
    "discovery": true
  },
  "collector": {
    "enabled": true,
    "interval": 10000,
    "priority": 5,
    "description": "Collects data from HomeWizard devices every 10 seconds"
  },
  "routes": {
    "enabled": true,
    "prefix": "/api/homewizard",
    "description": "HomeWizard device management and data endpoints"
  },
  "settings": {
    "component": "HomeWizardSettings",
    "schema": "settings_schema.json"
  }
}
```

3. The Settings Schema (config/settings_schema.json)

The system uses a UI-centric schema to automatically prepare database tables and render the settings interface.

| Field     | Description |
| ----------- | ----------- |
| Groups & Sections | Organize settings into logical UI blocks.|
| Fields | Each field must contain a key (matching the database setting_key), a component type, and an optional default value.|
| Automatic Sync | Any field with a key and a default value is automatically initialized in the system_settings table on server startup if it does not exist.|
| UI Components | Common components include switch (boolean), number, text, info-panel, table, and card-grid.|
Example Implementation
```
JSON
{
  "groups": [
    {
      "title": "General Settings",
      "sections": [
        {
          "fields": [
            { "key": "enabled", "component": "switch","label": "Enable HomeWizard Integration","description": "Enable data collection from HomeWizard devices"},
            { "key": "poll_interval", "component": "number","label": "Poll Interval (seconds)","description": "How often to collect data from devices","min": 5,"max": 300,"default": 10}
          ]
        },
        {
          "component": "info-panel",
          "title": "Collector Status",
          "data": {
            "endpoint": "/api/homewizard/collector/status",
            "dynamic": true,
            "items": [
              { "label": "Status", "field": "isRunning", "template": { "type": "status-badge" } },
              { "label": "Devices", "field": "deviceCount" },
              { "label": "Last Collection", "field": "lastCollectionTime", "template": { "type": "datetime" } }
            ]
          }
        }
      ]
    },
    {
      "title": "Devices",
      "sections": [
        {
          "component": "table",
          "title": "Device List",
          "data": {
            "endpoint": "/api/homewizard/devices",
            "columns": [
              { "field": "name", "header": "Device Name", "sortable": true },
              { "field": "ip_address", "header": "IP Address", "sortable": true },
              { "field": "product_type", "header": "Type", "sortable": true },
              { "field": "enabled", "header": "Enabled", "template": { "type": "boolean" } }
            ],
            "globalActions": [
              { 
                "label": "Discover Devices", 
                "icon": "pi-search",
                "endpoint": "/api/homewizard/discover",
                "method": "POST",
                "confirmMessage": "This will scan your local network for HomeWizard devices. Continue?"
              }
            ],
            "rowActions": [
              { "label": "Edit", "icon": "pi-pencil","action": "edit"},
              { "label": "Delete", "icon": "pi-trash","action": "delete","confirmMessage": "Are you sure you want to delete this device?"}
            ]
          }
        },
        {
          "component": "card-grid",
          "title": "Statistics",
          "data": {
            "endpoint": "/api/homewizard/devices/stats",
            "cards": [
              { "title": "Total Devices", "field": "totalDevices", "icon": "pi-box","color": "primary"},
              { "title": "Total Power", "field": "totalPower", "suffix": " W","icon": "pi-bolt","color": "warning"}
            ]
          }
        }
      ]
    }
  ]
}
```

## 4. The Entry Point (index.js)
The index.js file exports a default object that the ModuleLoader uses to integrate the module into the core system.

| Field     | Description |
| ----------- | ----------- |
| initialize() | An async function called during startup. The manifest and settingsSchema are automatically attached to the module instance before this call. |
| collect() | The entry point for the scheduled data collection cycle, typically delegating to the collector service. |
| getStatus() | Returns the health and status of the module for system monitoring. |

Example Implementation
```
JavaScript


// modules/homewizard/index.js
import collector from './services/collector.js';
import routes from './routes/index.js';

export default {
  routes,
  collector,

  async initialize() {
    // manifest is attached by moduleLoader after import
    console.log(`Initializing module: ${this.manifest.name}`);
  },

  async collect() {
    return collector.collect();
  },

  getStatus() {
    return {
      ...this.manifest,
      collectorStatus: collector.getStatus()
    };
  }
};
```

## 5. API Communication Service (/services/api.js)
This service encapsulates all raw communication with target hardware.

| Field     | Description |
| ----------- | ----------- |
| getData() | Fetches real-time measurements from a device.|
| getInfo() / getSystem() | Retrieves device metadata like firmware versions or product types.|
| testConnection() | Validates that a device at a specific IP and port is reachable.|
| discoverDevices() | (Optional) Implementation for scanning the local network for compatible hardware.|

Example Implementation
```
JavaScript


// modules/homewizard/services/api.js
import axios from 'axios';

class HomeWizardAPI {
  async getData(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api/v1/data`, {
        timeout: 3000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  async getInfo(ipAddress, port = 80) {
    try {
      const response = await axios.get(`http://${ipAddress}:${port}/api`, {
        timeout: 3000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Connection failed: ${error.message}`);
    }
  }
}

export default new HomeWizardAPI();
```

## 6. Data Collection Logic (/services/collector.js)
The collector manages the lifecycle of data for all configured devices associated with the module.

| Field     | Description |
| ----------- | ----------- |
| loadDevices() | Retrieves enabled devices from the device_settings table belonging to this module.|
| collect() | Iterates through loaded devices and triggers module-specific storage logic|
| Storage Methods | 
Normalize raw API data into standard system formats.
Insert measurements into the device_measurements table.
Store high-level metrics (power, voltage, current) in designated columns and pack detailed data into the extra_metrics JSON field.|

Example Implementation
```
JavaScript


// modules/homewizard/services/collector.js
import db from '../../../core/database.js';
import homewizardAPI from './api.js';

class HomeWizardCollector {
  async collect() {
    try {
      if (!this.devicesLoaded) await this.loadDevices();
      if (this.devices.length === 0) return true;

      const results = await Promise.allSettled(
        this.devices.map(device => this.collectFromDevice(device))
      );
      return results.every(r => r.status === 'fulfilled');
    } catch (error) {
      console.error('❌ HomeWizard collection failed:', error.message);
      return false;
    }
  }

  async storeP1Data(device, data) {
    const timestamp = new Date();
    await db.pool.query(
      `INSERT INTO device_measurements (
        timestamp, device_id, device_type, device_name, source,
        power, voltage, current, extra_metrics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        timestamp,
        device.serial || device.ip_address,
        device.product_type,
        device.name,
        'homewizard',
        data.active_power_w || 0,
        data.active_voltage_v || 0,
        data.active_current_a || 0,
        JSON.stringify(data)
      ]
    );
  }
}

export default new HomeWizardCollector();

```
## 7. Module Routes (/routes/index.js)
Exposes module functionality to the frontend via an Express router.

| Field     | Description |
| ----------- | ----------- |
| GET /settings/schema | Returns the settings_schema.json merged with current database values.
| PUT /settings | Updates configurations via the centralized settingsService.
|Device Management | Standard CRUD endpoints for managing devices (/devices, /devices/:id).

Example Implementation
```
JavaScript


// modules/homewizard/routes/index.js
import express from 'express';
import settingsService from '../../../core/system/services/settingsService.js';

const router = express.Router();

router.get('/settings/schema', async (req, res) => {
  try {
    const moduleId = 'homewizard';
    const currentSettings = await settingsService.getModuleSettings(moduleId);
    const module = settingsService.moduleLoader.getModule(moduleId);
    
    // settingsSchema is attached to the module instance
    const schemaWithValues = mergeSchemaWithValues(module.manifest.settingsSchema, currentSettings);
    
    res.json({ success: true, schema: schemaWithValues });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function mergeSchemaWithValues(schema, currentSettings) {
  const merged = JSON.parse(JSON.stringify(schema));
  merged.groups.forEach(group => {
    group.sections?.forEach(section => {
      section.fields?.forEach(field => {
        if (currentSettings[field.key] !== undefined) {
          field.value = currentSettings[field.key];
        }
      });
    });
  });
  return merged;
}

export default router;
```

## 8. Coding Principles & Best Practices
| Field     | Description |
| ----------- | ----------- |
| Centralized Settings | Always use the settingsService to retrieve your module's configuration using your module id as the category.|
| Validation | Leverage the validate method in settingsService to ensure data types match the requirements defined in your schema.|
| Fail-Safe Collection | Handle network timeouts and device offline states gracefully in your collector to prevent one failing device from crashing the system.|
| Data Aggregation | Ensure primary grid data is correctly identified and used to update system-level snapshots.|
