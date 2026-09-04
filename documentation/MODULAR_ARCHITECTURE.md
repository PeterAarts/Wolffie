# WattsOn Modular Architecture Design

## 🏗️ Architecture Overview

```
server/
├── modules/                          # All data collection modules
│   ├── alphaess-cloud/              # AlphaESS Cloud API module
│   │   ├── routes/
│   │   │   └── index.js             # API endpoints for this module
│   │   ├── services/
│   │   │   ├── collector.js         # Data collection service
│   │   │   └── api.js               # AlphaESS API client
│   │   ├── config/
│   │   │   └── manifest.json        # Module metadata
│   │   └── index.js                 # Module entry point
│   │
│   ├── alphaess-modbus-tcp/         # AlphaESS ModBus TCP module
│   │   ├── routes/
│   │   ├── services/
│   │   ├── config/
│   │   └── index.js
│   │
│   ├── alphaess-modbus-rs485/       # AlphaESS ModBus RS485 module
│   │   ├── routes/
│   │   ├── services/
│   │   ├── config/
│   │   └── index.js
│   │
│   ├── homewizard/                  # HomeWizard module
│   │   ├── routes/
│   │   │   └── index.js
│   │   ├── services/
│   │   │   ├── collector.js
│   │   │   ├── api.js
│   │   │   └── discovery.js
│   │   ├── config/
│   │   │   └── manifest.json
│   │   └── index.js
│   │
│   └── solaredge/                   # SolarEdge module (future)
│       ├── routes/
│       ├── services/
│       ├── config/
│       └── index.js
│
├── core/                            # Core system (non-modular)
│   ├── moduleLoader.js              # Discovers and loads all modules
│   ├── collectorManager.js          # Manages all data collectors
│   ├── routeManager.js              # Manages all module routes
│   └── database.js                  # Shared database service
│
├── routes/
│   └── index.js                     # Main router with module discovery
│
└── server.js                        # Main application entry

frontend/
├── modules/                         # Frontend module components
│   ├── alphaess-cloud/
│   │   └── SettingsPanel.vue       # Settings UI for this module
│   ├── homewizard/
│   │   └── SettingsPanel.vue
│   └── ...
│
└── views/
    └── Settings.vue                 # Main settings with dynamic tabs
```

---

## 📦 Module Structure

Each module follows this standardized structure:

### **1. Module Manifest** (`config/manifest.json`)
```json
{
  "id": "homewizard",
  "name": "HomeWizard",
  "version": "1.0.0",
  "description": "HomeWizard P1 Meter and Energy Socket integration",
  "author": "WattsOn",
  "type": "data-collector",
  
  "capabilities": {
    "dataCollection": true,
    "realtime": true,
    "historical": true,
    "deviceDiscovery": true
  },
  
  "settings": {
    "hasUI": true,
    "component": "HomeWizardSettings"
  },
  
  "routes": {
    "prefix": "/api/homewizard",
    "enabled": true
  },
  
  "collector": {
    "enabled": true,
    "interval": 10000,
    "priority": 3
  },
  
  "dependencies": {
    "database": ["homewizard_settings", "homewizard_energy_snapshots"],
    "npm": ["axios"]
  }
}
```

### **2. Module Entry Point** (`index.js`)
```javascript
// modules/homewizard/index.js
import collector from './services/collector.js';
import routes from './routes/index.js';
import manifest from './config/manifest.json' assert { type: 'json' };

export default {
  manifest,
  routes,
  collector,
  
  async initialize() {
    console.log(`Initializing module: ${manifest.name}`);
    // Module-specific initialization
  },
  
  async start() {
    if (manifest.collector.enabled) {
      await collector.start();
    }
  },
  
  async stop() {
    await collector.stop();
  },
  
  getStatus() {
    return {
      ...manifest,
      collectorStatus: collector.getStatus()
    };
  }
};
```

### **3. Collector Service** (`services/collector.js`)
```javascript
// modules/homewizard/services/collector.js
import db from '../../../core/database.js';
import api from './api.js';

class HomeWizardCollector {
  constructor() {
    this.isRunning = false;
    this.devices = new Map();
    this.intervals = new Map();
  }

  async start() {
    console.log('- HW-API => Starting collector...');
    // Load devices and start collection
  }

  async stop() {
    console.log('- HW-API => Stopping collector...');
    // Stop all intervals
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      deviceCount: this.devices.size
    };
  }
}

export default new HomeWizardCollector();
```

### **4. API Routes** (`routes/index.js`)
```javascript
// modules/homewizard/routes/index.js
import express from 'express';
import db from '../../../core/database.js';

const router = express.Router();

router.get('/latest', async (req, res) => {
  console.log('- ClientAPI => GET /api/homewizard/latest');
  // Return latest data from database
});

router.get('/devices', async (req, res) => {
  // List configured devices
});

router.post('/discover', async (req, res) => {
  // Discover devices on network
});

export default router;
```

---

## 🔧 Core System Components

### **1. Module Loader** (`core/moduleLoader.js`)
```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ModuleLoader {
  constructor() {
    this.modules = new Map();
    this.modulesPath = path.join(__dirname, '../modules');
  }

  async discoverModules() {
    console.log('🔍 Discovering modules...');
    
    const moduleDirs = fs.readdirSync(this.modulesPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const moduleDir of moduleDirs) {
      await this.loadModule(moduleDir);
    }

    console.log(`✅ Discovered ${this.modules.size} module(s)`);
    return Array.from(this.modules.values());
  }

  async loadModule(moduleName) {
    try {
      const modulePath = path.join(this.modulesPath, moduleName, 'index.js');
      
      if (!fs.existsSync(modulePath)) {
        console.warn(`⚠️  Module ${moduleName} has no index.js`);
        return null;
      }

      const moduleUrl = `file://${modulePath}`;
      const module = await import(moduleUrl);
      const moduleExport = module.default;

      if (!moduleExport.manifest) {
        console.warn(`⚠️  Module ${moduleName} has no manifest`);
        return null;
      }

      this.modules.set(moduleExport.manifest.id, moduleExport);
      console.log(`  ✓ Loaded: ${moduleExport.manifest.name} v${moduleExport.manifest.version}`);
      
      return moduleExport;
    } catch (error) {
      console.error(`❌ Failed to load module ${moduleName}:`, error.message);
      return null;
    }
  }

  getModule(moduleId) {
    return this.modules.get(moduleId);
  }

  getAllModules() {
    return Array.from(this.modules.values());
  }

  getManifests() {
    return this.getAllModules().map(m => m.manifest);
  }
}

export default new ModuleLoader();
```

### **2. Collector Manager** (`core/collectorManager.js`)
```javascript
class CollectorManager {
  constructor() {
    this.collectors = new Map();
  }

  async startAll(modules) {
    console.log('🚀 Starting all data collectors...');
    
    for (const module of modules) {
      if (module.manifest.collector?.enabled && module.collector) {
        try {
          await module.start();
          this.collectors.set(module.manifest.id, module.collector);
          console.log(`  ✓ Started: ${module.manifest.name} collector`);
        } catch (error) {
          console.error(`  ✗ Failed to start ${module.manifest.name}:`, error.message);
        }
      }
    }
  }

  async stopAll() {
    console.log('🛑 Stopping all data collectors...');
    
    for (const [moduleId, collector] of this.collectors) {
      try {
        if (collector.stop) {
          await collector.stop();
          console.log(`  ✓ Stopped: ${moduleId}`);
        }
      } catch (error) {
        console.error(`  ✗ Error stopping ${moduleId}:`, error.message);
      }
    }
  }

  getStatus() {
    const status = {};
    for (const [moduleId, collector] of this.collectors) {
      status[moduleId] = collector.getStatus?.() || { isRunning: false };
    }
    return status;
  }
}

export default new CollectorManager();
```

### **3. Route Manager** (`core/routeManager.js`)
```javascript
class RouteManager {
  constructor(app) {
    this.app = app;
    this.routes = new Map();
  }

  registerModuleRoutes(modules) {
    console.log('🛣️  Registering module routes...');
    
    for (const module of modules) {
      if (module.manifest.routes?.enabled && module.routes) {
        const prefix = module.manifest.routes.prefix || `/api/${module.manifest.id}`;
        
        try {
          this.app.use(prefix, module.routes);
          this.routes.set(module.manifest.id, prefix);
          console.log(`  ✓ Registered: ${prefix} (${module.manifest.name})`);
        } catch (error) {
          console.error(`  ✗ Failed to register routes for ${module.manifest.name}:`, error.message);
        }
      }
    }
  }

  getRegisteredRoutes() {
    return Array.from(this.routes.entries()).map(([moduleId, prefix]) => ({
      moduleId,
      prefix
    }));
  }
}

export default RouteManager;
```

---

## 🚀 Main Application Integration

### **Updated `server.js`**
```javascript
import express from 'express';
import moduleLoader from './core/moduleLoader.js';
import collectorManager from './core/collectorManager.js';
import RouteManager from './core/routeManager.js';

const app = express();
const routeManager = new RouteManager(app);

// Core routes (non-modular)
app.use('/api/system', systemRoutes);

// Initialize modular system
async function initializeModules() {
  try {
    // 1. Discover all modules
    const modules = await moduleLoader.discoverModules();
    
    // 2. Initialize modules
    for (const module of modules) {
      if (module.initialize) {
        await module.initialize();
      }
    }
    
    // 3. Register routes
    routeManager.registerModuleRoutes(modules);
    
    // 4. Start collectors
    await collectorManager.startAll(modules);
    
    console.log('✅ All modules initialized');
  } catch (error) {
    console.error('❌ Module initialization failed:', error);
  }
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeModules();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await collectorManager.stopAll();
  process.exit(0);
});
```

### **Module Status API** (Core Route)
```javascript
// routes/system.js
router.get('/modules', async (req, res) => {
  const manifests = moduleLoader.getManifests();
  const collectorStatus = collectorManager.getStatus();
  const routes = routeManager.getRegisteredRoutes();
  
  res.json({
    modules: manifests.map(m => ({
      ...m,
      collectorStatus: collectorStatus[m.id],
      routes: routes.find(r => r.moduleId === m.id)
    }))
  });
});
```

---

## 🎨 Frontend Integration

### **Dynamic Settings Tabs** (`Settings.vue`)
```vue
<template>
  <div class="settings-container">
    <TabView>
      <!-- Core System Tabs -->
      <TabPanel header="System">
        <SystemSettings />
      </TabPanel>
      
      <!-- Dynamic Module Tabs -->
      <TabPanel 
        v-for="module in modules" 
        :key="module.id"
        :header="module.name"
      >
        <component 
          :is="getModuleComponent(module.id)"
          :module="module"
        />
      </TabPanel>
    </TabView>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

// Import module components
import AlphaESSSettings from '@/modules/alphaess-cloud/SettingsPanel.vue';
import HomeWizardSettings from '@/modules/homewizard/SettingsPanel.vue';

const modules = ref([]);

const componentMap = {
  'alphaess-cloud': AlphaESSSettings,
  'homewizard': HomeWizardSettings
};

const getModuleComponent = (moduleId) => {
  return componentMap[moduleId] || DefaultModuleSettings;
};

onMounted(async () => {
  const { data } = await axios.get('/api/system/modules');
  modules.value = data.modules.filter(m => m.settings?.hasUI);
});
</script>
```

---

## 📋 Migration Path

### **Phase 1: Create Core Structure**
1. Create `modules/` directory
2. Implement `core/moduleLoader.js`
3. Implement `core/collectorManager.js`
4. Implement `core/routeManager.js`

### **Phase 2: Migrate HomeWizard**
1. Create `modules/homewizard/` structure
2. Move existing HomeWizard code into module
3. Create manifest.json
4. Test standalone

### **Phase 3: Migrate AlphaESS**
1. Create three modules:
   - `modules/alphaess-cloud/`
   - `modules/alphaess-modbus-tcp/`
   - `modules/alphaess-modbus-rs485/`
2. Split existing dataCollector.js
3. Test each module

### **Phase 4: Frontend Enhancement**
1. Create module settings components
2. Implement dynamic tab loading
3. Add module enable/disable UI

---

## ✅ Benefits

1. **Modularity**: Easy to add/remove integrations
2. **Maintainability**: Each module is self-contained
3. **Scalability**: Add new inverter types without touching core
4. **Testing**: Test modules independently
5. **Extensibility**: Third-party modules possible
6. **Configuration**: Enable/disable modules via manifest

This architecture provides a solid foundation for a plugin-based system! 🎯
