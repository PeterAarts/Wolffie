<template>
  <div class="universal-table">
    <!-- Toolbar with Global Actions -->
    <div v-if="config.globalActions || config.filters" class="table-toolbar">
      <div class="toolbar-left">
        <Button
          v-for="action in config.globalActions"
          :key="action.label"
          :label="action.label"
          :icon="action.icon"
          :severity="action.severity || 'secondary'"
          @click="executeGlobalAction(action)"
          :loading="actionLoading[action.id]"
        />
      </div>

      <!-- Filters -->
      <div v-if="config.filters" class="toolbar-right">
        <Dropdown
          v-for="filter in config.filters"
          :key="filter.field"
          v-model="filterValues[filter.field]"
          :options="filter.options"
          :optionLabel="filter.optionLabel || 'label'"
          :optionValue="filter.optionValue || 'value'"
          :placeholder="filter.placeholder || 'Filter...'"
          @change="applyFilters"
          class="filter-dropdown"
        />
      </div>
    </div>

    <!-- DataTable -->
    <DataTable
      :value="tableData"
      :dataKey="config.dataKey"
      :loading="loading"
      :paginator="config.paginator !== false"
      :rows="config.rows || 10"
      :rowsPerPageOptions="[5, 10, 20, 50]"
      :globalFilterFields="globalFilterFields"
      v-model:filters="filters"
      filterDisplay="row"
      :sortField="config.defaultSortField"
      :sortOrder="config.defaultSortOrder || 1"
      stripedRows
      class="p-datatable-sm"
    >
      <!-- Dynamic Columns -->
      <Column
        v-for="col in config.columns"
        :key="col.field"
        :field="col.field"
        :header="col.header"
        :sortable="col.sortable !== false"
        :style="col.width ? { width: col.width } : {}"
      >
        <!-- Header Template (for filters) -->
        <template v-if="col.filter" #filter="{ filterModel, filterCallback }">
          <InputText
            v-model="filterModel.value"
            @input="filterCallback()"
            placeholder="Search..."
            class="p-column-filter"
          />
        </template>

        <!-- Body Template -->
        <template #body="{ data, index }">
          <!-- Simple Field -->
          <span v-if="!col.template">
            {{ data[col.field] }}
          </span>

          <!-- Icon + Text Template -->
          <div v-else-if="col.template.type === 'icon-text'" class="flex align-items-center gap-2">
            <i :class="`pi ${getIcon(col.template.icon, data)}`"></i>
            <div class="flex flex-column">
              <span class="font-semibold">{{ data[col.template.text] }}</span>
              <span v-if="col.template.subtext" class="text-sm text-600">
                {{ data[col.template.subtext] }}
              </span>
            </div>
          </div>

          <!-- Badge Template -->
          <Tag
            v-else-if="col.template.type === 'badge'"
            :value="getBadgeLabel(col.template, data[col.field])"
            :severity="getBadgeSeverity(col.template, data[col.field])"
          />

          <!-- Switch Template (Inline Toggle) -->
          <InputSwitch
            v-else-if="col.template.type === 'switch'"
            :modelValue="data[col.field]"
            @update:modelValue="updateField(data, col.field, $event, col.template.updateEndpoint)"
            :disabled="!col.editable"
          />

          <!-- Boolean Icon Template -->
          <div v-else-if="col.template.type === 'boolean-icon'">
            <i
              :class="`pi ${data[col.field] ? col.template.trueIcon : col.template.falseIcon}`"
              :style="{ color: data[col.field] ? col.template.trueColor : col.template.falseColor }"
            ></i>
          </div>

          <!-- Status Dot Template -->
          <div v-else-if="col.template.type === 'status-dot'" class="flex align-items-center gap-2">
            <span
              class="status-dot"
              :style="{ backgroundColor: data[col.field] ? col.template.trueColor : col.template.falseColor }"
            ></span>
            <span>{{ data[col.field] ? col.template.trueLabel : col.template.falseLabel }}</span>
          </div>

          <!-- Number Template -->
          <span v-else-if="col.template.type === 'number'">
            {{ formatNumber(data[col.field], col.template) }}
          </span>

          <!-- Date Template -->
          <span v-else-if="col.template.type === 'date'">
            {{ formatDate(data[col.field], col.template.format) }}
          </span>

          <!-- Actions Template (Edit/Delete buttons) -->
          <div v-else-if="col.template.type === 'actions'" class="flex gap-1">
            <Button
              v-for="button in getVisibleButtons(col.template.buttons, data)"
              :key="button.icon"
              :icon="button.icon"
              :severity="button.severity || 'secondary'"
              :tooltip="button.tooltip"
              size="small"
              text
              rounded
              @click="executeRowAction(button, data)"
            />
          </div>

          <!-- Editable Field (Inline Editing) -->
          <InputText
            v-else-if="col.editable && !col.template"
            :modelValue="data[col.field]"
            @blur="updateField(data, col.field, $event.target.value)"
            class="p-inputtext-sm"
          />
        </template>
      </Column>

      <!-- Empty State -->
      <template #empty>
        <div class="text-center p-4 text-600">
          No data available
        </div>
      </template>
    </DataTable>

    <!-- Confirm Dialog -->
    <ConfirmDialog />

    <!-- Dynamic Form Dialog -->
    <Dialog
      v-model:visible="dialogVisible"
      :header="dialogConfig.title"
      :modal="true"
      :style="{ width: '50vw' }"
    >
      <div class="flex flex-column gap-3">
        <UniversalField
          v-for="field in dialogConfig.fields"
          :key="field.key"
          :field="field"
          v-model="dialogData[field.key]"
        />
      </div>

      <template #footer>
        <Button label="Cancel" @click="dialogVisible = false" severity="secondary" />
        <Button label="Save" @click="saveDialog" :loading="dialogLoading" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import axios from 'axios';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputSwitch from 'primevue/inputswitch';
import Dropdown from 'primevue/dropdown';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import ConfirmDialog from 'primevue/confirmdialog';
import UniversalField from './UniversalField.vue';


const props = defineProps({
  config: {
    type: Object,
    required: true
  },
  moduleId: {
    type: String,
    default: null
  }
});

const toast = useToast();
const confirm = useConfirm();

const tableData = ref([]);
const loading = ref(false);
const actionLoading = reactive({});
const filterValues = reactive({});
const filters = ref({});
const dialogVisible = ref(false);
const dialogConfig = ref({ fields: [] });
const dialogData = reactive({});
const dialogLoading = ref(false);
const currentRowData = ref(null);

const globalFilterFields = computed(() => {
  return props.config.columns
    .filter(col => col.filter)
    .map(col => col.field);
});

// Load table data
async function loadData() {
  loading.value = true;
  try {
    const response = await axios.get(props.config.endpoint);
    tableData.value = response.data.data || response.data[Object.keys(response.data)[0]] || response.data;
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load data',
      life: 3000
    });
  } finally {
    loading.value = false;
  }
}

// Execute global action (toolbar buttons)
async function executeGlobalAction(action) {
  if (action.action === 'reload') {
    await loadData();
    return;
  }

  if (action.confirm) {
    confirm.require({
      message: action.confirm,
      header: 'Confirmation',
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        await performAction(action);
      }
    });
  } else {
    await performAction(action);
  }
}

// Execute row action (edit/delete buttons)
async function executeRowAction(button, rowData) {
  currentRowData.value = rowData;

  // Navigate action
  if (button.action === 'navigate') {
    const route = replacePlaceholders(button.route, rowData);
    window.location.href = route;
    return;
  }

  // Dialog action (edit form)
  if (button.action === 'dialog') {
    await openDialog(button, rowData);
    return;
  }

  // Endpoint action (delete, etc.)
  if (button.action === 'endpoint') {
    const confirmMessage = replacePlaceholders(button.confirm, rowData);
    
    if (button.confirm) {
      confirm.require({
        message: confirmMessage,
        header: 'Confirmation',
        icon: 'pi pi-exclamation-triangle',
        accept: async () => {
          await performRowAction(button, rowData);
        }
      });
    } else {
      await performRowAction(button, rowData);
    }
  }
}

// Open dialog for edit/add
async function openDialog(button, rowData = null) {
  try {
    // Get form configuration
    const formName = button.form;
    const endpoint = replacePlaceholders(button.endpoint, rowData);

    // If editing, load current data
    if (rowData && button.endpoint) {
      const { data } = await axios.get(endpoint);
      Object.assign(dialogData, data);
    } else {
      // Clear dialog data for new entry
      Object.keys(dialogData).forEach(key => delete dialogData[key]);
    }

    // Load form config from parent schema or make API call
    // For now, assuming form config is passed in button
    dialogConfig.value = {
      title: button.title || 'Edit',
      endpoint: endpoint,
      method: button.method || 'PUT',
      fields: button.fields || []
    };

    dialogVisible.value = true;
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load form',
      life: 3000
    });
  }
}

// Save dialog
async function saveDialog() {
  dialogLoading.value = true;
  try {
    await axios({
      method: dialogConfig.value.method,
      url: dialogConfig.value.endpoint,
      data: dialogData
    });

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Saved successfully',
      life: 3000
    });

    dialogVisible.value = false;
    await loadData();
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.response?.data?.error || 'Failed to save',
      life: 3000
    });
  } finally {
    dialogLoading.value = false;
  }
}

// Perform action
async function performAction(action) {
  actionLoading[action.id] = true;
  try {
    await axios({
      method: action.method || 'POST',
      url: action.endpoint
    });

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: action.successMessage || 'Action completed',
      life: 3000
    });

    if (action.reloadAfter !== false) {
      await loadData();
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.response?.data?.error || 'Action failed',
      life: 3000
    });
  } finally {
    actionLoading[action.id] = false;
  }
}

// Perform row action (delete, etc.)
async function performRowAction(button, rowData) {
  try {
    const endpoint = replacePlaceholders(button.endpoint, rowData);
    
    await axios({
      method: button.method || 'POST',
      url: endpoint
    });

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: button.successMessage || 'Action completed',
      life: 3000
    });

    await loadData();
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.response?.data?.error || 'Action failed',
      life: 3000
    });
  }
}

// Update field (inline editing or toggle)
async function updateField(rowData, field, value, endpoint = null) {
  try {
    const dataKey = props.config.dataKey;
    const url = endpoint
      ? replacePlaceholders(endpoint, rowData)
      : `${props.config.endpoint}/${rowData[dataKey]}`;

    await axios.put(url, {
      [field]: value
    });

    // Update local data
    const index = tableData.value.findIndex(item => item[dataKey] === rowData[dataKey]);
    if (index !== -1) {
      tableData.value[index][field] = value;
    }

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Updated successfully',
      life: 2000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update',
      life: 3000
    });
    // Reload to revert
    await loadData();
  }
}

// Replace placeholders in strings (e.g., /api/users/{id})
function replacePlaceholders(str, data) {
  if (!str) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => data[key] || match);
}

// Get icon based on data
function getIcon(iconConfig, data) {
  if (typeof iconConfig === 'string') return iconConfig;
  if (typeof iconConfig === 'object') {
    return iconConfig[data.product_type] || iconConfig[data.type] || 'pi-circle';
  }
  return 'pi-circle';
}

// Get badge label
function getBadgeLabel(template, value) {
  if (template.labels && template.labels[value]) {
    return template.labels[value];
  }
  return value;
}

// Get badge severity
function getBadgeSeverity(template, value) {
  if (template.severity && template.severity[value]) {
    return template.severity[value];
  }
  return 'info';
}

// Format number
function formatNumber(value, template) {
  if (value === null || value === undefined) return '-';
  const formatted = template.decimals !== undefined
    ? Number(value).toFixed(template.decimals)
    : value;
  return `${template.prefix || ''}${formatted}${template.suffix || ''}`;
}

// Format date
function formatDate(value, format = 'relative') {
  if (!value) return '-';
  
  const date = new Date(value);
  
  if (format === 'relative') {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }
  
  return date.toLocaleString();
}

// Get visible buttons based on conditions
function getVisibleButtons(buttons, rowData) {
  if (!buttons) return [];
  
  return buttons.filter(button => {
    if (!button.condition) return true;
    
    const { field, operator, value } = button.condition;
    const fieldValue = rowData[field];
    
    switch (operator) {
      case '==': return fieldValue == value;
      case '!=': return fieldValue != value;
      case '>': return fieldValue > value;
      case '<': return fieldValue < value;
      case '>=': return fieldValue >= value;
      case '<=': return fieldValue <= value;
      default: return true;
    }
  });
}

// Apply filters
function applyFilters() {
  // Implementation depends on your filter strategy
  loadData();
}

onMounted(() => {
  loadData();
});

// Expose reload method
defineExpose({
  reload: loadData
});
</script>

<style scoped>
.universal-table {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
}

.toolbar-left {
  display: flex;
  gap: 0.5rem;
}

.toolbar-right {
  display: flex;
  gap: 0.5rem;
}

.filter-dropdown {
  min-width: 200px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

:deep(.p-datatable-sm .p-datatable-tbody > tr > td) {
  padding: 0.5rem;
}
</style>