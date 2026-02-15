<!-- src/components/settings/UniversalInfoPanel.vue -->
<template>
  <div class="universal-info-panel">
    <div 
      v-for="item in displayItems" 
      :key="item.label"
      class="info-item"
    >
      <div class="info-icon" v-if="item.icon">
        <i :class="`pi ${item.icon}`" :style="{ color: item.iconColor }"></i>
      </div>
      
      <div class="info-content">
        <span class="info-label">{{ item.label }}</span>
        
        <!-- Simple Value -->
        <span v-if="!item.template" class="info-value">
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import apiClient from '@/services/api';


const props = defineProps({
  config: {
    type: Object,
    required: true
  }
});

const data = ref({});
const loading = ref(false);
let refreshInterval = null;

const displayItems = computed(() => {
  if (!props.config.items) return [];
  
  return props.config.items.map(item => ({
    ...item,
    value: item.value !== undefined ? item.value : data.value[item.field]
  }));
});

// Load data
async function loadData() {
  if (!props.config.endpoint) {
    // Static data
    data.value = props.config.data || {};
    return;
  }

  loading.value = true;
  try {
    const response = await apiClient.get(props.config.endpoint);
    data.value = response.data.data || response.data;
  } catch (error) {
    console.error('Failed to load info panel data:', error);
  } finally {
    loading.value = false;
  }
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
  if (props.config.dynamic && props.config.refreshInterval) {
    refreshInterval = setInterval(() => {
      loadData();
    }, props.config.refreshInterval);
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
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

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