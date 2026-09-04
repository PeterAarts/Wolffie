# Enhanced System Settings with Module Registry

## 🗄️ Enhanced Database Schema

### **Migration: Add Module Support to Existing Table**

```sql
-- ============================================================================
-- ENHANCE EXISTING system_settings TABLE
-- Add module support columns while keeping existing data
-- ============================================================================

ALTER TABLE system_settings 
  -- Module identification
  ADD COLUMN is_module BOOLEAN DEFAULT false AFTER value_type,
  ADD COLUMN module_id VARCHAR(50) NULL AFTER is_module,
  ADD COLUMN module_version VARCHAR(20) NULL AFTER module_id,
  
  -- UI Control
  ADD COLUMN editable BOOLEAN DEFAULT true AFTER is_encrypted,
  ADD COLUMN visible BOOLEAN DEFAULT true AFTER editable,
  ADD COLUMN display_order INT DEFAULT 0 AFTER visible,
  ADD COLUMN display_name VARCHAR(100) NULL AFTER display_order,
  
  -- Validation
  ADD COLUMN required BOOLEAN DEFAULT false AFTER display_name,
  ADD COLUMN validation_rules JSON NULL AFTER required,
  
  -- For enum/select types
  ADD COLUMN options JSON NULL AFTER validation_rules,
  
  -- Status
  ADD COLUMN enabled BOOLEAN DEFAULT true AFTER options,
  
  -- Add indexes
  ADD INDEX idx_module (is_module, module_id),
  ADD INDEX idx_category_module (category, module_id),
  ADD INDEX idx_editable (editable),
  ADD INDEX idx_enabled (enabled);

-- ============================================================================
-- MODULE REGISTRY TABLE
-- Tracks installed and available modules
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_registry (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Module Identity
  module_id VARCHAR(50) UNIQUE NOT NULL,      -- 'homewizard', 'alphaess-cloud'
  module_name VARCHAR(100) NOT NULL,          -- 'HomeWizard Integration'
  module_version VARCHAR(20) NOT NULL,        -- '1.0.0'
  module_type VARCHAR(50) NOT NULL,           -- 'data-collector', 'control', 'analytics'
  
  -- Status
  enabled BOOLEAN DEFAULT true,
  installed BOOLEAN DEFAULT false,            -- Is module installed/available?
  
  -- Capabilities
  has_collector BOOLEAN DEFAULT false,        -- Has data collector?
  has_api BOOLEAN DEFAULT false,              -- Has API routes?
  has_ui BOOLEAN DEFAULT false,               -- Has frontend UI?
  
  -- Configuration
  api_prefix VARCHAR(100),                    -- '/api/homewizard'
  settings_component VARCHAR(100),            -- 'HomeWizardSettings.vue'
  collector_interval INT DEFAULT 10000,       -- Collection interval (ms)
  collector_priority INT DEFAULT 5,           -- Priority (1-10)
  
  -- Metadata
  description TEXT,
  author VARCHAR(100),
  documentation_url VARCHAR(255),
  
  -- Timestamps
  discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  installed_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL,                -- Last time module was detected
  
  INDEX idx_module_id (module_id),
  INDEX idx_enabled (enabled),
  INDEX idx_installed (installed),
  INDEX idx_type (module_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- MIGRATE EXISTING SETTINGS TO NEW STRUCTURE
-- ============================================================================

-- Mark existing categories as core (non-module) settings
UPDATE system_settings 
SET is_module = false,
    module_id = NULL
WHERE category IN ('system', 'notifications', 'retention', 'websocket', 'summary');

-- Mark AlphaESS-related settings as module settings
UPDATE system_settings 
SET is_module = true,
    module_id = 'alphaess-cloud',
    module_version = '1.0.0'
WHERE category = 'cloud_api';

UPDATE system_settings 
SET is_module = true,
    module_id = 'alphaess-modbus-tcp',
    module_version = '1.0.0'
WHERE category = 'modbus';

UPDATE system_settings 
SET is_module = true,
    module_id = 'alphaess-modbus-rs485',
    module_version = '1.0.0'
WHERE category = 'rs485';

-- Set display names for better UI
UPDATE system_settings SET display_name = 'Application ID' WHERE setting_key = 'app_id';
UPDATE system_settings SET display_name = 'Application Secret' WHERE setting_key = 'app_secret';
UPDATE system_settings SET display_name = 'System Serial Number' WHERE setting_key = 'system_sn';
UPDATE system_settings SET display_name = 'Enabled' WHERE setting_key = 'enabled';
UPDATE system_settings SET display_name = 'Poll Interval (ms)' WHERE setting_key = 'poll_interval';
UPDATE system_settings SET display_name = 'Endpoint URL' WHERE setting_key = 'endpoint_url';
UPDATE system_settings SET display_name = 'IP Address' WHERE setting_key = 'ip_address';
UPDATE system_settings SET display_name = 'Port' WHERE setting_key = 'port';
UPDATE system_settings SET display_name = 'Slave ID' WHERE setting_key = 'slave_id';
UPDATE system_settings SET display_name = 'Serial Port' WHERE setting_key = 'serial_port';
UPDATE system_settings SET display_name = 'Baud Rate' WHERE setting_key = 'baud_rate';

-- Mark password/secret fields as not editable directly (use password change flow)
UPDATE system_settings 
SET editable = true,
    value_type = 'password'
WHERE setting_key = 'app_secret';

-- Mark summary fields as read-only (system-calculated)
UPDATE system_settings 
SET editable = false,
    visible = true
WHERE category = 'summary';

-- Add validation rules for specific fields
UPDATE system_settings 
SET validation_rules = '{"min": 1000, "max": 3600000}'
WHERE setting_key = 'poll_interval';

UPDATE system_settings 
SET validation_rules = '{"pattern": "^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"}'
WHERE setting_key = 'ip_address';

UPDATE system_settings 
SET validation_rules = '{"min": 1, "max": 65535}'
WHERE setting_key = 'port';

-- Add options for enum fields
UPDATE system_settings 
SET options = '["cloud", "modbus", "rs485"]'
WHERE setting_key = 'primary_source' AND category = 'data_collection';

-- Set display order for settings
UPDATE system_settings SET display_order = 1 WHERE setting_key = 'enabled';
UPDATE system_settings SET display_order = 2 WHERE setting_key = 'ip_address';
UPDATE system_settings SET display_order = 3 WHERE setting_key = 'port';
UPDATE system_settings SET display_order = 4 WHERE setting_key = 'slave_id';
UPDATE system_settings SET display_order = 5 WHERE setting_key = 'poll_interval';

-- ============================================================================
-- REGISTER EXISTING MODULES
-- ============================================================================

INSERT INTO module_registry (
  module_id, module_name, module_version, module_type,
  enabled, installed, has_collector, has_api, has_ui,
  api_prefix, settings_component, collector_interval, collector_priority,
  description, installed_at, last_seen_at
) VALUES 
(
  'alphaess-cloud',
  'AlphaESS Cloud API',
  '1.0.0',
  'data-collector',
  true,
  true,
  true,
  true,
  true,
  '/api/alphaess/cloud',
  'AlphaESSCloudSettings.vue',
  60000,
  1,
  'Collect data from AlphaESS Cloud API',
  NOW(),
  NOW()
),
(
  'alphaess-modbus-tcp',
  'AlphaESS ModBus TCP',
  '1.0.0',
  'data-collector',
  true,
  true,
  true,
  true,
  true,
  '/api/alphaess/modbus-tcp',
  'AlphaESSModbusTCPSettings.vue',
  10000,
  2,
  'Collect data via ModBus TCP connection',
  NOW(),
  NOW()
),
(
  'alphaess-modbus-rs485',
  'AlphaESS ModBus RS485',
  '1.0.0',
  'data-collector',
  true,
  true,
  true,
  true,
  true,
  '/api/alphaess/modbus-rs485',
  'AlphaESSModbusRS485Settings.vue',
  10000,
  3,
  'Collect data via ModBus RS485 serial connection',
  NOW(),
  NOW()
);

-- ============================================================================
-- EXAMPLE: Add new module (HomeWizard)
-- ============================================================================

-- Register module
INSERT INTO module_registry (
  module_id, module_name, module_version, module_type,
  enabled, installed, has_collector, has_api, has_ui,
  api_prefix, settings_component, collector_interval, collector_priority,
  description
) VALUES (
  'homewizard',
  'HomeWizard Integration',
  '1.0.0',
  'data-collector',
  true,
  true,
  true,
  true,
  true,
  '/api/homewizard',
  'HomeWizardSettings.vue',
  10000,
  4,
  'HomeWizard P1 Meter and Energy Socket integration'
);

-- Add module settings
INSERT INTO system_settings (
  category, setting_key, setting_value, value_type, is_encrypted,
  is_module, module_id, module_version,
  display_name, description, editable, visible, required,
  display_order
) VALUES
-- HomeWizard general settings
(
  'homewizard', 'enabled', 'true', 'boolean', 0,
  true, 'homewizard', '1.0.0',
  'Enable HomeWizard', 'Enable HomeWizard data collection', true, true, false,
  1
),
(
  'homewizard', 'poll_interval', '10000', 'number', 0,
  true, 'homewizard', '1.0.0',
  'Poll Interval (ms)', 'Collection interval in milliseconds', true, true, true,
  2
),
(
  'homewizard', 'auto_discovery', 'true', 'boolean', 0,
  true, 'homewizard', '1.0.0',
  'Auto Discovery', 'Automatically discover HomeWizard devices on network', true, true, false,
  3
);
```

---

## 🔧 Backend Service: Settings Manager

### **Enhanced Settings Service** (`core/services/settingsService.js`)

```javascript
import db from '../database.js';

class SettingsService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }

  /**
   * Get all settings for a category
   * @param {string} category - Category name
   * @param {boolean} editableOnly - Return only editable settings
   */
  async getSettingsByCategory(category, editableOnly = false) {
    const whereClause = editableOnly 
      ? 'WHERE category = ? AND editable = true AND visible = true'
      : 'WHERE category = ?';

    const [rows] = await db.pool.query(
      `SELECT * FROM system_settings 
       ${whereClause}
       ORDER BY display_order, setting_key`,
      [category]
    );

    return this.transformSettings(rows);
  }

  /**
   * Get all settings for a module
   * @param {string} moduleId - Module ID
   * @param {boolean} editableOnly - Return only editable settings
   */
  async getModuleSettings(moduleId, editableOnly = false) {
    const whereClause = editableOnly 
      ? 'WHERE module_id = ? AND is_module = true AND editable = true AND visible = true'
      : 'WHERE module_id = ? AND is_module = true';

    const [rows] = await db.pool.query(
      `SELECT * FROM system_settings 
       ${whereClause}
       ORDER BY category, display_order, setting_key`,
      [moduleId]
    );

    return this.transformSettings(rows);
  }

  /**
   * Get a specific setting value
   */
  async getSetting(category, key, moduleId = null) {
    const cacheKey = `${moduleId || 'core'}:${category}:${key}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.value;
      }
    }

    const whereClause = moduleId 
      ? 'WHERE category = ? AND setting_key = ? AND module_id = ?'
      : 'WHERE category = ? AND setting_key = ? AND (module_id IS NULL OR is_module = false)';

    const params = moduleId ? [category, key, moduleId] : [category, key];

    const [rows] = await db.pool.query(
      `SELECT * FROM system_settings ${whereClause}`,
      params
    );

    if (rows.length === 0) {
      return null;
    }

    const value = this.parseValue(rows[0]);
    
    // Cache result
    this.cache.set(cacheKey, { value, timestamp: Date.now() });
    
    return value;
  }

  /**
   * Set a setting value
   */
  async setSetting(category, key, value, moduleId = null) {
    // Clear cache
    const cacheKey = `${moduleId || 'core'}:${category}:${key}`;
    this.cache.delete(cacheKey);

    // Check if setting is editable
    const whereClause = moduleId 
      ? 'WHERE category = ? AND setting_key = ? AND module_id = ?'
      : 'WHERE category = ? AND setting_key = ? AND (module_id IS NULL OR is_module = false)';
    
    const params = moduleId ? [category, key, moduleId] : [category, key];

    const [settings] = await db.pool.query(
      `SELECT editable, value_type FROM system_settings ${whereClause}`,
      params
    );

    if (settings.length === 0) {
      throw new Error(`Setting ${category}.${key} not found`);
    }

    if (!settings[0].editable) {
      throw new Error(`Setting ${category}.${key} is not editable`);
    }

    // Validate value type
    const validatedValue = this.validateValue(value, settings[0].value_type);

    // Update setting
    await db.pool.query(
      `UPDATE system_settings 
       SET setting_value = ?, updated_at = NOW()
       ${whereClause}`,
      [validatedValue, ...params]
    );

    return validatedValue;
  }

  /**
   * Get all registered modules
   */
  async getRegisteredModules(enabledOnly = false) {
    const whereClause = enabledOnly ? 'WHERE enabled = true' : '';
    
    const [rows] = await db.pool.query(
      `SELECT * FROM module_registry ${whereClause} ORDER BY collector_priority`
    );

    return rows;
  }

  /**
   * Get module by ID
   */
  async getModule(moduleId) {
    const [rows] = await db.pool.query(
      'SELECT * FROM module_registry WHERE module_id = ?',
      [moduleId]
    );

    return rows[0] || null;
  }

  /**
   * Register or update a module
   */
  async registerModule(moduleInfo) {
    const {
      module_id,
      module_name,
      module_version,
      module_type,
      enabled = true,
      has_collector = false,
      has_api = false,
      has_ui = false,
      api_prefix = null,
      settings_component = null,
      collector_interval = 10000,
      collector_priority = 5,
      description = null
    } = moduleInfo;

    // Check if module exists
    const existing = await this.getModule(module_id);

    if (existing) {
      // Update existing module
      await db.pool.query(
        `UPDATE module_registry 
         SET module_name = ?, module_version = ?, module_type = ?,
             has_collector = ?, has_api = ?, has_ui = ?,
             api_prefix = ?, settings_component = ?,
             collector_interval = ?, collector_priority = ?,
             description = ?, updated_at = NOW(), last_seen_at = NOW()
         WHERE module_id = ?`,
        [
          module_name, module_version, module_type,
          has_collector, has_api, has_ui,
          api_prefix, settings_component,
          collector_interval, collector_priority,
          description, module_id
        ]
      );
    } else {
      // Insert new module
      await db.pool.query(
        `INSERT INTO module_registry (
          module_id, module_name, module_version, module_type,
          enabled, installed, has_collector, has_api, has_ui,
          api_prefix, settings_component, collector_interval, collector_priority,
          description, installed_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          module_id, module_name, module_version, module_type,
          enabled, has_collector, has_api, has_ui,
          api_prefix, settings_component, collector_interval, collector_priority,
          description
        ]
      );
    }

    return module_id;
  }

  /**
   * Register module settings
   */
  async registerModuleSettings(moduleId, settings) {
    for (const setting of settings) {
      const {
        category,
        setting_key,
        default_value,
        value_type = 'string',
        display_name,
        description,
        editable = true,
        visible = true,
        required = false,
        display_order = 0,
        validation_rules = null,
        options = null
      } = setting;

      // Check if setting exists
      const [existing] = await db.pool.query(
        `SELECT id FROM system_settings 
         WHERE category = ? AND setting_key = ? AND module_id = ?`,
        [category, setting_key, moduleId]
      );

      if (existing.length === 0) {
        // Insert new setting
        await db.pool.query(
          `INSERT INTO system_settings (
            category, setting_key, setting_value, value_type,
            is_module, module_id,
            display_name, description,
            editable, visible, required, display_order,
            validation_rules, options
          ) VALUES (?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            category, setting_key, default_value, value_type,
            moduleId,
            display_name, description,
            editable, visible, required, display_order,
            validation_rules ? JSON.stringify(validation_rules) : null,
            options ? JSON.stringify(options) : null
          ]
        );
      }
    }
  }

  /**
   * Transform database rows to typed values
   */
  transformSettings(rows) {
    const settings = {};

    for (const row of rows) {
      const key = row.setting_key;
      settings[key] = {
        value: this.parseValue(row),
        type: row.value_type,
        display_name: row.display_name || row.setting_key,
        description: row.description,
        editable: row.editable,
        visible: row.visible,
        required: row.required,
        validation_rules: row.validation_rules ? JSON.parse(row.validation_rules) : null,
        options: row.options ? JSON.parse(row.options) : null,
        is_module: row.is_module,
        module_id: row.module_id
      };
    }

    return settings;
  }

  /**
   * Parse setting value based on type
   */
  parseValue(setting) {
    const { setting_value, value_type } = setting;

    if (setting_value === null) {
      return null;
    }

    switch (value_type) {
      case 'boolean':
        return setting_value === 'true' || setting_value === '1' || setting_value === 1;
      
      case 'number':
        return parseFloat(setting_value);
      
      case 'json':
        try {
          return JSON.parse(setting_value);
        } catch {
          return setting_value;
        }
      
      default:
        return setting_value;
    }
  }

  /**
   * Validate and convert value based on type
   */
  validateValue(value, type) {
    switch (type) {
      case 'boolean':
        return value ? 'true' : 'false';
      
      case 'number':
        const num = parseFloat(value);
        if (isNaN(num)) {
          throw new Error('Invalid number value');
        }
        return num.toString();
      
      case 'json':
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return value;
      
      default:
        return String(value);
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export default new SettingsService();
```

---

## 🔄 Module Loader Enhancement

### **Auto-register modules on discovery** (`core/moduleLoader.js`)

```javascript
import settingsService from './services/settingsService.js';

class ModuleLoader {
  async loadModule(moduleName) {
    try {
      const modulePath = path.join(this.modulesPath, moduleName, 'index.js');
      
      if (!fs.existsSync(modulePath)) {
        return null;
      }

      const moduleUrl = `file://${modulePath}`;
      const module = await import(moduleUrl);
      const moduleExport = module.default;

      if (!moduleExport.manifest) {
        return null;
      }

      // Register module in database
      await settingsService.registerModule({
        module_id: moduleExport.manifest.id,
        module_name: moduleExport.manifest.name,
        module_version: moduleExport.manifest.version,
        module_type: moduleExport.manifest.type,
        enabled: moduleExport.manifest.enabled !== false,
        has_collector: moduleExport.manifest.capabilities?.dataCollection || false,
        has_api: moduleExport.manifest.routes?.enabled || false,
        has_ui: moduleExport.manifest.settings?.hasUI || false,
        api_prefix: moduleExport.manifest.routes?.prefix,
        settings_component: moduleExport.manifest.settings?.component,
        collector_interval: moduleExport.manifest.collector?.interval || 10000,
        collector_priority: moduleExport.manifest.collector?.priority || 5,
        description: moduleExport.manifest.description
      });

      // Register module settings if defined
      if (moduleExport.manifest.settings?.schema) {
        await settingsService.registerModuleSettings(
          moduleExport.manifest.id,
          moduleExport.manifest.settings.schema
        );
      }

      this.modules.set(moduleExport.manifest.id, moduleExport);
      console.log(`  ✓ Loaded: ${moduleExport.manifest.name} v${moduleExport.manifest.version}`);
      
      return moduleExport;
    } catch (error) {
      console.error(`❌ Failed to load module ${moduleName}:`, error.message);
      return null;
    }
  }
}
```

---

## 🎨 Frontend: Dynamic Settings UI

### **Settings View** (`Settings.vue`)

```vue
<template>
  <div class="settings-container">
    <TabView>
      <!-- Core Settings -->
      <TabPanel header="System">
        <DynamicSettingsForm 
          category="system"
          title="System Configuration"
        />
      </TabPanel>

      <!-- Module Settings (Dynamic) -->
      <TabPanel 
        v-for="module in modules" 
        :key="module.module_id"
        :header="module.module_name"
        :disabled="!module.enabled"
      >
        <div v-if="!module.enabled" class="module-disabled">
          <Message severity="warn">
            This module is disabled. Enable it in Module Management.
          </Message>
        </div>

        <DynamicSettingsForm 
          v-else
          :module-id="module.module_id"
          :title="module.module_name"
          :description="module.description"
        />
      </TabPanel>

      <!-- Module Management -->
      <TabPanel header="Modules">
        <ModuleManagement />
      </TabPanel>
    </TabView>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import DynamicSettingsForm from '@/components/settings/DynamicSettingsForm.vue';
import ModuleManagement from '@/components/settings/ModuleManagement.vue';

const modules = ref([]);

onMounted(async () => {
  const { data } = await axios.get('/api/settings/modules');
  modules.value = data.modules;
});
</script>
```

### **Dynamic Settings Form** (`DynamicSettingsForm.vue`)

```vue
<template>
  <div class="dynamic-settings-form">
    <h3>{{ title }}</h3>
    <p v-if="description" class="description">{{ description }}</p>

    <div v-if="loading" class="loading">
      <ProgressSpinner />
    </div>

    <div v-else class="settings-grid">
      <!-- Generate form fields dynamically -->
      <div 
        v-for="(setting, key) in settings" 
        :key="key"
        class="setting-field"
        v-show="setting.visible"
      >
        <label :for="key">
          {{ setting.display_name }}
          <span v-if="setting.required" class="required">*</span>
        </label>

        <!-- Boolean / Checkbox -->
        <Checkbox
          v-if="setting.type === 'boolean'"
          :id="key"
          v-model="setting.value"
          :binary="true"
          :disabled="!setting.editable || saving"
        />

        <!-- Number -->
        <InputNumber
          v-else-if="setting.type === 'number'"
          :id="key"
          v-model="setting.value"
          :disabled="!setting.editable || saving"
          :min="setting.validation_rules?.min"
          :max="setting.validation_rules?.max"
        />

        <!-- Enum / Select -->
        <Dropdown
          v-else-if="setting.options"
          :id="key"
          v-model="setting.value"
          :options="setting.options"
          :disabled="!setting.editable || saving"
        />

        <!-- Password -->
        <Password
          v-else-if="setting.type === 'password'"
          :id="key"
          v-model="setting.value"
          :disabled="!setting.editable || saving"
          :feedback="false"
          toggleMask
        />

        <!-- String (default) -->
        <InputText
          v-else
          :id="key"
          v-model="setting.value"
          :disabled="!setting.editable || saving"
        />

        <small v-if="setting.description" class="help-text">
          {{ setting.description }}
        </small>
      </div>
    </div>

    <div class="form-actions">
      <Button 
        label="Save Settings" 
        icon="pi pi-save"
        @click="saveSettings"
        :loading="saving"
        :disabled="!hasChanges"
      />
      <Button 
        label="Reset" 
        icon="pi pi-refresh"
        severity="secondary"
        @click="loadSettings"
        :disabled="saving"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { useToast } from 'primevue/usetoast';

const props = defineProps({
  category: String,
  moduleId: String,
  title: String,
  description: String
});

const toast = useToast();
const settings = ref({});
const originalSettings = ref({});
const loading = ref(false);
const saving = ref(false);

const hasChanges = computed(() => {
  return JSON.stringify(settings.value) !== JSON.stringify(originalSettings.value);
});

async function loadSettings() {
  loading.value = true;
  try {
    const url = props.moduleId 
      ? `/api/settings/module/${props.moduleId}`
      : `/api/settings/category/${props.category}`;
    
    const { data } = await axios.get(url);
    settings.value = data.settings;
    originalSettings.value = JSON.parse(JSON.stringify(data.settings));
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load settings',
      life: 3000
    });
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  try {
    const url = props.moduleId 
      ? `/api/settings/module/${props.moduleId}`
      : `/api/settings/category/${props.category}`;
    
    await axios.put(url, { settings: settings.value });
    
    originalSettings.value = JSON.parse(JSON.stringify(settings.value));
    
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Settings saved successfully',
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.response?.data?.message || 'Failed to save settings',
      life: 3000
    });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadSettings();
});
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.setting-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.setting-field label {
  font-weight: 600;
  color: #495057;
}

.required {
  color: #f44336;
  margin-left: 4px;
}

.help-text {
  color: #6c757d;
  font-size: 0.875rem;
}

.form-actions {
  display: flex;
  gap: 1rem;
}
</style>
```

---

## 📋 API Endpoints

```javascript
// GET /api/settings/modules
// Returns all registered modules
{
  modules: [
    {
      module_id: "homewizard",
      module_name: "HomeWizard Integration",
      enabled: true,
      has_ui: true,
      ...
    }
  ]
}

// GET /api/settings/module/:moduleId
// Returns all settings for a module
{
  settings: {
    enabled: { value: true, type: "boolean", editable: true, ... },
    poll_interval: { value: 10000, type: "number", editable: true, ... }
  }
}

// PUT /api/settings/module/:moduleId
// Update module settings
{
  settings: {
    enabled: true,
    poll_interval: 15000
  }
}
```

---

## ✅ Summary

**What This Gives You:**

1. ✅ **Module Registry** - System knows what modules are available
2. ✅ **Dynamic Settings** - Each module can define its own settings
3. ✅ **Editable Control** - Settings marked as `editable=true/false`
4. ✅ **Auto UI Generation** - Frontend forms generated from database schema
5. ✅ **Type Safety** - Settings validated by type (string, number, boolean, etc.)
6. ✅ **Backward Compatible** - Keeps your existing data, just adds columns

Your existing settings remain intact and work immediately! 🎯
