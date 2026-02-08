<template>
  <div class="dashboard-container">
    
    <!-- Hero Card - Total Consumption -->
    <div class="hero-card">
      <div class="hero-header">
        <span class="hero-label">Total Consumed</span>
      </div>
      <div class="hero-value">
        {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }}
        <span class="hero-unit"> kWh</span>
      </div>
      
      <!-- Time Period Tabs -->
      <div class="period-tabs">
        <button 
          v-for="period in periods" 
          :key="period"
          :class="['period-tab', { active: activePeriod === period }]"
          @click="activePeriod = period"
        >
          {{ period }}
        </button>
      </div>

      <!-- Simple Line Chart - Real-time data -->
      <div class="chart-area">
        <svg class="line-chart" viewBox="0 0 300 80" preserveAspectRatio="none">
          <polyline
            :points="chartPoints"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
        </svg>
        <div class="chart-labels">
          <span>{{ chartTimeLabels[0] }}</span>
          <span>{{ chartTimeLabels[1] }}</span>
          <span>{{ chartTimeLabels[2] }}</span>
          <span>{{ chartTimeLabels[3] }}</span>
          <span>{{ chartTimeLabels[4] }}</span>
        </div>
      </div>

      <!-- Energy Stats Row -->
      <div class="energy-stats">
        <div class="energy-stat">
          <div class="energy-value">{{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(1) }} kWh</div>
          <div class="energy-label">Produced</div>
        </div>
        <div class="energy-stat">
          <div class="energy-value">{{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(1) }} kWh</div>
          <div class="energy-label">Exported</div>
        </div>
        <div class="energy-stat">
          <div class="energy-value">{{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(1) }} kWh</div>
          <div class="energy-label">Battery</div>
        </div>
      </div>
    </div>

    <!-- Consumed Breakdown Section -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Current Power</h2>
        <div class="current-time">{{ currentTime }}</div>
      </div>

      <!-- Consumption Breakdown Cards -->
      <div class="breakdown-cards">
        
        <!-- Battery Card -->
        <div class="breakdown-card">
          <div class="breakdown-icon"><i class="pi pi-bolt"></i></div>
          <div class="breakdown-content">
            <div class="breakdown-name">Battery</div>
            <div class="breakdown-detail">Opgeladen: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
            <div class="breakdown-detail">Ontladen: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
          </div>
          <div class="breakdown-percentage">
            <div class="percentage-large">{{ currentBatterySOC }}%</div>
            <div class="percentage-label">{{ batteryStatus }}</div>
          </div>
        </div>

        <!-- Solar Card -->
        <div class="breakdown-card even">
          <div class="breakdown-icon"><i class="pi pi-sun"></i></div>
          <div class="breakdown-content">
            <div class="breakdown-name">Solar</div>
            <div class="breakdown-detail">Productie: {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(2) }} kWh</div>
            <div class="breakdown-detail">Huidig: {{ formatPowerValue(currentSolarPower) }}</div>
          </div>
          <div class="breakdown-percentage">
            <div class="percentage-large">{{ formatPowerValue(currentSolarPower) }}</div>
            <div class="percentage-label">Live</div>
          </div>
        </div>

        <!-- Grid Card -->
        <div class="breakdown-card">
          <div class="breakdown-icon"><i class="pi pi-server"></i></div>
          <div class="breakdown-content">
            <div class="breakdown-name">Grid</div>
            <div class="breakdown-detail">Injectie: {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(2) }} kWh</div>
            <div class="breakdown-detail">Verbruikt: {{ parseFloat(realtimeStore.summaryData.today_grid_import || 0).toFixed(2) }} kWh</div>
          </div>
          <div class="breakdown-percentage">
            <div class="percentage-large">{{ formatPowerValue(Math.abs(currentGridPower)) }}</div>
            <div class="percentage-label">{{ gridDirection }}</div>
          </div>
        </div>

        <!-- Home Usage Card -->
        <div class="breakdown-card even">
          <div class="breakdown-icon"><i class="pi pi-home"></i></div>
          <div class="breakdown-content">
            <div class="breakdown-name">Home</div>
            <div class="breakdown-detail">Verbruikt: {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }} kWh</div>
            <div class="breakdown-detail">Huidig: {{ formatPowerValue(currentHomePower) }}</div>
          </div>
          <div class="breakdown-percentage">
            <div class="percentage-large">{{ formatPowerValue(currentHomePower) }}</div>
            <div class="percentage-label">Live</div>
          </div>
        </div>

      </div>
    </div>

    <Toast />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRealtimeStore } from '../stores/realtime';
import Toast from 'primevue/toast';
import { formatPower } from '@/utils/formatters';

const realtimeStore = useRealtimeStore();

// Period selection
const periods = ['Day', 'Week', 'Month', 'Year'];
const activePeriod = ref('Day');

// Chart data - stores last 60 data points (10 minutes at 10-second intervals)
const chartData = ref([]);
const maxDataPoints = 60;

// Current time display
const currentTime = ref('');

// Update chart with new data from WebSocket
const updateChartData = (newPower) => {
  const power = newPower / 1000; // Convert W to kW
  chartData.value.push(power);
  
  // Keep only last 60 points
  if (chartData.value.length > maxDataPoints) {
    chartData.value.shift();
  }
};

// Watch for WebSocket updates - use realtimeStore's loadPower
watch(() => realtimeStore.loadPower, (newPower) => {
  if (newPower !== undefined && newPower !== null) {
    updateChartData(newPower);
  }
});

// Current real-time values using realtimeStore's computed properties
const currentBatterySOC = computed(() => {
  return Math.round(realtimeStore.batterySOC || 0);
});

const currentBatteryPower = computed(() => {
  return realtimeStore.batteryPower || 0;
});

const currentSolarPower = computed(() => {
  return realtimeStore.solarPower || 0;
});

const currentGridPower = computed(() => {
  return realtimeStore.gridPower || 0;
});

const currentHomePower = computed(() => {
  return realtimeStore.loadPower || 0;
});

// Battery status
const batteryStatus = computed(() => {
  const power = currentBatteryPower.value;
  if (power > 50) return 'Charging';
  if (power < -50) return 'Discharging';
  return 'Idle';
});

// Grid direction
const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50) return 'Import';
  if (power < -50) return 'Export';
  return 'Idle';
});

// Format power value with W or kW
const formatPowerValue = (watts) => {
  if (watts === undefined || watts === null) return '0 W';
  if (Math.abs(watts) >= 1000) {
    return `${(watts / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(watts)} W`;
};

// Generate chart points from data
const chartPoints = computed(() => {
  if (chartData.value.length === 0) {
    return '0,80 300,80'; // Flat line at bottom when no data
  }
  
  const maxValue = Math.max(...chartData.value, 1); // Prevent division by zero
  const width = 300;
  const height = 80;
  const stepX = width / (maxDataPoints - 1);
  
  return chartData.value.map((value, index) => {
    const x = index * stepX;
    const y = height - (value / maxValue) * height;
    return `${x},${y}`;
  }).join(' ');
});

// Generate time labels for chart
const chartTimeLabels = computed(() => {
  const now = new Date();
  const labels = [];
  
  for (let i = 4; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 2.5 * 60000); // 2.5 minute intervals
    labels.push(time.toLocaleTimeString('nl-NL', { 
      hour: '2-digit', 
      minute: '2-digit' 
    }));
  }
  
  return labels;
});

// Update current time
const updateCurrentTime = () => {
  currentTime.value = new Date().toLocaleTimeString('nl-NL', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
};

// Initialize
onMounted(async () => {
  console.log('📊 Dashboard mounted');
  
  // Initialize realtime store
  await realtimeStore.initialize();
  
  console.log('RealtimeStore initialized');
  console.log('Connection:', realtimeStore.connectionInfo);
  console.log('Current values:', {
    batterySOC: realtimeStore.batterySOC,
    batteryPower: realtimeStore.batteryPower,
    solarPower: realtimeStore.solarPower,
    gridPower: realtimeStore.gridPower,
    loadPower: realtimeStore.loadPower
  });
  
  // Update current time
  updateCurrentTime();
  const timeInterval = setInterval(updateCurrentTime, 1000);
  
  // Cleanup on unmount
  onUnmounted(() => {
    clearInterval(timeInterval);
    realtimeStore.cleanup();
  });
});
</script>

<style scoped>
/* Global Dashboard Styles */
.dashboard-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-bg-secondary);
}

/* Hero Card */
.hero-card {
  padding: var(--gap-2xl);
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border);
}

.hero-header {
  margin-bottom: var(--gap-xl);
}

.hero-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hero-value {
  font-size: 4.5rem;
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  line-height: 1;
  margin-bottom: var(--gap-xl);
  letter-spacing: -0.23rem;
}

.hero-unit {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-left: var(--gap-sm);
  letter-spacing: 0rem;
}

/* Period Tabs */
.period-tabs {
  display: flex;
  gap: var(--gap-sm);
  margin-bottom: var(--gap-xl);
}

.period-tab {
  padding: var(--gap-sm) var(--gap-lg);
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
}

.period-tab.active {
  background: var(--color-bg-black);
  color: var(--color-text-white);
}

/* Chart */
.chart-area {
  margin-bottom: var(--gap-xl);
}

.line-chart {
  width: 100%;
  height: 80px;
  color: var(--color-text-primary);
  margin-bottom: var(--gap-sm);
}

.chart-labels {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* Energy Stats */
.energy-stats {
  display: flex;
  gap: var(--gap-lg);
  padding-top: var(--gap-lg);
}

.energy-stat {
  flex: 1;
  padding: 0.5rem;
  background-color: var(--color-bg-primary);
}

.energy-value {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin-bottom: var(--gap-xs);
}

.energy-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

/* Section Header */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-lg) var(--gap-xl);
  background: var(--color-bg-secondary);
}

.section-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: 0;
}

.current-time {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  font-family: 'Courier New', monospace;
}

.section-dropdown {
  padding: var(--gap-sm) var(--gap-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

/* Breakdown Cards - No borders */
.breakdown-cards {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary);
}

.breakdown-card {
  display: flex;
  align-items: center;
  padding: var(--gap-xl);
  background: var(--color-bg-primary);
  border: none;
  transition: all 0.2s ease;
}
.breakdown-card.even {
  display: flex;
  align-items: center;
  padding: var(--gap-xl);
  background: #fff;
  border: none;
  transition: all 0.2s ease;
}

.breakdown-card:active {
  transform: scale(0.98);
}

.card-dark {
  background: var(--color-bg-black);
  color: var(--color-text-white);
}

.card-dark .breakdown-name,
.card-dark .breakdown-power,
.card-dark .percentage-large,
.card-dark .percentage-label {
  color: var(--color-text-white);
}

.card-accent {
  background: var(--color-accent);
  color: var(--color-bg-black);
}

.card-accent .breakdown-name,
.card-accent .breakdown-power,
.card-accent .percentage-large,
.card-accent .percentage-label {
  color: var(--color-bg-black);
}

.breakdown-icon {
  font-size: 2rem;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.breakdown-icon i {
  font-size: 1.75rem;
  color: var(--color-text-primary);
}

.breakdown-content {
  flex: 1;
  min-width: 0;
  margin-left: 1rem;
}

.breakdown-name {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--gap-xs);
}

.breakdown-detail {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.breakdown-power {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.breakdown-percentage {
  text-align: right;
  flex-shrink: 0;
}

.percentage-large {
  font-size: var(--font-size-3xl);
  font-weight: 500;
  line-height: 1;
  color: var(--color-text-primary);
  margin-bottom: var(--gap-xs);
}

.percentage-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* Responsive */
@media (min-width: 768px) {
  .breakdown-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
  .percentage-large {
    font-size: var(--font-size-xl);
  }
}

@media (min-width: 1024px) {
  .dashboard-container {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 0;
  }
  
  /* Hero card takes left column, full height */
  .hero-card {
    grid-row: 1 / 3;
    border-right: 1px solid var(--color-border);
    border-bottom: none;
  }
  
  /* Section header in right column */
  .section-header {
    grid-column: 2;
    border-bottom: 1px solid var(--color-border);
  }
  
  /* Breakdown cards stack vertically in right column */
  .breakdown-cards {
    grid-column: 2;
    display: flex;
    flex-direction: column;
  }
}

@media (min-width: 1400px) {
  .dashboard-container {

    margin: 0 auto;
  }
}
</style>