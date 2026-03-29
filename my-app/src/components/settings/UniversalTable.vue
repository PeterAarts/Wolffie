<template>
  <div class="universal-table flex flex-col gap-4">
    <!-- Global Actions / Filters toolbar -->
    <div v-if="tableConfig.globalActions?.length || tableConfig.filters?.length" class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <button
          v-for="action in tableConfig.globalActions"
          :key="action.label"
          @click="executeGlobalAction(action)"
          :disabled="actionLoading[action.id]"
          class="flex items-center gap-2 p-4 bg-white border border-secondary-200  text-sm font-semibold text-secondary-700 hover:bg-secondary-50 hover:border-blue-300 transition-all shadow-sm disabled:opacity-50"
        >
          <i v-if="actionLoading[action.id]" class="fa-light fa-spinner-third fa-spin text-slate-500"></i>
          <i v-else :class="['fa-light', mapIcon(action.icon), 'text-blue-700']"></i>
          {{ r(action.label) }}
        </button>
      </div>

      <div v-if="tableConfig.filters?.length" class="flex items-center gap-2">
        <select
          v-for="filter in tableConfig.filters"
          :key="filter.field"
          v-model="filterValues[filter.field]"
          @change="applyFilters"
          class="bg-white border border-secondary-200 p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
        >
          <option value="">{{ filter.placeholder || 'Filter...' }}</option>
          <option v-for="opt in filter.options" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-12 text-secondary-400 text-sm gap-2">
      <i class="fa-duotone fa-spinner-third fa-spin"></i>
      {{ t('common.loading') }}
    </div>

    <!-- Error state -->
    <div v-else-if="loadError" class="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
      <i class="fa-duotone fa-circle-exclamation"></i>
      {{ loadError }}
    </div>

    <!-- Empty state -->
    <div v-else-if="!tableData.length" class="flex flex-col items-center justify-center py-12 text-secondary-400 text-sm gap-2">
      <i class="fa-duotone fa-table text-2xl"></i>
      {{ t('common.noData') }}
    </div>

    <!-- Table -->
    <div v-else class="overflow-hidden  overflow-x-auto">
      <table class="min-w-full divide-y divide-secondary-200">
        <thead class="bg-secondary-50/50">
          <tr :key="headerKey">
            <th
              v-for="col in tableConfig.columns"
              :key="col.field"
              class="p-4 text-left text-xs font-medium text-secondary-400 uppercase tracking-widest"
            >
              {{ r(col.header) }}
            </th>
            <th
              v-if="tableConfig.rowActions?.length"
              class="p-4text-right text-xs font-extrabold text-secondary-400 uppercase tracking-widest"
            >
              {{ t('common.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-secondary-200">
          <tr
            v-for="(row, rowIndex) in tableData"
            :key="row.id || rowIndex"
            class="hover:bg-blue-50/30 transition-colors"
          >
            <td
              v-for="col in tableConfig.columns"
              :key="col.field"
              class="px-6 py-4 text-sm text-secondary-600 font-medium"
            >
              <template v-if="col.template?.type === 'boolean'">
                <i :class="row[col.field] ? 'fa-solid fa-circle-check text-green-500' : 'fa-solid fa-circle-xmark text-secondary-300'"></i>
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
                {{ col.template?.type === 'datetime' ? formatDate(row[col.field], col.template.format) : (row[col.field] ?? '-') }}
              </template>
            </td>

            <td v-if="tableConfig.rowActions?.length" class="px-6 py-4 text-right">
              <div class="flex justify-end gap-2">
                <button
                  v-for="btn in getVisibleButtons(tableConfig.rowActions, row)"
                  :key="btn.label"
                  @click="executeRowAction(btn, row)"
                  :title="btn.label"
                  class="p-4 hover:bg-secondary-100 rounded-lg group"
                >
                  <i :class="['fa-light ', mapIcon(btn.icon), 'text-secondary-400 group-hover:text-secondary-900 ']"></i>
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
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';

const props = defineProps({
  config:        { type: Object, required: true },
  moduleId:      { type: String, required: true },
  i18nKeys:      { type: Boolean, default: false },
  // When the parent uses i18nKeys it merges translations asynchronously.
  // Watch this flag to force header re-render once messages are ready.
  messagesReady: { type: Boolean, default: true }
});

// Incrementing this key forces Vue to re-evaluate r(col.header) calls
// in the thead after module translations have been merged.
const headerKey = ref(0);
watch(() => props.messagesReady, (ready) => {
  if (ready) headerKey.value++;
});

const { t } = useI18n();

// Resolve a string as an i18n key when the parent schema uses i18nKeys,
// otherwise return it as a plain display string.
function r(value) {
  if (!value) return value;
  return props.i18nKeys ? t(value) : value;
}

// ─── Normalise config ────────────────────────────────────────────────────────
// The schema may nest the table config inside a `data` property (legacy format)
// or put everything directly on the section object (flat format).
// This computed always gives us a consistent object to work with.
const tableConfig = computed(() => props.config.data ?? props.config);

// ─── State ───────────────────────────────────────────────────────────────────
const tableData     = ref([]);
const loading       = ref(false);
const loadError     = ref(null);
const filterValues  = reactive({});
const actionLoading = reactive({});

// ─── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  const endpoint = tableConfig.value.endpoint;
  if (!endpoint) {
    console.warn(`UniversalTable [${props.moduleId}]: no endpoint configured for section "${props.config.title}"`);
    return;
  }

  loading.value  = true;
  loadError.value = null;

  try {
    const { data } = await apiClient.get(endpoint, { params: filterValues });

    // Support multiple response shapes:
    //   - plain array
    //   - { data: [...] }      ← /settings/users/list
    //   - { items: [...] }
    //   - { success, data: [...] }
    if (Array.isArray(data)) {
      tableData.value = data;
    } else if (Array.isArray(data?.data)) {
      tableData.value = data.data;
    } else if (Array.isArray(data?.items)) {
      tableData.value = data.items;
    } else {
      tableData.value = [];
    }
  } catch (err) {
    console.error(`UniversalTable [${props.moduleId}]: failed to load data`, err);
    loadError.value = err.message || t('common.loadFailed');
  } finally {
    loading.value = false;
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function executeGlobalAction(action) {
  if (action.confirmMessage && !confirm(r(action.confirmMessage))) return;
  actionLoading[action.id] = true;
  try {
    await apiClient({ method: action.method || 'POST', url: action.endpoint });
    if (action.refreshAfter !== false) await loadData();
  } catch (err) {
    alert(t('common.actionFailed') + ': ' + err.message);
  } finally {
    actionLoading[action.id] = false;
  }
}

async function executeRowAction(btn, row) {
  if (btn.confirmMessage && !confirm(r(btn.confirmMessage))) return;
  try {
    await apiClient({
      method: btn.method || 'POST',
      url: btn.endpoint || `${tableConfig.value.endpoint}/${btn.action}`,
      data: row
    });
    await loadData();
  } catch (err) {
    alert(t('common.actionFailed') + ': ' + err.message);
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────
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

function getStatusClass(value, template) {
  const severity = template?.severity?.[value] || 'info';
  const maps = {
    success: 'bg-green-100 text-green-700',
    danger:  'bg-red-100 text-red-700',
    warning: 'bg-amber-100 text-amber-700',
    info:    'bg-blue-100 text-blue-700'
  };
  return maps[severity] || maps.info;
}

function getVisibleButtons(buttons, rowData) {
  if (!buttons) return [];
  return buttons.filter(b => {
    if (!b.condition) return true;
    const val = rowData[b.condition.field];
    return b.condition.operator === '==' ? val == b.condition.value : val != b.condition.value;
  });
}

function mapIcon(icon) {
  if (!icon) return 'fa-question';
  return icon.replace('pi pi-', 'fa-light fa-').replace('pi-', 'fa-light fa-');
}

function applyFilters() { loadData(); }

// ─── Lifecycle ────────────────────────────────────────────────────────────────
watch(() => props.moduleId, loadData);
onMounted(loadData);
defineExpose({ reload: loadData });
</script>