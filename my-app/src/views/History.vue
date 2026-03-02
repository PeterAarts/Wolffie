<template>
  <div class="history-page bg-gray-100 max-h-screen">
    <!-- Header with controls -->
    <div class="history-header">
      <div class="controls">
        <!-- Period selector -->
        <div class="period-selector mb-4">
          <button 
            v-for="period in periods" 
            :key="period.value"
            :class="['period-btn text-sm font-bold text-gray-500', { active: selectedPeriod === period.value }]"
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

    <!-- Main chart -->
    <div class="chart-wrapper">
      <EnergyFlowGraph 
        :period="selectedPeriod"
        :date="selectedDate"
        :granularity="granularity"
        :height="chartHeight"
        :showStats="true"
        @data-loaded="updateStats"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import EnergyFlowGraph from '@/components/common/EnergyFlowGraph.vue';

// Period options
const periods = [
  { value: 'today', label: 'Today', granularity: 1 },
  { value: 'date', label: 'Custom Date', granularity: 1},
  { value: 'last-7-days', label: 'Last 7 Days', granularity: 60 },
  { value: 'last-30-days', label: 'Last 30 Days', granularity: 360 },
  { value: 'last-365-days', label: 'Last Year', granularity: 1440 }
];

// State
const selectedPeriod = ref('today');
const selectedDate = ref(getTodayDate());
const historyStats = ref(null);

// Computed
const granularity = computed(() => {
  const period = periods.find(p => p.value === selectedPeriod.value);
  return period ? period.granularity : 15;
});

const maxDate = computed(() => getTodayDate());

const chartHeight = computed(() => '400px');

// Methods
function selectPeriod(period) {
  selectedPeriod.value = period;
  if (period !== 'date') {
    loadData();
  }
}

function loadData() {
  // Data loading is handled by EnergyFlowGraph component
  // The reactive props will trigger the update
}

function updateStats(stats) {
  // Store stats from the API response
  historyStats.value = stats;
  console.log('History stats updated:', stats);
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatEnergy(value) {
  if (value === null || value === undefined) return '0.0 kWh';
  return `${value.toFixed(1)} kWh`;
}
</script>

<style scoped>
.history-page {
  padding: 24px;
  margin: 0 auto;
  max-width: 2400px;
  height: calc(100vh - 6rem);
}

.history-header {
  margin-bottom: 24px;
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
  padding: 4px;
  border-radius: 8px;
}

.period-btn {
  padding: 10px 20px;
  border: none;
  background: transparent;
  font-family: 'Rubik', sans-serif;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.period-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--color-text-primary, #111827);
}

.period-btn.active {
  background: var(--color-text-primary, #111827);
  color: var(--color-bg-primary, #ffffff);
  font-weight: 600;
}

.date-picker input {
  padding: 10px 16px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  font-family: 'Rubik', sans-serif;
  font-size: 14px;
  background: var(--color-bg-secondary, #f8f9fa);
  color: var(--color-text-primary, #111827);
  cursor: pointer;
  transition: all 0.2s ease;
}

.date-picker input:hover {
  border-color: rgba(0, 0, 0, 0.2);
}

.date-picker input:focus {
  outline: none;
  border-color: var(--color-text-primary, #111827);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.05);
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

  .controls {
    flex-direction: column;
    align-items: stretch;
  }

  .period-selector {
    flex-wrap: wrap;
    justify-content: center;
  }

  .period-btn {
    padding: 8px 16px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .history-page {
    padding: 12px;
  }

  .period-selector {
    padding: 3px;
    gap: 4px;
  }

  .period-btn {
    padding: 6px 12px;
    font-size: 12px;
  }
}
</style>