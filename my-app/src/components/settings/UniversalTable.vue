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
          class="flex items-center gap-2 p-4 bg-card border border-secondary-200  text-sm font-semibold text-secondary-700 hover:bg-secondary-50 hover:border-blue-300 transition-all shadow-sm disabled:opacity-50"
        >
          <i v-if="actionLoading[action.id]" class="ph-light ph-spinner-third ph-spin text-slate-500"></i>
          <i v-else :class="['ph-light', mapIcon(action.icon), 'text-blue-700']"></i>
          {{ r(action.label) }}
        </button>
      </div>

      <div v-if="tableConfig.filters?.length" class="flex items-center gap-2">
        <select
          v-for="filter in tableConfig.filters"
          :key="filter.field"
          v-model="filterValues[filter.field]"
          @change="applyFilters"
          class="bg-card border border-secondary-200 p-4 text-sm focus:ring-2 focus:ring-blue-500/20 outline-none"
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
      <i class="ph-duotone ph-spinner-third ph-spin"></i>
      {{ t('common.loading') }}
    </div>

    <!-- Error state -->
    <div v-else-if="loadError" class="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
      <i class="ph-duotone ph-circle-exclamation"></i>
      {{ loadError }}
    </div>

    <!-- Empty state -->
    <div v-else-if="!tableData.length" class="flex flex-col items-center justify-center py-12 text-secondary-400 text-sm gap-2">
      <i class="ph-duotone ph-table text-2xl"></i>
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
              :class="compact
                ? 'px-3 py-2 text-left text-[10px] font-medium text-secondary-400'
                : 'p-4 text-left text-xs font-medium text-secondary-400 uppercase tracking-widest'"
            >
              {{ r(col.header) }}
            </th>
            <th
              v-if="tableConfig.rowActions?.length"
              :class="compact
                ? 'px-3 py-2 text-right text-[10px] font-medium text-secondary-400'
                : 'p-4 text-right text-xs font-extrabold text-secondary-400 uppercase tracking-widest'"
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
              :class="compact ? 'px-3 py-2 text-xs text-secondary-600' : 'px-6 py-4 text-sm text-secondary-600 font-medium'"
            >
              <template v-if="col.template?.type === 'boolean'">
                <i :class="row[col.field] ? 'ph-fill ph-circle-check text-green-500' : 'ph-fill ph-circle-xmark text-secondary-300'"></i>
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

            <td v-if="tableConfig.rowActions?.length" :class="compact ? 'px-3 py-2 text-right' : 'px-6 py-4 text-right'">
              <div class="flex justify-end gap-2">
                <button
                  v-for="btn in getVisibleButtons(tableConfig.rowActions, row)"
                  :key="btn.label"
                  @click="executeRowAction(btn, row)"
                  :title="btn.label"
                  :class="compact ? 'p-1 hover:bg-secondary-100 rounded group' : 'p-4 hover:bg-secondary-100 rounded-lg group'"
                >
                  <i :class="['ph-light ', mapIcon(btn.icon), 'text-secondary-400 group-hover:text-secondary-900 ']"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

  </div>


  <!-- ── Edit drawer ────────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="editDrawer.visible"
         class="fixed inset-0 z-[9998] flex justify-end"
         @click.self="editDrawer.visible = false">
      <div class="w-full max-w-sm h-full bg-[var(--card-bg-color)] border-l border-[var(--color-border)] flex flex-col shadow-xl">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ t('common.edit') }}</h3>
          <button class="icon-btn" @click="editDrawer.visible = false">
            <i class="ph-light ph-xmark"></i>
          </button>
        </div>
        <!-- Fields -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <div v-for="field in editDrawer.fields" :key="field.key">
            <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
              {{ r(field.label) }}
            </label>
            <input
              v-if="field.component === 'text' || field.component === 'number'"
              :type="field.component === 'number' ? 'number' : 'text'"
              v-model="editDrawer.data[field.key]"
              class="input w-full"
              :placeholder="field.placeholder || ''"
            />
            <label v-else-if="field.component === 'switch'" class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="editDrawer.data[field.key]" class="hidden" />
              <div class="toggle" :class="editDrawer.data[field.key] ? 'toggle--on' : ''"></div>
            </label>
          </div>
        </div>
        <!-- Footer -->
        <div class="flex gap-3 justify-end px-5 py-4 border-t border-[var(--color-border)]">
          <button class="btn" @click="editDrawer.visible = false">{{ t('common.cancel') }}</button>
          <button class="btn btn--primary" :disabled="editDrawer.saving" @click="saveEdit">
            <i v-if="editDrawer.saving" class="ph-light ph-spinner ph-spin mr-1"></i>
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── Confirm modal ──────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="confirmState.visible"
         class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
         @click.self="resolveConfirm(false)">
      <div class="w-full max-w-sm p-6 bg-[var(--card-bg-color)] border border-[var(--color-border)] rounded-[var(--radius-xl)]">
        <div class="flex items-center gap-2 mb-4">
          <i class="ph-light ph-circle-question text-[var(--color-primary)]"></i>
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">{{ confirmState.message }}</h3>
        </div>
        <div class="flex gap-3 justify-end">
          <button class="btn" @click="resolveConfirm(false)">{{ t('common.cancel') }}</button>
          <button class="btn btn--primary" @click="resolveConfirm(true)">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>

</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';

const props = defineProps({
  config:        { type: Object, required: true },
  moduleId:      { type: String, required: true },
  i18nKeys:      { type: Boolean, default: false },
  // When the parent uses i18nKeys it merges translations asynchronously.
  // Watch this flag to force header re-render once messages are ready.
  messagesReady: { type: Boolean, default: true },
  compact:      { type: Boolean, default: false }
});

// Incrementing this key forces Vue to re-evaluate r(col.header) calls
// in the thead after module translations have been merged.
const headerKey = ref(0);
watch(() => props.messagesReady, (ready) => {
  if (ready) headerKey.value++;
});

const { t } = useI18n();
const toast = useToastStore();

// ─── Confirm modal ───────────────────────────────────────────────────────────
const confirmState = ref({ visible: false, message: '' });
let _confirmResolve = null;

function showConfirm(message) {
  confirmState.value = { visible: true, message };
  return new Promise(resolve => { _confirmResolve = resolve; });
}

function resolveConfirm(result) {
  confirmState.value.visible = false;
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

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

// ─── Edit drawer ──────────────────────────────────────────────────────────────
const editDrawer = reactive({
  visible: false,
  fields:  [],
  data:    {},
  endpoint: '',
  saving:  false,
});

function resolveEndpoint(template, row) {
  return template.replace(/\{(\w+)\}/g, (_, key) => row[key] ?? '');
}

function openEditDrawer(btn, row) {
  editDrawer.fields   = btn.fields || [];
  editDrawer.endpoint = resolveEndpoint(btn.endpoint || tableConfig.value.endpoint + '/{id}', row);
  editDrawer.data     = { ...row };
  editDrawer.saving   = false;
  editDrawer.visible  = true;
}

async function saveEdit() {
  editDrawer.saving = true;
  try {
    await apiClient({ method: 'PUT', url: editDrawer.endpoint, data: editDrawer.data });
    editDrawer.visible = false;
    await loadData();
    toast.add({ severity: 'success', summary: t('common.saved'), detail: t('common.saved') });
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    editDrawer.saving = false;
  }
}

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
  if (action.confirmMessage && !await showConfirm(r(action.confirmMessage))) return;
  actionLoading[action.id] = true;
  try {
    await apiClient({ method: action.method || 'POST', url: action.endpoint });
    if (action.refreshAfter !== false) await loadData();
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    actionLoading[action.id] = false;
  }
}

async function executeRowAction(btn, row) {
  if (btn.confirmMessage && !await showConfirm(r(btn.confirmMessage))) return;

  // Drawer action — open edit form instead of API call
  if (btn.type === 'drawer') {
    openEditDrawer(btn, row);
    return;
  }

  // API action — resolve {id} placeholders in endpoint
  const url = btn.endpoint
    ? resolveEndpoint(btn.endpoint, row)
    : `${tableConfig.value.endpoint}/${row.id}`;

  try {
    await apiClient({ method: btn.method || 'POST', url, data: row });
    await loadData();
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
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
  if (!icon) return 'ph-question';
  return icon.replace('pi pi-', 'ph-light ph-').replace('pi-', 'ph-light ph-');
}

function applyFilters() { loadData(); }

// ─── Lifecycle ────────────────────────────────────────────────────────────────
watch(() => props.moduleId, loadData);
onMounted(loadData);
defineExpose({ reload: loadData });
</script>