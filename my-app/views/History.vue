<template>
  <div class="history-page">
    <!-- Header with controls -->
    <div class="history-header">
      <h1>Energy History</h1>
      
      <div class="controls">
        <!-- Period selector -->
        <div class="period-selector">
          <button 
            v-for="period in periods" 
            :key="period.value"
            :class="['period-btn', { active: selectedPeriod === period.value }]"
            @click="selectPeriod(period.value)"
          >
            {{ period.label }}
          </button>
        </div>

        <!-- Date picker (only for custom date) -->
        <div v-if="selectedPeriod === 'date'" class="date-picker">
          <input 
            type="date" 
            v-model="selectedDate"
            :max="maxDate"
            @change="loadData"
          />
        </div>
      </div>
    </div>

    <!-- Main chart - No background card -->
    <div class="chart-wrapper">
      <EnergyFlowGraph 
        :period="selectedPeriod"
        :date="selectedDate"
        :granularity="granularity"
        :height="chartHeight"
        @data-loaded="updateStats"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import EnergyFlowGraph from '@/components/common/EnergyFlowGraph.vue';

// Period options
const periods = [
  { value: 'today', label: 'Today', granularity: 15 },
  { value: 'date', label: 'Custom Date', granularity: 15 },
  { value: 'last-7-days', label: 'Last 7 Days', granularity: 60 },
  { value: 'last-30-days', label: 'Last 30 Days', granularity: 360 },
  { value: 'last-365-days', label: 'Last Year', granularity: 1440 }
];

// State
const selectedPeriod = ref('today');
const selectedDate = ref(getTodayDate());

// Computed
const granularity = computed(() => {
  const period = periods.find(p => p.value === selectedPeriod.value);
  return period ? period.granularity : 15;
});

const maxDate = computed(() => getTodayDate());

const chartHeight = computed(() => '600px');

// Methods
function selectPeriod(period) {
  selectedPeriod.value = period;
  if (period !== 'date') {
    loadData();
  }
}

function loadData() {
  // Data loading is handled by EnergyFlowGraph component
  // We just need to trigger the update through reactive props
}

function updateStats(data) {
  // Stats are now displayed in the chart itself
  // This function can be used for additional processing if needed
  console.log('Data loaded:', data.length, 'points');
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.history-page {
  padding: 24px;
  margin: 0 auto;
  background: #fff;
}

.history-header {
  margin-bottom: 32px;
}

.history-header h1 {
  font-family: 'Rubik', sans-serif;
  font-size: 32px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 24px 0;
}

.controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.period-selector {
  display: flex;
  gap: 8px;
  background: var(--color-bg-secondary);
  padding: 4px;
  border-radius: 8px;
}

.period-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: 'Rubik', sans-serif;
  font-size: 14px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.period-btn:hover {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.period-btn.active {
  background: var(--color-text-primary);
  color: var(--color-bg-primary);
}

.date-picker input {
  padding: 8px 16px;
  border: 1px solid var(--color-text-secondary);
  border-radius: 6px;
  font-family: 'Rubik', sans-serif;
  font-size: 14px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  cursor: pointer;
}

.date-picker input:focus {
  outline: none;
  border-color: var(--color-text-primary);
}

/* Chart Wrapper - No background */
.chart-wrapper {
  background: transparent;
  border-radius: 0;
  padding: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .history-page {
    padding: 16px;
  }

  .history-header h1 {
    font-size: 24px;
  }

  .controls {
    flex-direction: column;
    align-items: stretch;
  }

  .period-selector {
    flex-wrap: wrap;
  }
}
</style>