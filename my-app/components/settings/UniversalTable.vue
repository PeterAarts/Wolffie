<template>
  <div class="universal-table flex flex-col gap-4">
    <div v-if="config.globalActions || config.filters" class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <button
          v-for="action in config.globalActions"
          :key="action.label"
          @click="executeGlobalAction(action)"
          :disabled="actionLoading[action.id]"
          class="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-blue-300 transition-all shadow-sm disabled:opacity-50"
        >
          <i v-if="actionLoading[action.id]" class="fa-duotone fa-spinner-third fa-spin text-blue-500"></i>
          <i v-else :class="['fa-duotone', mapIcon(action.icon), 'text-blue-600']"></i>
          {{ action.label }}
        </button>
      </div>

      <div v-if="config.filters" class="flex items-center gap-2">
        <select
          v-for="filter in config.filters"
          :key="filter.field"
          v-model="filterValues[filter.field]"
          @change="applyFilters"
          class="bg-white border border-gray-200 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
        >
          <option value="">{{ filter.placeholder || 'Filter...' }}</option>
          <option v-for="opt in filter.options" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="overflow-hidden border border-gray-200 rounded-xl bg-white shadow-sm overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50/50">
          <tr>
            <th v-for="col in config.columns" :key="col.field" 
                class="px-6 py-4 text-left text-xs font-extrabold text-gray-400 uppercase tracking-widest">
              {{ col.header }}
            </th>
            <th v-if="config.rowActions" class="px-6 py-4 text-right text-xs font-extrabold text-gray-400 uppercase tracking-widest">
              Acties
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          <tr v-for="(row, rowIndex) in tableData" :key="row.id || rowIndex" class="hover:bg-blue-50/30 transition-colors">
            <td v-for="col in config.columns" :key="col.field" class="px-6 py-4 text-sm text-gray-600 font-medium">
              <template v-if="col.template?.type === 'boolean'">
                <i :class="row[col.field] ? 'fa-solid fa-circle-check text-green-500' : 'fa-solid fa-circle-xmark text-gray-300'"></i>
              </template>
              
              <template v-else-if="col.template?.type === 'status-badge'">
                <span :class="[getStatusClass(row[col.field], col.template), 'px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight']">
                  {{ row[col.field] }}
                </span>
              </template>

              <template v-else-if="col.template?.type === 'number'">
                {{ formatNumber(row[col.field], col.template) }}
              </template>

              <template v-else>
                {{ col.template?.type === 'datetime' ? formatDate(row[col.field], col.template.format) : row[col.field] }}
              </template>
            </td>

            <td v-if="config.rowActions" class="px-6 py-4 text-right">
              <div class="flex justify-end gap-2">
                <button
                  v-for="btn in getVisibleButtons(config.rowActions, row)"
                  :key="btn.label"
                  @click="executeRowAction(btn, row)"
                  class="p-2 hover:bg-gray-100 rounded-lg group"
                >
                  <i :class="['fa-duotone', mapIcon(btn.icon), 'text-gray-400 group-hover:text-blue-600']"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue';
import apiClient from '@/services/api';

const props = defineProps({
  config: { type: Object, required: true },
  moduleId: { type: String, required: true }
});

const tableData = ref([]);
const loading = ref(false);
const filterValues = reactive({});
const actionLoading = reactive({});

// --- RE-INSTATED FUNCTIONS FROM ORIGINAL ---

async function loadData() {
  loading.value = true;
  try {
    const { data } = await apiClient.get(props.config.endpoint, { params: filterValues });
    tableData.value = Array.isArray(data) ? data : (data.items || []);
  } catch (err) {
    console.error("Failed to load table data", err);
  } finally {
    loading.value = false;
  }
}

async function executeGlobalAction(action) {
  if (action.confirmMessage && !confirm(action.confirmMessage)) return;
  actionLoading[action.id] = true;
  try {
    const response = await apiClient({
      method: action.method || 'POST',
      url: action.endpoint
    });
    if (action.refreshAfter !== false) await loadData();
    // Emit for parent notification if needed
  } catch (err) {
    alert("Action failed: " + err.message);
  } finally {
    actionLoading[action.id] = false;
  }
}

function executeRowAction(btn, row) {
  if (btn.confirmMessage && !confirm(btn.confirmMessage)) return;
  // Handle specific actions like delete, edit, etc.
  console.log('Row Action Executed:', btn.action, row);
}

function formatNumber(value, template) {
  if (value === null || value === undefined) return '-';
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

function getStatusClass(value, template) {
  const severity = template?.severity?.[value] || 'info';
  const maps = {
    'success': 'bg-green-100 text-green-700',
    'danger': 'bg-red-100 text-red-700',
    'warning': 'bg-amber-100 text-amber-700',
    'info': 'bg-blue-100 text-blue-700'
  };
  return maps[severity] || maps.info;
}

function mapIcon(icon) {
  if (!icon) return 'fa-question';
  return icon.replace('pi pi-', 'fa-duotone fa-').replace('pi-', 'fa-duotone fa-');
}

function applyFilters() { loadData(); }

watch(() => props.moduleId, loadData);
onMounted(loadData);
defineExpose({ reload: loadData });
</script>