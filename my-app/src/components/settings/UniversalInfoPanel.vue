<!-- src/components/settings/UniversalInfoPanel.vue -->
<template>
  <div class="grid bg-secondary-100 p-4 gap-4 fields-container">
    <div 
      v-for="item in displayItems" 
      :key="item.label"
      :class="['info-item', getColClass(item)]"
    >
      <div class="info-icon" v-if="item.icon">
        <i :class="`fa-light ${item.icon}`" :style="{ color: item.iconColor }"></i>
      </div>
      
      <div class="info-content">
        <label :key="labelKey" class="text-xs text-secondary-500 tracking-wider ml-1">{{ r(item.label) }}</label>
        
        <!-- Simple Value -->
        <span v-if="!item.template" class="select-none text-sm font-normal bg-white p-2 text-secondary-700 group-hover:text-secondary-900 transition-colors">
          {{ getValue(item) }}
        </span>

        <!-- Status Badge Template -->
        <Tag
          v-else-if="item.template.type === 'status-badge'"
          :value="getStatusLabel(item)"
          :severity="getStatusSeverity(item)"
          class="info-value"
        />

        <!-- Boolean Icon Template -->
        <div v-else-if="item.template.type === 'boolean-icon'" class="info-value">
          <i
            :class="`pi ${getBoolValue(item) ? item.template.trueIcon : item.template.falseIcon}`"
            :style="{ color: getBoolValue(item) ? item.template.trueColor : item.template.falseColor }"
          ></i>
        </div>

        <!-- Number Template -->
        <span v-else-if="item.template.type === 'number'" class="info-value">
          {{ formatNumber(getValue(item), item.template) }}
        </span>

        <!-- Date Template -->
        <span v-else-if="item.template.type === 'date'" class="info-value">
          {{ formatDate(getValue(item), item.template.format) }}
        </span>

        <!-- Progress Bar Template -->
        <div v-else-if="item.template.type === 'progress'" class="info-value-full">
          <ProgressBar
            :value="getValue(item)"
            :showValue="item.template.showValue !== false"
          />
        </div>

        <!-- Link Template -->
        <a
          v-else-if="item.template.type === 'link'"
          :href="getValue(item)"
          target="_blank"
          class="info-value info-link"
        >
          {{ item.template.label || getValue(item) }}
          <i class="pi pi-external-link ml-1" style="font-size: 0.8rem"></i>
        </a>

        <!-- Default -->
        <span v-else class="info-value">
          {{ getValue(item) }}
        </span>
      </div>
    </div>

    <!-- Refresh Indicator -->
    <div v-if="loading" class="refresh-indicator">
      <ProgressSpinner style="width: 20px; height: 20px" strokeWidth="4" />
      <span class="text-sm text-600">Refreshing...</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';


const props = defineProps({
  config:     { type: Object, required: true },
  moduleId:   { type: String, default: '' },
  i18nKeys:   { type: Boolean, default: false },
  staticData:     { type: Object, default: null },
  messagesReady:  { type: Boolean, default: true },
});

const { t } = useI18n();
function r(value) {
  if (!value) return value;
  return props.i18nKeys ? t(value) : value;
}

// Re-render labels once i18n messages are merged by parent
watch(() => props.messagesReady, (ready) => {
  if (ready) labelKey.value++;
});
const labelKey = ref(0);

const data = ref({});
const loading = ref(false);
let refreshInterval = null;

// Normalise config: support both flat { endpoint, items } and nested { data: { endpoint, items } }
const panelConfig = computed(() => props.config.data ?? props.config);

const displayItems = computed(() => {
  if (!panelConfig.value.items) return [];

  return panelConfig.value.items.map(item => ({
    ...item,
    value: item.value !== undefined ? item.value : data.value[item.field]
  }));
});

// Load data
async function loadData() {
  // staticData from parent takes priority (avoids redundant API call)
  if (props.staticData) {
    data.value = props.staticData;
    return;
  }

  const cfg = panelConfig.value;

  if (!cfg.endpoint) {
    data.value = {};
    return;
  }

  loading.value = true;
  try {
    const response = await apiClient.get(cfg.endpoint);
    const raw = response.data || response;
    const path = cfg.dataPath;
    data.value = path ? (raw[path] ?? raw) : (raw.data ?? raw);
  } catch (error) {
    console.error('Failed to load info panel data:', error);
  } finally {
    loading.value = false;
  }
}

// Column class — mirrors the field grid used in universalSettingsPanel
function getColClass(item) {
  const cols = item.cols ?? props.config.defaultCols ?? null;
  if (!cols) return '';
  const map = { 1: 'col-1', 2: 'col-2', 3: 'col-3', 4: 'col-4', 6: 'col-6', 12: 'col-12' };
  return map[cols] || '';
}

// Get value from item
function getValue(item) {
  if (item.value !== undefined) return item.value;
  if (item.field && data.value[item.field] !== undefined) {
    return data.value[item.field];
  }
  return '-';
}

// Get boolean value
function getBoolValue(item) {
  const value = getValue(item);
  return value === true || value === 'true' || value === 1 || value === '1';
}

// Get status label
function getStatusLabel(item) {
  const value = getBoolValue(item);
  return value ? item.template.trueLabel : item.template.falseLabel;
}

// Get status severity
function getStatusSeverity(item) {
  const value = getBoolValue(item);
  return value ? item.template.trueSeverity : item.template.falseSeverity;
}

// Format number
function formatNumber(value, template) {
  if (value === null || value === undefined || value === '-') return '-';
  const num = Number(value);
  if (isNaN(num)) return value;
  
  const formatted = template.decimals !== undefined
    ? num.toFixed(template.decimals)
    : num;
  
  return `${template.prefix || ''}${formatted}${template.suffix || ''}`;
}

// Format date
function formatDate(value, format = 'relative') {
  if (!value || value === '-') return '-';
  
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
  
  if (format === 'short') {
    return date.toLocaleDateString();
  }
  
  if (format === 'long') {
    return date.toLocaleString();
  }
  
  return date.toLocaleString();
}

// Setup auto-refresh
function setupRefresh() {
  const cfg = panelConfig.value;
  if (cfg.dynamic && cfg.refreshInterval) {
    refreshInterval = setInterval(() => {
      loadData();
    }, cfg.refreshInterval);
  }
}

onMounted(() => {
  loadData();
  setupRefresh();
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

// Expose reload method
defineExpose({
  reload: loadData
});
</script>

<style scoped>
.universal-info-panel {
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1rem;
}
.col-1  { grid-column: span 1; }
.col-2  { grid-column: span 2; }
.col-3  { grid-column: span 3; }
.col-4  { grid-column: span 4; }
.col-6  { grid-column: span 6; }
.col-12 { grid-column: span 12; }
/* Fallback: no cols specified = full width */
.info-item:not([class*="col-"]) { grid-column: span 12; }

.info-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.info-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.info-icon i {
  font-size: 1.2rem;
  color: #6b7280;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.info-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.info-value {
  font-size: 1rem;
  color: #111827;
  font-weight: 600;
}

.info-value-full {
  width: 100%;
}

.info-link {
  color: #3b82f6;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.info-link:hover {
  text-decoration: underline;
}

.refresh-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 0.5rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}
</style>