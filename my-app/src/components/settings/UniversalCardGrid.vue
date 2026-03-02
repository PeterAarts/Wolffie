<template>
  <div class="universal-card-grid">
    <div 
      v-for="card in displayCards" 
      :key="card.title"
      class="stat-card"
      :style="{ borderLeftColor: card.color }"
    >
      <div class="card-icon" :style="{ backgroundColor: card.color + '20' }">
        <i :class="`pi ${card.icon}`" :style="{ color: card.color }"></i>
      </div>

      <div class="card-content">
        <span class="card-title">{{ card.title }}</span>
        <span class="card-value">
          {{ formatValue(card) }}
        </span>
        
        <!-- Trend Indicator -->
        <div v-if="card.trend" class="card-trend">
          <i 
            :class="`pi ${card.trend > 0 ? 'pi-arrow-up' : 'pi-arrow-down'}`"
            :style="{ color: card.trend > 0 ? '#10b981' : '#ef4444' }"
          ></i>
          <span :style="{ color: card.trend > 0 ? '#10b981' : '#ef4444' }">
            {{ Math.abs(card.trend) }}%
          </span>
        </div>
      </div>

      <!-- Loading Overlay -->
      <div v-if="loading" class="card-loading">
        <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
      </div>
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

const displayCards = computed(() => {
  if (!props.config.cards) return [];
  
  return props.config.cards.map(card => ({
    ...card,
    value: card.value !== undefined ? card.value : data.value[card.field],
    trend: card.trendField ? data.value[card.trendField] : card.trend
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
    console.error('Failed to load card data:', error);
  } finally {
    loading.value = false;
  }
}

// Format value
function formatValue(card) {
  let value = card.value;
  
  if (value === null || value === undefined) return '-';
  
  // Apply formatting
  if (card.decimals !== undefined) {
    value = Number(value).toFixed(card.decimals);
  }
  
  // Add prefix/suffix
  return `${card.prefix || ''}${value}${card.suffix || ''}`;
}

// Setup auto-refresh
function setupRefresh() {
  if (props.config.refreshInterval) {
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
.universal-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.stat-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background: white;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  border-left-width: 4px;
  transition: box-shadow 0.2s;
}

.stat-card:hover {
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
}

.card-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
}

.card-icon i {
  font-size: 1.5rem;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.card-title {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.card-value {
  font-size: 1.5rem;
  color: #111827;
  font-weight: 700;
}

.card-trend {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  margin-top: 0.25rem;
}

.card-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

@media (max-width: 768px) {
  .universal-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>