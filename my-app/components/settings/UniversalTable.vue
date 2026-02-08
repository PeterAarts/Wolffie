<template>
  <div class="universal-table">
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
          class="mr-2"
        />
      </div>

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
      <Column
        v-for="col in config.columns"
        :key="col.field"
        :field="col.field"
        :header="col.header"
        :sortable="col.sortable !== false"
        :style="col.width ? { width: col.width } : {}"
      >
        <template v-if="col.filter" #filter="{ filterModel, filterCallback }">
          <InputText v-model="filterModel.value" @input="filterCallback()" placeholder="Search..." class="p-column-filter" />
        </template>

        <template #body="{ data }">
          <span v-if="!col.template">{{ data[col.field] }}</span>

          <div v-else-if="col.template.type === 'icon-text'" class="flex align-items-center gap-2">
            <i :class="`pi ${getIcon(col.template.icon, data)}`"></i>
            <div class="flex flex-column">
              <span class="font-semibold">{{ data[col.template.text] }}</span>
              <span v-if="col.template.subtext" class="text-sm text-600">{{ data[col.template.subtext] }}</span>
            </div>
          </div>

          <Tag v-else-if="col.template.type === 'badge'" :value="getBadgeLabel(col.template, data[col.field])" :severity="getBadgeSeverity(col.template, data[col.field])" />

          <InputSwitch v-else-if="col.template.type === 'switch'" :modelValue="data[col.field]" @update:modelValue="updateField(data, col.field, $event, col.template.updateEndpoint)" :disabled="!col.editable" />

          <div v-else-if="col.template.type === 'boolean-icon'">
            <i :class="`pi ${data[col.field] ? col.template.trueIcon : col.template.falseIcon}`" :style="{ color: data[col.field] ? col.template.trueColor : col.template.falseColor }"></i>
          </div>

          <div v-else-if="col.template.type === 'status-dot'" class="flex align-items-center gap-2">
            <span class="status-dot" :style="{ backgroundColor: data[col.field] ? col.template.trueColor : col.template.falseColor }"></span>
            <span>{{ data[col.field] ? col.template.trueLabel : col.template.falseLabel }}</span>
          </div>

          <span v-else-if="col.template.type === 'number'">{{ formatNumber(data[col.field], col.template) }}</span>
          <span v-else-if="col.template.type === 'date'">{{ formatDate(data[col.field], col.template.format) }}</span>

          <div v-else-if="col.template.type === 'actions'" class="flex gap-1">
            <Button v-for="button in getVisibleButtons(col.template.buttons, data)" :key="button.icon" :icon="button.icon" :severity="button.severity || 'secondary'" v-tooltip="button.tooltip" size="small" text rounded @click="executeRowAction(button, data)" />
          </div>

          <InputText v-else-if="col.editable && !col.template" :modelValue="data[col.field]" @blur="updateField(data, col.field, $event.target.value)" class="p-inputtext-sm" />
        </template>
      </Column>

      <template #empty>
        <div class="text-center p-4 text-600">Geen gegevens gevonden.</div>
      </template>
    </DataTable>

    <ConfirmDialog />

    <Dialog v-model:visible="dialogVisible" :header="dialogConfig.title" :modal="true" :style="{ width: '50vw' }">
      <div class="flex flex-column gap-3">
        <UniversalField v-for="field in dialogConfig.fields" :key="field.key" :field="field" v-model="dialogData[field.key]" />
      </div>
      <template #footer>
        <Button label="Cancel" @click="dialogVisible = false" severity="secondary" />
        <Button label="Save" @click="saveDialog" :loading="dialogLoading" />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, watch } from 'vue';
import apiClient from '@/services/api';
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
  config: { type: Object, required: true },
  moduleId: { type: String, default: null }
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
  return props.config.columns.filter(col => col.filter).map(col => col.field);
});

async function loadData() {
  if (!props.config.endpoint) return;
  loading.value = true;
  try {
    const { data: res } = await apiClient.get(props.config.endpoint);
    // Ondersteun { data: [] } en directe arrays
    tableData.value = res.data || res[Object.keys(res)[0]] || res;
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Data laden mislukt', life: 3000 });
  } finally {
    loading.value = false;
  }
}

async function executeGlobalAction(action) {
  if (action.action === 'reload') { await loadData(); return; }
  if (action.confirm) {
    confirm.require({
      message: action.confirm, header: 'Bevestiging', icon: 'pi pi-exclamation-triangle',
      accept: async () => { await performAction(action); }
    });
  } else { await performAction(action); }
}

async function executeRowAction(button, rowData) {
  currentRowData.value = rowData;
  if (button.action === 'navigate') {
    window.location.href = replacePlaceholders(button.route, rowData);
    return;
  }
  if (button.action === 'dialog') { await openDialog(button, rowData); return; }
  if (button.action === 'endpoint') {
    if (button.confirm) {
      confirm.require({
        message: replacePlaceholders(button.confirm, rowData),
        header: 'Bevestiging', icon: 'pi pi-exclamation-triangle',
        accept: async () => { await performRowAction(button, rowData); }
      });
    } else { await performRowAction(button, rowData); }
  }
}

async function openDialog(button, rowData = null) {
  try {
    const endpoint = replacePlaceholders(button.endpoint, rowData);
    if (rowData && button.endpoint) {
      const { data } = await apiClient.get(endpoint);
      Object.assign(dialogData, data);
    } else {
      Object.keys(dialogData).forEach(key => delete dialogData[key]);
    }
    dialogConfig.value = {
      title: button.title || 'Edit',
      endpoint: endpoint,
      method: button.method || 'PUT',
      fields: button.fields || []
    };
    dialogVisible.value = true;
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Formulier laden mislukt', life: 3000 });
  }
}

async function saveDialog() {
  dialogLoading.value = true;
  try {
    await apiClient({ method: dialogConfig.value.method, url: dialogConfig.value.endpoint, data: dialogData });
    toast.add({ severity: 'success', summary: 'Succes', detail: 'Opgeslagen', life: 3000 });
    dialogVisible.value = false;
    await loadData();
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.response?.data?.error || 'Opslaan mislukt', life: 3000 });
  } finally { dialogLoading.value = false; }
}

async function performAction(action) {
  actionLoading[action.id] = true;
  try {
    await apiClient({ method: action.method || 'POST', url: action.endpoint });
    toast.add({ severity: 'success', summary: 'Success', detail: action.successMessage || 'Klaar', life: 3000 });
    if (action.reloadAfter !== false) await loadData();
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Actie mislukt', life: 3000 });
  } finally { actionLoading[action.id] = false; }
}

async function performRowAction(button, rowData) {
  try {
    await apiClient({ method: button.method || 'POST', url: replacePlaceholders(button.endpoint, rowData) });
    toast.add({ severity: 'success', summary: 'Success', detail: button.successMessage || 'Klaar', life: 3000 });
    await loadData();
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Actie mislukt', life: 3000 });
  }
}

async function updateField(rowData, field, value, endpoint = null) {
  try {
    const url = endpoint ? replacePlaceholders(endpoint, rowData) : `${props.config.endpoint}/${rowData[props.config.dataKey]}`;
    await apiClient.put(url, { [field]: value });
    loadData();
    toast.add({ severity: 'success', summary: 'Success', detail: 'Bijgewerkt', life: 2000 });
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Update mislukt', life: 3000 });
  }
}

function replacePlaceholders(str, data) {
  if (!str) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => data[key] || match);
}

function getIcon(iconConfig, data) {
  if (typeof iconConfig === 'string') return iconConfig;
  return iconConfig[data.product_type] || iconConfig[data.type] || 'pi-circle';
}

function getBadgeLabel(template, value) { return template.labels?.[value] || value; }
function getBadgeSeverity(template, value) { return template.severity?.[value] || 'info'; }

function formatNumber(value, template) {
  if (value === null) return '-';
  const val = template.decimals !== undefined ? Number(value).toFixed(template.decimals) : value;
  return `${template.prefix || ''}${val}${template.suffix || ''}`;
}

function formatDate(value, format = 'relative') {
  if (!value) return '-';
  const date = new Date(value);
  return format === 'relative' ? date.toLocaleDateString() : date.toLocaleString();
}

function getVisibleButtons(buttons, rowData) {
  if (!buttons) return [];
  return buttons.filter(b => {
    if (!b.condition) return true;
    const val = rowData[b.condition.field];
    return b.condition.operator === '==' ? val == b.condition.value : val != b.condition.value;
  });
}

function applyFilters() { loadData(); }

watch(() => props.moduleId, loadData);
onMounted(loadData);
defineExpose({ reload: loadData });

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