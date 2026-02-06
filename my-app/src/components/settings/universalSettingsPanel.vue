<template>
  <div class="universal-settings-panel">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" />
      <p class="text-600 mt-3">Loading settings...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <Message severity="error" :closable="false">
        <template #default>
          <div class="flex flex-column gap-2">
            <span class="font-bold">Failed to load settings</span>
            <span>{{ error }}</span>
          </div>
        </template>
      </Message>
      <Button 
        label="Retry" 
        icon="pi pi-refresh" 
        @click="loadSchema"
        class="mt-3"
      />
    </div>

    <!-- Settings Content -->
    <div v-else class="settings-content">
      <!-- Module Header (if this is a module) -->
      <div v-if="moduleInfo" class="module-header">
        <div class="module-icon" :style="{ backgroundColor: moduleInfo.color + '20' }">
          <i :class="`pi ${moduleInfo.icon}`" :style="{ color: moduleInfo.color }"></i>
        </div>
        <div class="module-info">
          <h2>{{ moduleInfo.name }}</h2>
          <p v-if="moduleInfo.description">{{ moduleInfo.description }}</p>
          <div v-if="moduleInfo.version" class="module-meta">
            <Tag :value="`v${moduleInfo.version}`" severity="info" />
            <span v-if="moduleInfo.author" class="text-sm text-600">
              by {{ moduleInfo.author }}
            </span>
          </div>
        </div>
      </div>

      <!-- Settings Groups -->
      <Accordion 
        :multiple="true" 
        :activeIndex="defaultActiveIndexes"
        class="settings-accordion"
      >
        <AccordionTab 
          v-for="group in schema.groups" 
          :key="group.id"
        >
          <!-- Group Header -->
          <template #header>
            <div class="flex align-items-center gap-2">
              <i v-if="group.icon" :class="`pi ${group.icon}`"></i>
              <span class="font-semibold">{{ group.label }}</span>
              <Tag 
                v-if="getGroupChangedCount(group) > 0" 
                :value="`${getGroupChangedCount(group)} changed`"
                severity="warning"
                class="ml-2"
              />
            </div>
          </template>

          <!-- Group Description -->
          <p v-if="group.description" class="group-description">
            {{ group.description }}
          </p>

          <!-- Sections within Group -->
          <div 
            v-for="section in group.sections" 
            :key="section.id"
            class="settings-section"
            :class="{ 'section-with-border': section.label }"
          >
            <!-- Section Header -->
            <div v-if="section.label" class="section-header">
              <h4 class="section-title">{{ section.label }}</h4>
              <p v-if="section.description" class="section-description">
                {{ section.description }}
              </p>
            </div>

            <!-- FIELDS SECTION (Form Fields) -->
            <div v-if="section.fields" class="fields-container">
              <UniversalField
                v-for="field in section.fields"
                :key="field.key"
                :field="field"
                v-model="formData[field.key]"
                :error="validationErrors[field.key]"
                :disabled="saving"
                @update:modelValue="markChanged(field.key)"
              />
            </div>

            <!-- TABLE SECTION -->
            <UniversalTable
              v-else-if="section.component === 'table'"
              :config="section.data"
              :module-id="moduleId"
              ref="tables"
            />

            <!-- INFO PANEL SECTION -->
            <UniversalInfoPanel
              v-else-if="section.component === 'info-panel'"
              :config="section.data"
              ref="infoPanels"
            />

            <!-- CARD GRID SECTION -->
            <UniversalCardGrid
              v-else-if="section.component === 'card-grid'"
              :config="section.data"
              ref="cardGrids"
            />

            <!-- TABS SECTION (Nested Tabs) -->
            <TabView
              v-else-if="section.component === 'tabs'"
              class="nested-tabs"
            >
              <TabPanel
                v-for="tab in section.tabs"
                :key="tab.id"
                :header="tab.label"
              >
                <!-- Recursive rendering for tab content -->
                <div v-if="tab.fields" class="fields-container">
                  <UniversalField
                    v-for="field in tab.fields"
                    :key="field.key"
                    :field="field"
                    v-model="formData[field.key]"
                    :error="validationErrors[field.key]"
                    :disabled="saving"
                    @update:modelValue="markChanged(field.key)"
                  />
                </div>
              </TabPanel>
            </TabView>

            <!-- CUSTOM HTML (Rich Content) -->
            <div 
              v-else-if="section.component === 'html'"
              class="html-content"
              v-html="section.content"
            ></div>

            <!-- DIVIDER -->
            <Divider v-else-if="section.component === 'divider'" />
          </div>
        </AccordionTab>
      </Accordion>

      <!-- Global Actions (if defined in schema) -->
      <div v-if="schema.actions && schema.actions.length > 0" class="global-actions">
        <Divider />
        <h4>Actions</h4>
        <div class="actions-grid">
          <Button
            v-for="action in schema.actions"
            :key="action.id"
            :label="action.label"
            :icon="action.icon"
            :severity="action.severity || 'secondary'"
            @click="executeGlobalAction(action)"
            :loading="actionLoading[action.id]"
          />
        </div>
      </div>

      <!-- Save/Reset Bar (Sticky) -->
      <div v-if="hasEditableFields" class="save-bar" :class="{ 'save-bar-visible': hasChanges }">
        <div class="save-bar-content">
          <div class="save-bar-info">
            <i class="pi pi-exclamation-circle"></i>
            <span>{{ changedFields.size }} unsaved change{{ changedFields.size !== 1 ? 's' : '' }}</span>
          </div>
          <div class="save-bar-actions">
            <Button 
              label="Reset" 
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              @click="resetChanges"
              :disabled="saving"
            />
            <Button 
              label="Save Changes" 
              icon="pi pi-save"
              @click="saveSettings"
              :loading="saving"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Confirm Dialog -->
    <ConfirmDialog />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import apiClient from '@/services/api';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';

// PrimeVue Components
import Accordion from 'primevue/accordion';
import AccordionTab from 'primevue/accordiontab';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import Divider from 'primevue/divider';
import ProgressSpinner from 'primevue/progressspinner';
import ConfirmDialog from 'primevue/confirmdialog';

// Universal Components
import UniversalField from './UniversalField.vue';
import UniversalTable from './UniversalTable.vue';
import UniversalInfoPanel from './UniversalInfoPanel.vue';
import UniversalCardGrid from './UniversalCardGrid.vue';

const props = defineProps({
  moduleId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['loaded', 'saved', 'error']);

const toast = useToast();
const confirm = useConfirm();

// State
const loading = ref(true);
const saving = ref(false);
const error = ref(null);
const schema = ref({ groups: [], actions: [] });
const moduleInfo = ref(null);
const formData = reactive({});
const originalData = reactive({});
const changedFields = reactive(new Set());
const validationErrors = reactive({});
const actionLoading = reactive({});

// Refs to child components
const tables = ref([]);
const infoPanels = ref([]);
const cardGrids = ref([]);

// Computed
const hasChanges = computed(() => changedFields.size > 0);

const hasEditableFields = computed(() => {
  return schema.value.groups.some(group => 
    group.sections?.some(section => 
      section.fields?.some(field => field.editable)
    )
  );
});

const defaultActiveIndexes = computed(() => {
  // Open first group by default
  return schema.value.groups.length > 0 ? [0] : [];
});

// Load schema from backend
async function loadSchema() {
  loading.value = true;
  error.value = null;

  try {
    const endpoint = props.moduleId === 'core' 
      ? '/api/settings/core/schema'
      : `/api/${props.moduleId}/settings/schema`;

    const { data } = await apiClient.get(endpoint);
    
    schema.value = data.schema || { groups: [], actions: [] };
    moduleInfo.value = data.module || null;

    // Populate form data with current values
    populateFormData(schema.value);

    // Clear changed fields
    changedFields.clear();
    Object.keys(validationErrors).forEach(key => delete validationErrors[key]);

    emit('loaded', { schema: schema.value, module: moduleInfo.value });
  } catch (err) {
    error.value = err.response?.data?.error || err.message || 'Failed to load settings';
    console.error('Error loading settings schema:', err);
    
    emit('error', error.value);
    
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.value,
      life: 5000
    });
  } finally {
    loading.value = false;
  }
}

// Populate form data from schema
function populateFormData(schemaData) {
  schemaData.groups.forEach(group => {
    group.sections?.forEach(section => {
      // Handle regular fields
      if (section.fields) {
        section.fields.forEach(field => {
          const value = field.value !== undefined ? field.value : field.defaultValue;
          formData[field.key] = value;
          originalData[field.key] = value;
        });
      }

      // Handle nested tabs
      if (section.tabs) {
        section.tabs.forEach(tab => {
          tab.fields?.forEach(field => {
            const value = field.value !== undefined ? field.value : field.defaultValue;
            formData[field.key] = value;
            originalData[field.key] = value;
          });
        });
      }
    });
  });
}

// Mark field as changed
function markChanged(key) {
  if (formData[key] !== originalData[key]) {
    changedFields.add(key);
  } else {
    changedFields.delete(key);
  }
  
  // Clear validation error when field changes
  if (validationErrors[key]) {
    delete validationErrors[key];
  }
}

// Get count of changed fields in a group
function getGroupChangedCount(group) {
  let count = 0;
  
  group.sections?.forEach(section => {
    section.fields?.forEach(field => {
      if (changedFields.has(field.key)) {
        count++;
      }
    });
    
    section.tabs?.forEach(tab => {
      tab.fields?.forEach(field => {
        if (changedFields.has(field.key)) {
          count++;
        }
      });
    });
  });
  
  return count;
}

// Validate form data
function validateFormData() {
  let isValid = true;
  Object.keys(validationErrors).forEach(key => delete validationErrors[key]);

  schema.value.groups.forEach(group => {
    group.sections?.forEach(section => {
      const fields = section.fields || [];
      const tabFields = section.tabs?.flatMap(tab => tab.fields || []) || [];
      const allFields = [...fields, ...tabFields];

      allFields.forEach(field => {
        // Check required fields
        if (field.required && changedFields.has(field.key)) {
          const value = formData[field.key];
          if (value === null || value === undefined || value === '') {
            validationErrors[field.key] = `${field.label} is required`;
            isValid = false;
          }
        }

        // Validate number fields
        if (field.type === 'number' && changedFields.has(field.key)) {
          const value = formData[field.key];
          if (value !== null && value !== undefined) {
            if (field.validation?.min !== undefined && value < field.validation.min) {
              validationErrors[field.key] = `Minimum value is ${field.validation.min}`;
              isValid = false;
            }
            if (field.validation?.max !== undefined && value > field.validation.max) {
              validationErrors[field.key] = `Maximum value is ${field.validation.max}`;
              isValid = false;
            }
          }
        }

        // Validate pattern (regex)
        if (field.validation?.pattern && changedFields.has(field.key)) {
          const value = formData[field.key];
          if (value) {
            const regex = new RegExp(field.validation.pattern);
            if (!regex.test(value)) {
              validationErrors[field.key] = field.validation.message || 'Invalid format';
              isValid = false;
            }
          }
        }
      });
    });
  });

  return isValid;
}

// Save settings to backend
async function saveSettings() {
  // Validate first
  if (!validateFormData()) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'Please fix the errors before saving',
      life: 3000
    });
    return;
  }

  saving.value = true;

  try {
    // Collect only changed settings
    const changedSettings = {};
    changedFields.forEach(key => {
      changedSettings[key] = formData[key];
    });

    const endpoint = props.moduleId === 'core' 
      ? '/api/settings/core'
      : `/api/${props.moduleId}/settings`;

    await apiClient.put(endpoint, {
      settings: changedSettings
    });

    // Update original data
    changedFields.forEach(key => {
      originalData[key] = formData[key];
    });
    changedFields.clear();

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Settings saved successfully',
      life: 3000
    });

    emit('saved', changedSettings);
  } catch (err) {
    const errorMessage = err.response?.data?.error || 'Failed to save settings';
    
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: errorMessage,
      life: 5000
    });

    // Handle field-specific validation errors from backend
    if (err.response?.data?.errors) {
      Object.assign(validationErrors, err.response.data.errors);
    }
  } finally {
    saving.value = false;
  }
}

// Reset changes
function resetChanges() {
  confirm.require({
    message: 'Discard all unsaved changes?',
    header: 'Confirm Reset',
    icon: 'pi pi-exclamation-triangle',
    accept: () => {
      // Revert to original values
      changedFields.forEach(key => {
        formData[key] = originalData[key];
      });
      changedFields.clear();
      Object.keys(validationErrors).forEach(key => delete validationErrors[key]);

      toast.add({
        severity: 'info',
        summary: 'Reset',
        detail: 'Changes discarded',
        life: 2000
      });
    }
  });
}

// Execute global action
async function executeGlobalAction(action) {
  const execute = async () => {
    actionLoading[action.id] = true;

    try {
      await apiClient({
        method: action.method || 'POST',
        url: action.endpoint,
        data: action.data || {}
      });

      toast.add({
        severity: 'success',
        summary: 'Success',
        detail: action.successMessage || 'Action completed successfully',
        life: 3000
      });

      // Reload if specified
      if (action.reloadAfter !== false) {
        await loadSchema();
      }

      // Reload child components
      if (action.reloadTables !== false) {
        tables.value.forEach(table => table?.reload());
      }
      if (action.reloadInfoPanels !== false) {
        infoPanels.value.forEach(panel => panel?.reload());
      }
      if (action.reloadCardGrids !== false) {
        cardGrids.value.forEach(grid => grid?.reload());
      }
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: 'Error',
        detail: err.response?.data?.error || 'Action failed',
        life: 5000
      });
    } finally {
      actionLoading[action.id] = false;
    }
  };

  // Show confirmation if required
  if (action.confirm) {
    confirm.require({
      message: action.confirm,
      header: 'Confirmation',
      icon: 'pi pi-exclamation-triangle',
      accept: execute
    });
  } else {
    await execute();
  }
}

// Reload all dynamic content
function reloadAll() {
  tables.value.forEach(table => table?.reload());
  infoPanels.value.forEach(panel => panel?.reload());
  cardGrids.value.forEach(grid => grid?.reload());
}

// Lifecycle
onMounted(() => {
  loadSchema();
});

// Expose methods for parent components
defineExpose({
  reload: loadSchema,
  reloadTables: () => tables.value.forEach(t => t?.reload()),
  reloadInfoPanels: () => infoPanels.value.forEach(p => p?.reload()),
  reloadCardGrids: () => cardGrids.value.forEach(g => g?.reload()),
  reloadAll,
  hasChanges,
  save: saveSettings,
  reset: resetChanges
});
</script>

<style scoped>
.universal-settings-panel {
  position: relative;
  min-height: 400px;
}

/* Loading State */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

/* Error State */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 2rem;
}

/* Module Header */
.module-header {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.module-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  flex-shrink: 0;
}

.module-icon i {
  font-size: 2rem;
}

.module-info {
  flex: 1;
}

.module-info h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
  color: #111827;
}

.module-info p {
  margin: 0 0 0.75rem 0;
  color: #6b7280;
  line-height: 1.5;
}

.module-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Settings Accordion */
.settings-accordion {
  margin-bottom: 2rem;
}

.group-description {
  color: #6b7280;
  margin: 0 0 1.5rem 0;
  line-height: 1.6;
}

/* Sections */
.settings-section {
  margin-bottom: 2rem;
}

.section-with-border {
  padding-bottom: 2rem;
  border-bottom: 1px solid #e5e7eb;
}

.section-with-border:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.section-header {
  margin-bottom: 1.5rem;
}

.section-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  color: #374151;
  font-weight: 600;
}

.section-description {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  line-height: 1.5;
}

/* Fields Container */
.fields-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .fields-container {
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }
}

/* Global Actions */
.global-actions {
  margin-top: 2rem;
}

.global-actions h4 {
  margin: 1rem 0;
  color: #374151;
}

.actions-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

/* Save Bar (Sticky) */
.save-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  border-top: 2px solid #f59e0b;
  padding: 1rem 1.5rem;
  box-shadow: 0 -4px 6px -1px rgb(0 0 0 / 0.1);
  transform: translateY(100%);
  transition: transform 0.3s ease;
  z-index: 100;
}

.save-bar-visible {
  transform: translateY(0);
}

.save-bar-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1200px;
  margin: 0 auto;
}

.save-bar-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #92400e;
  font-weight: 600;
}

.save-bar-info i {
  font-size: 1.25rem;
}

.save-bar-actions {
  display: flex;
  gap: 0.75rem;
}

/* Nested Tabs */
.nested-tabs {
  margin-top: 1rem;
}

/* HTML Content */
.html-content {
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.html-content :deep(h1),
.html-content :deep(h2),
.html-content :deep(h3) {
  margin-top: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .module-header {
    flex-direction: column;
    text-align: center;
  }

  .save-bar-content {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .save-bar-actions {
    flex-direction: column;
  }
}
</style>