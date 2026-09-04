# API Data Flow & Architecture Explanation

## 🎯 How the System Works

### **Question 1: How does data loading work when a tab is active?**

**Answer:** Data loads **on-demand** when the tab is clicked. Each module has its own API endpoint that serves both the schema AND the current values.

---

## 📊 Data Flow Architecture

### **Step-by-Step Flow:**

```
1. User clicks "HomeWizard" tab in Settings
   ↓
2. Vue component mounts: <UniversalSettingsPanel module-id="homewizard" />
   ↓
3. Component calls: GET /api/homewizard/settings/schema
   ↓
4. Backend returns: { schema + current values }
   ↓
5. Frontend renders UI based on schema
   ↓
6. User edits field
   ↓
7. Frontend calls: PUT /api/homewizard/settings
   ↓
8. Backend validates & saves to database
```

---

## 🔄 API Endpoint Structure

### **Pattern: Each Module Has Its Own Settings Endpoint**

```javascript
// Module: homewizard
GET  /api/homewizard/settings/schema    // Get UI definition + values
PUT  /api/homewizard/settings           // Update settings
GET  /api/homewizard/devices            // Get devices table data
POST /api/homewizard/discover           // Execute action

// Module: alphaess-cloud
GET  /api/alphaess-cloud/settings/schema
PUT  /api/alphaess-cloud/settings

// Core system settings
GET  /api/settings/core/schema          // System-wide settings
PUT  /api/settings/core
GET  /api/settings/modules              // Module list (for module management)
```

---

## 📦 Example API Responses

### **1. GET /api/homewizard/settings/schema**

This endpoint returns EVERYTHING the frontend needs:

```json
{
  "success": true,
  "module": {
    "id": "homewizard",
    "name": "HomeWizard Integration",
    "icon": "pi-bolt",
    "color": "#f59e0b",
    "description": "P1 Meter and Energy Socket integration"
  },
  "schema": {
    "groups": [
      {
        "id": "general",
        "label": "General Settings",
        "icon": "pi-cog",
        "order": 1,
        "sections": [
          {
            "id": "basic-settings",
            "label": "Basic Configuration",
            "fields": [
              {
                "key": "enabled",
                "label": "Enable Module",
                "component": "switch",
                "type": "boolean",
                "value": true,              // ← Current value from database
                "defaultValue": true,
                "editable": true,
                "required": false,
                "helpText": "Enable HomeWizard data collection"
              },
              {
                "key": "poll_interval",
                "label": "Poll Interval",
                "component": "number",
                "type": "number",
                "value": 10000,             // ← Current value from database
                "defaultValue": 10000,
                "editable": true,
                "required": true,
                "validation": {
                  "min": 1000,
                  "max": 60000,
                  "step": 1000
                },
                "suffix": " ms",
                "helpText": "Collection interval (1000-60000 ms)"
              }
            ]
          },
          {
            "id": "collector-status",
            "component": "info-panel",
            "label": "Collector Status",
            "data": {
              "type": "key-value",
              "endpoint": "/api/homewizard/collector/status",
              "dynamic": true,
              "refreshInterval": 5000,
              "items": [
                {
                  "label": "Status",
                  "field": "isRunning",
                  "icon": "pi-power-off",
                  "template": {
                    "type": "status-badge",
                    "trueLabel": "Running",
                    "falseLabel": "Stopped",
                    "trueSeverity": "success",
                    "falseSeverity": "danger"
                  }
                }
              ]
            }
          }
        ]
      },
      {
        "id": "devices",
        "label": "Devices",
        "icon": "pi-box",
        "order": 2,
        "sections": [
          {
            "id": "device-list",
            "component": "table",
            "label": "Connected Devices",
            "description": "Manage HomeWizard devices",
            "data": {
              "endpoint": "/api/homewizard/devices",
              "dataKey": "device_id",
              "columns": [
                {
                  "field": "device_name",
                  "header": "Device Name",
                  "sortable": true,
                  "editable": true
                },
                {
                  "field": "ip_address",
                  "header": "IP Address",
                  "sortable": true
                },
                {
                  "field": "power",
                  "header": "Current Power",
                  "sortable": true,
                  "template": {
                    "type": "number",
                    "suffix": " W",
                    "decimals": 1
                  }
                },
                {
                  "field": "enabled",
                  "header": "Enabled",
                  "editable": true,
                  "template": {
                    "type": "switch",
                    "updateEndpoint": "/api/homewizard/devices/{device_id}/toggle"
                  }
                },
                {
                  "field": "actions",
                  "header": "Actions",
                  "template": {
                    "type": "actions",
                    "buttons": [
                      {
                        "icon": "pi-pencil",
                        "tooltip": "Edit Device",
                        "severity": "info",
                        "action": "dialog",
                        "endpoint": "/api/homewizard/devices/{device_id}",
                        "method": "PUT",
                        "title": "Edit Device",
                        "fields": [
                          {
                            "key": "device_name",
                            "label": "Device Name",
                            "component": "text",
                            "required": true
                          },
                          {
                            "key": "enabled",
                            "label": "Enabled",
                            "component": "switch"
                          }
                        ]
                      },
                      {
                        "icon": "pi-trash",
                        "tooltip": "Delete Device",
                        "severity": "danger",
                        "action": "endpoint",
                        "endpoint": "/api/homewizard/devices/{device_id}",
                        "method": "DELETE",
                        "confirm": "Delete device {device_name}?"
                      }
                    ]
                  }
                }
              ],
              "globalActions": [
                {
                  "id": "discover",
                  "label": "Discover Devices",
                  "icon": "pi-search",
                  "action": "endpoint",
                  "endpoint": "/api/homewizard/discover",
                  "method": "POST",
                  "confirm": "Scan network for HomeWizard devices?",
                  "successMessage": "Discovery started"
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```

---

## 🎯 How Row Actions (Edit/Delete) Work

### **In the Schema:**

```json
{
  "field": "actions",
  "header": "Actions",
  "template": {
    "type": "actions",
    "buttons": [
      {
        "icon": "pi-pencil",
        "tooltip": "Edit",
        "action": "dialog",            // Opens edit form
        "endpoint": "/api/homewizard/devices/{device_id}",
        "method": "PUT",
        "title": "Edit Device",
        "fields": [...]                // Form fields
      },
      {
        "icon": "pi-trash",
        "tooltip": "Delete",
        "action": "endpoint",          // Direct API call
        "endpoint": "/api/homewizard/devices/{device_id}",
        "method": "DELETE",
        "confirm": "Delete {device_name}?",
        "severity": "danger"
      }
    ]
  }
}
```

### **What Happens:**

1. **Edit Button Clicked:**
   - UniversalTable detects `action: "dialog"`
   - Fetches current data: `GET /api/homewizard/devices/123`
   - Opens dialog with form fields
   - User edits
   - Saves: `PUT /api/homewizard/devices/123`

2. **Delete Button Clicked:**
   - UniversalTable detects `action: "endpoint"`
   - Shows confirm dialog: "Delete Living Room Socket?"
   - User confirms
   - Calls: `DELETE /api/homewizard/devices/123`
   - Reloads table data

### **Placeholder Replacement:**

The table automatically replaces `{device_id}` and `{device_name}` with actual row data:

```javascript
// Row data:
{ device_id: 123, device_name: "Living Room Socket" }

// Endpoint template:
"/api/homewizard/devices/{device_id}"

// Becomes:
"/api/homewizard/devices/123"

// Confirm message:
"Delete {device_name}?"

// Becomes:
"Delete Living Room Socket?"
```

---

## 🔧 Backend Implementation

### **Module Routes: /modules/homewizard/routes/index.js**

```javascript
import express from 'express';
import settingsSchema from '../config/settings-schema.js';
import settingsService from '../../../core/services/settingsService.js';
import deviceService from '../services/deviceService.js';

const router = express.Router();

/**
 * GET /api/homewizard/settings/schema
 * Returns UI schema + current values
 */
router.get('/settings/schema', async (req, res) => {
  try {
    // Get current settings from database
    const currentSettings = await settingsService.getModuleSettings('homewizard');
    
    // Merge schema with current values
    const schemaWithValues = mergeSchemaWithValues(settingsSchema, currentSettings);
    
    res.json({
      success: true,
      module: {
        id: 'homewizard',
        name: 'HomeWizard Integration',
        icon: 'pi-bolt',
        color: '#f59e0b'
      },
      schema: schemaWithValues
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/settings
 * Update settings
 */
router.put('/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    
    // Validate and save
    await settingsService.updateModuleSettings('homewizard', settings);
    
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/devices
 * Get devices for table
 */
router.get('/devices', async (req, res) => {
  try {
    const devices = await deviceService.getAllDevices();
    
    res.json({
      success: true,
      data: devices
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/devices/:id
 * Get single device (for edit dialog)
 */
router.get('/devices/:id', async (req, res) => {
  try {
    const device = await deviceService.getDevice(req.params.id);
    
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    
    res.json(device);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id
 * Update device
 */
router.put('/devices/:id', async (req, res) => {
  try {
    await deviceService.updateDevice(req.params.id, req.body);
    
    res.json({ success: true, message: 'Device updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/homewizard/devices/:id
 * Delete device
 */
router.delete('/devices/:id', async (req, res) => {
  try {
    await deviceService.deleteDevice(req.params.id);
    
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/homewizard/devices/:id/toggle
 * Toggle device enabled status
 */
router.put('/devices/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    await deviceService.updateDevice(req.params.id, { enabled });
    
    res.json({ success: true, message: 'Device toggled' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/homewizard/discover
 * Discover devices
 */
router.post('/discover', async (req, res) => {
  try {
    // Start discovery in background
    deviceService.discoverDevices();
    
    res.json({ 
      success: true, 
      message: 'Discovery started. This may take a minute.' 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/homewizard/collector/status
 * Get collector status (for info panel)
 */
router.get('/collector/status', async (req, res) => {
  try {
    const status = await collectorService.getStatus();
    
    res.json({
      isRunning: status.running,
      deviceCount: status.deviceCount,
      lastCollectionTime: status.lastCollection,
      collectionsToday: status.collectionsToday
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function mergeSchemaWithValues(schema, currentSettings) {
  // Deep clone schema
  const merged = JSON.parse(JSON.stringify(schema));
  
  // Merge current values into fields
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

---

## 🎨 Frontend Component Usage

### **Settings.vue (Main Settings Page)**

```vue
<template>
  <div class="settings-page">
    <TabView>
      <!-- Core System Settings -->
      <TabPanel header="System" icon="pi-cog">
        <UniversalSettingsPanel module-id="core" />
      </TabPanel>

      <!-- Module Management -->
      <TabPanel header="Modules" icon="pi-box">
        <ModuleManagement />
      </TabPanel>

      <!-- Dynamic Module Tabs (loaded from API) -->
      <TabPanel 
        v-for="module in enabledModules" 
        :key="module.module_id"
        :header="module.module_name"
        :disabled="!module.enabled"
      >
        <UniversalSettingsPanel :module-id="module.module_id" />
      </TabPanel>

      <!-- User Management -->
      <TabPanel header="Users" icon="pi-users">
        <UniversalSettingsPanel module-id="users" />
      </TabPanel>
    </TabView>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import UniversalSettingsPanel from '@/components/settings/UniversalSettingsPanel.vue';
import ModuleManagement from '@/components/settings/ModuleManagement.vue';

const enabledModules = ref([]);

onMounted(async () => {
  // Load module list
  const { data } = await axios.get('/api/settings/modules');
  enabledModules.value = data.modules.filter(m => m.enabled && m.has_ui);
});
</script>
```

### **UniversalSettingsPanel.vue (Main Container)**

```vue
<template>
  <div class="universal-settings-panel">
    <div v-if="loading" class="loading-state">
      <ProgressSpinner />
    </div>

    <div v-else class="settings-content">
      <!-- Module Header -->
      <div v-if="moduleInfo" class="module-header">
        <i :class="`pi ${moduleInfo.icon}`" :style="{ color: moduleInfo.color }"></i>
        <div>
          <h2>{{ moduleInfo.name }}</h2>
          <p>{{ moduleInfo.description }}</p>
        </div>
      </div>

      <!-- Render Groups -->
      <Accordion :multiple="true" :activeIndex="[0]">
        <AccordionTab 
          v-for="group in schema.groups" 
          :key="group.id"
          :header="group.label"
        >
          <template #header>
            <i :class="`pi ${group.icon}`"></i>
            <span>{{ group.label }}</span>
          </template>

          <!-- Render Sections -->
          <div 
            v-for="section in group.sections" 
            :key="section.id"
            class="section"
          >
            <h4 v-if="section.label">{{ section.label }}</h4>
            <p v-if="section.description">{{ section.description }}</p>

            <!-- Fields Section -->
            <div v-if="section.fields" class="fields-container">
              <UniversalField
                v-for="field in section.fields"
                :key="field.key"
                :field="field"
                v-model="formData[field.key]"
                @update:modelValue="markChanged(field.key)"
              />
            </div>

            <!-- Table Section -->
            <UniversalTable
              v-else-if="section.component === 'table'"
              :config="section.data"
              :module-id="moduleId"
            />

            <!-- Info Panel Section -->
            <UniversalInfoPanel
              v-else-if="section.component === 'info-panel'"
              :config="section.data"
            />

            <!-- Card Grid Section -->
            <UniversalCardGrid
              v-else-if="section.component === 'card-grid'"
              :config="section.data"
            />
          </div>
        </AccordionTab>
      </Accordion>

      <!-- Save/Reset Buttons -->
      <div class="actions">
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
          @click="loadSchema"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import axios from 'axios';
import { useToast } from 'primevue/usetoast';

const props = defineProps({
  moduleId: {
    type: String,
    required: true
  }
});

const toast = useToast();
const loading = ref(true);
const saving = ref(false);
const schema = ref({ groups: [] });
const moduleInfo = ref(null);
const formData = reactive({});
const originalData = reactive({});
const changedFields = reactive(new Set());

const hasChanges = computed(() => changedFields.size > 0);

async function loadSchema() {
  loading.value = true;
  try {
    const { data } = await axios.get(`/api/${props.moduleId}/settings/schema`);
    
    schema.value = data.schema;
    moduleInfo.value = data.module;
    
    // Populate form data with current values
    data.schema.groups.forEach(group => {
      group.sections?.forEach(section => {
        section.fields?.forEach(field => {
          formData[field.key] = field.value;
          originalData[field.key] = field.value;
        });
      });
    });
    
    changedFields.clear();
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

function markChanged(key) {
  if (formData[key] !== originalData[key]) {
    changedFields.add(key);
  } else {
    changedFields.delete(key);
  }
}

async function saveSettings() {
  saving.value = true;
  try {
    const changedSettings = {};
    changedFields.forEach(key => {
      changedSettings[key] = formData[key];
    });
    
    await axios.put(`/api/${props.moduleId}/settings`, {
      settings: changedSettings
    });
    
    // Update original data
    Object.assign(originalData, formData);
    changedFields.clear();
    
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
      detail: error.response?.data?.error || 'Failed to save settings',
      life: 3000
    });
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadSchema();
});
</script>
```

---

## ✅ Summary

### **How Data Loads:**

1. **On Tab Click** → Component mounts
2. **API Call** → `GET /api/{moduleId}/settings/schema`
3. **Response** → Schema + Current Values
4. **Render** → Universal components display everything
5. **Edit** → User changes field
6. **Save** → `PUT /api/{moduleId}/settings`

### **Row Actions (Edit/Delete):**

- **Edit**: Opens dialog → Loads data → User edits → Saves
- **Delete**: Shows confirm → User confirms → Deletes → Reloads table
- **Toggle**: Immediately calls API → Updates database

### **Key Benefits:**

✅ **Lazy Loading** - Only loads data for active tab
✅ **Single API Call** - Gets schema + values together
✅ **Backend-Driven** - Frontend has zero hardcoded logic
✅ **Universal** - Same components work for all modules

This architecture is clean, efficient, and fully backend-driven! 🎯
