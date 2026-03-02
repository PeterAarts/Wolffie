<template>
  <div class="universal-settings-panel text-sm">
    <div v-if="loading" class="loading-container">
      <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="4" />
      <p class="text-600 mt-3">Laden instellingen...</p>
    </div>

    <div v-else-if="error" class="error-container">
      <Message severity="error" :closable="false">{{ error }}</Message>
      <Button label="Opnieuw proberen" icon="pi pi-refresh" @click="loadSchema" class="mt-3" />
    </div>

    <div v-else class="settings-content">
      
      <div v-if="schema.groups" class="groups-container">
        <div v-for="(group, gIdx) in schema.groups" :key="gIdx" class="settings-group mb-3">
          <h3 class="text-md font-medium mb-4">{{ group.title }}</h3>
          
          <div v-for="(section, sIdx) in group.sections" :key="sIdx" class="settings-section   ">
              <div v-if="section.title" class="section-header ">
                <h4 class=" font-semibold m-0">{{ section.title }}</h4>
                <p v-if="section.description" class="text-gray-400 text-xs font-normal mt-1 mb-0">{{ section.description }}</p>
              </div>
              <div v-if="section.fields?.length" class="grid bg-gray-100 p-4 gap-4 fields-container">
                <div 
                  v-for="field in section.fields" 
                  :key="field.key" 
                  :class="getFieldColumnClass(field)"
                >
                  <UniversalField 
                    :field="field" 
                    v-model="values[field.key]" 
                    @update:modelValue="handleValueChange"
                  />
                </div>
              </div>

              <UniversalTable v-else-if="section.component === 'table'" :config="section" :moduleId="moduleId" />
              <UniversalInfoPanel v-else-if="section.component === 'info-panel'" :config="section" :moduleId="moduleId" />
              <UniversalCardGrid v-else-if="section.component === 'card-grid'" :config="section" :moduleId="moduleId" />
            </div>
  
        </div>
      </div>

      <div v-else-if="schema.properties" class="grid">
        <div 
          v-for="(fieldConfig, key) in sortedProperties" 
          :key="key" 
          class="col-12"
          :class="getFieldColumnClass(fieldConfig)"
        >
          <UniversalField 
            :field="mapAlphaField(key, fieldConfig)" 
            v-model="values[key]"
            @update:modelValue="handleValueChange"
          />
        </div>
      </div>

      <div v-if="schema.globalActions?.length" class="global-actions mt-5">
        <Divider />
        <h4 class="mb-3">Acties</h4>
        <div class="flex flex-wrap gap-3">
          <Button 
            v-for="action in schema.globalActions" 
            :key="action.label"
            :label="action.label"
            :icon="`pi ${action.icon || 'pi-bolt'}`"
            @click="handleAction(action)"
            severity="secondary"
            outlined
          />
        </div>
      </div>
    </div>

    <div class="" :class="{ 'save-bar-visible': hasChanges|| true }">
      <div class="save-bar-content">
        <div class="save-bar-info"></div>
        <div class="save-bar-actions">
          <Button label="Annuleren" class="p-button-text p-button-plain mr-3" @click="resetChanges" />
          <Button label="Opslaan" icon="pi pi-check" :loading="saving" @click="saveSettings" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import apiClient from '@/services/api'; //
import { useToastStore } from '@/stores/toast';
const toast = useToastStore();

// Imports
import UniversalField from './Universalfield.vue';
import UniversalTable from './UniversalTable.vue';
import UniversalInfoPanel from './UniversalInfoPanel.vue';
import UniversalCardGrid from './UniversalCardGrid.vue';

const props = defineProps({
  moduleId: { type: String, required: true }
});

const schema = ref({});
const values = ref({});
const originalValues = ref({});
const loading = ref(true);
const saving = ref(false);
const hasChanges = ref(false);
const error = ref(null);

// Hulpmiddelen
function getFieldColumnClass(field) {

  const cols = field.cols || 12; 
  return `col-12 md:col-${cols}`;
}

function mapAlphaField(key, config) {
  return {
    key: key,
    label: config.title,
    description: config.description,
    component: config.ui?.widget || 'text',
    placeholder: config.ui?.placeholder,
    required: schema.value.required?.includes(key),
    editable: true,
    suffix: config.ui?.suffix
  };
}

const sortedProperties = computed(() => {
  if (!schema.value.properties) return {};
  return Object.entries(schema.value.properties)
    .sort(([, a], [, b]) => (a.ui?.order || 0) - (b.ui?.order || 0))
    .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {});
});

// Logica voor laden
async function loadSchema() {
  loading.value = true;
  try {
    // Gebruik de dedicated routes voor core en users, anders de generieke module route
    const endpoint = (props.moduleId === 'core' || props.moduleId === 'users')
      ? `/settings/${props.moduleId}`
      : `/settings/module/${props.moduleId}`;

    const { data } = await apiClient.get(endpoint);
    schema.value = data.schema || {};
    values.value = data.values || {};
    originalValues.value = JSON.parse(JSON.stringify(values.value));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
async function saveSettings() {
  saving.value = true;
  try {
    const endpoint = ['core', 'users'].includes(props.moduleId) 
      ? `/settings/${props.moduleId}` 
      : `/settings/module/${props.moduleId}`;

    await apiClient.post(endpoint, values.value);
    originalValues.value = JSON.parse(JSON.stringify(values.value));
    hasChanges.value = false;
    toast.add({ severity: 'success', summary: 'Opgeslagen', detail: 'Instellingen bijgewerkt' });
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Fout', detail: err.message });
  } finally {
    saving.value = false;
  }
}

function handleValueChange() {
  hasChanges.value = JSON.stringify(values.value) !== JSON.stringify(originalValues.value);
}

function resetChanges() {
  values.value = JSON.parse(JSON.stringify(originalValues.value));
  hasChanges.value = false;
}

async function handleAction(action) {
  try {
    const res = await apiClient({ method: action.method || 'POST', url: action.endpoint, data: values.value });
    if (res.data.success) toast.add({ severity: 'success', summary: 'Klaar', detail: action.label });
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Fout', detail: err.message });
  }
}

onMounted(loadSchema);
</script>

<style scoped>
/* Hier komen jouw originele 400+ regels CSS, inclusief .save-bar, .loading-container, etc. */
.universal-settings-panel   {padding: 0rem; }
.group-title                {border-bottom: 2px solid #eee; padding-bottom: 0.5rem; font-weight: 600; }
.save-bar                   {position: sticky;bottom: 0;background: white;padding: 1rem 1.5rem;z-index: 100;}
.save-bar-visible           {transform: translateY(0); }
.save-bar-content           {display: flex; align-items: center; justify-content: space-between; max-width: 1900px; margin: 0 auto; }

.universal-settings-panel   {position: relative;min-height: 400px;}

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
.settings-section           {margin-bottom: 1rem;}
.section-with-border        {padding-bottom: 2rem;border-bottom: 1px solid #e5e7eb;}
.section-with-border:last-child 
                            {border-bottom: none;padding-bottom: 0;}
.section-header             {margin-bottom: .5rem;}
.section-title              {margin: 0 0 0.5rem 0;font-size: 1.1rem;color: #374151;font-weight: 500;}
.section-description        {margin: 0;color: #6b7280;font-size: 0.95rem;line-height: 1.5;}
/* Fields Container */
.fields-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

@media (min-width: 768px) {
  .fields-container     {grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));}
}

/* Global Actions */
.global-actions         {margin-top: 2rem;}
.global-actions h4      {margin: 1rem 0;color: #374151;}
.actions-grid           {display: flex;flex-wrap: wrap;gap: 0.75rem;}

/* Save Bar (Sticky) */
.save-bar               {position: sticky;bottom: 0;left: 0;right: 0;padding: 1rem 1.5rem;transform: translateY(100%);transition: transform 0.3s ease;z-index: 100;}
.save-bar-visible       {transform: translateY(0);}
.save-bar-content       {display: flex;align-items: center;justify-content: space-between;max-width: 1200px;margin: 0 auto;}
.save-bar-info          {display: flex;align-items: center;gap: 0.75rem;color: #92400e;font-weight: 600;}
.save-bar-info i        {font-size: 1.25rem;}
.save-bar-actions       {display: flex;gap: 0.75rem;}
/* Nested Tabs */
.nested-tabs            {margin-top: 1rem;}
/* HTML Content */
.html-content           {padding: 1rem;background: #f9fafb;border-radius: 8px;border: 1px solid #e5e7eb;}
.html-content :deep(h1),
.html-content :deep(h2),
.html-content :deep(h3) {margin-top: 0;}
.group-title            {border-bottom: 1px solid #eee; padding-bottom: 0.5rem; font-weight: 600; }
/* Responsive */
@media (max-width: 768px) {
  .module-header    {flex-direction: column;text-align: center;}
  .save-bar-content {flex-direction: column;gap: 1rem;align-items: stretch;}
  .save-bar-actions {flex-direction: column;}
}
.grid                   {display:flex ;grid-template-columns: auto auto auto auto;}
.p-tabview-tablist-item-active 
                        {background-color: #f59e0b !important; color: white !important;border-color:#92400e;border-width: 3px;}
.field-label            {font-weight: 400;color: #585858;font-size: 0.9rem;}
</style>