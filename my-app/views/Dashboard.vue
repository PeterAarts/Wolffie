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
          :key="period.value"
          :class="['period-tab', { active: activePeriod === period.value }]"
          @click="activePeriod = period.value"
        >
          {{ period.label }}
        </button>
      </div>

      <EnergyFlowGraph 
        :period="graphPeriod"
        :auto-update="activePeriod === 'day'"
        :height="'300px'"
        :granularity="graphGranularity"
      />

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
        <div v-if="realtimeStore.isConnected" class="source-indicators">
            <i v-if="realtimeStore.connectionSource === 'cloud'" class="pi pi-cloud color-secondary" title="Cloud API"></i>
            <i v-if="realtimeStore.connectionSource === 'modbus'" class="pi pi-server color-secondary" title="Local ModBus"></i>
        </div>
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
            <div v-if="strategyStore.targetBufferSoc" class="buffer">
              <div class="breakdown-detail">Doel buffer: {{ parseFloat(strategyStore.formattedTargetBuffer || 0).toFixed(2) }} kWh</div>
            </div>
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

        <!-- Home Usage Card - Clickable -->
        <div class="breakdown-card even clickable" @click="toggleSocketsList">
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
          <div class="click-hint">
            <i class="pi pi-info-circle"></i>
            <span>Klik voor details</span>
          </div>
        </div>

      </div>

      <!-- Energy Sockets List - Hidden by default, shown when Home card clicked -->
      <transition name="slide-down">
        <div v-if="showSocketsList" class="sockets-container">
          <EnergySocketsList @socket-selected="onSocketSelected" />
        </div>
      </transition>
    </div>

    <!-- Remove Daily Summary Section - info now on cards -->
    <Toast />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import { useRealtimeStore } from '../stores/realtime';
import Toast from 'primevue/toast';
import { formatPower } from '@/utils/formatters';
import EnergyFlowGraph from '@/components/common/EnergyFlowGraph.vue';
import EnergySocketsList from '@/components/EnergySocketsList.vue';
import { useStrategyStore } from '@/stores/strategy';



const systemStore   = useSystemStore();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();

// Period selection
const periods = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' }
];
const activePeriod = ref('day');
const showSocketsModal = ref(false);
// Computed properties for graph configuration
const graphPeriod = computed(() => {
  switch (activePeriod.value) {
    case 'day':
      return 'today';
    case 'week':
      return 'last-7-days';
    case 'month':
      return 'last-30-days';
    case 'year':
      return 'last-365-days';
    default:
      return 'today';
  }
});

const graphGranularity = computed(() => {
  switch (activePeriod.value) {
    case 'day':
      return 15;  // 15-minute intervals for day view
    case 'week':
      return 60;  // 1-hour intervals for week view
    case 'month':
      return 360; // 6-hour intervals for month view
    case 'year':
      return 1440; // 24-hour intervals for year view
    default:
      return 15;
  }
});

// Chart data - stores last 60 data points (10 minutes at 10-second intervals)
const chartData = ref([]);
const maxDataPoints = 60;
const realtimeSOC = computed(() => {
  // Get SOC from WebSocket if available
  if (systemStore.realtimeData?.batterySOC !== undefined) {
    return systemStore.realtimeData.batterySOC;
  }
  // Fallback to status
  return systemStore.status?.battery?.soc || 0;
});

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

// Watch for WebSocket updates from systemStore
watch(() => systemStore.realtimeData, (newData) => {
  if (newData?.components?.home_usage?.currentIn) {
    updateChartData(newData.components.home_usage.currentIn);
  }
  
  // Debug logging for battery SOC
  console.log('SystemStore Battery SOC:', newData?.batterySOC);
  console.log('Status Battery SOC:', systemStore.status?.battery?.soc);
}, { deep: true });

// Also watch realtimeStore as fallback
watch(() => realtimeStore.realtimeData, (newData) => {
  if (newData?.components?.home_usage?.currentIn && !systemStore.realtimeData) {
    updateChartData(newData.components.home_usage.currentIn);
  }
}, { deep: true });

// Current real-time values from WebSocket
const currentBatterySOC = computed(() => {
  // Try systemStore realtime data first (WebSocket data)
  if (systemStore.realtimeData?.batterySOC !== undefined && systemStore.realtimeData.batterySOC !== null) {
    return Math.round(systemStore.realtimeData.batterySOC);
  }
  // Try realtimeStore data
  if (realtimeStore.realtimeData?.batterySOC !== undefined && realtimeStore.realtimeData.batterySOC !== null) {
    return Math.round(realtimeStore.realtimeData.batterySOC);
  }
  // Fallback to systemStore status
  if (systemStore.status?.battery?.soc !== undefined) {
    return Math.round(systemStore.status.battery.soc);
  }
  return 0;
});

const currentBatteryPower = computed(() => {
  // Try systemStore realtime data
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components) {
    const batteryOut = realtimeData.components.battery_1?.currentOut || 0;
    const batteryIn = realtimeData.components.battery_1?.currentIn || 0;
    // Negative = discharging, Positive = charging
    return batteryIn - batteryOut;
  }
  // Fallback to systemStore status
  return systemStore.status?.battery?.power || 0;
});

const currentSolarPower = computed(() => {
  // Try systemStore realtime data
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components) {
    const solar1 = realtimeData.components.solar_1?.currentOut || 0;
    const solar2 = realtimeData.components.solar_2?.currentOut || 0;
    const solar3 = realtimeData.components.solar_3?.currentOut || 0;
    return solar1 + solar2 + solar3;
  }
  // Fallback to systemStore status
  return systemStore.status?.pv?.power || 0;
});

const currentGridPower = computed(() => {
  // Try systemStore realtime data
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components?.grid) {
    const gridIn = realtimeData.components.grid.currentIn || 0;
    const gridOut = realtimeData.components.grid.currentOut || 0;
    // Positive = importing, Negative = exporting
    return gridIn - gridOut;
  }
  // Fallback to systemStore status
  return systemStore.status?.grid?.power || 0;
});

const currentHomePower = computed(() => {
  // Try systemStore realtime data
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components?.home_usage) {
    return realtimeData.components.home_usage.currentIn || 0;
  }
  // Fallback to systemStore status
  return systemStore.status?.load?.power || 0;
});

// Battery status
const batteryStatus = computed(() => {
  const power = currentBatteryPower.value;
  if (power > 50) return 'Charging';
  if (power < -50) return 'Discharging';
  return 'Idle';
});

// Grid status
const gridStatus = computed(() => {
  const power = currentGridPower.value;
  return formatPowerValue(Math.abs(power));
});

const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50) return 'Importing';
  if (power < -50) return 'Exporting';
  return 'Idle';
});

// Sockets list visibility
const showSocketsList = ref(false);

// Toggle sockets list visibility
const toggleSocketsList = () => {
  showSocketsList.value = !showSocketsList.value;
};

// Handle socket selection (for future use - historical graphs)
const onSocketSelected = (socket) => {
  console.log('Socket selected:', socket);
  // Future: Show historical graph for this socket
};

// Format power value
const formatPowerValue = (watts) => {
  if (Math.abs(watts) >= 1000) {
    return `${(watts / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(watts)} W`;
};

// Chart points for SVG polyline
const chartPoints = computed(() => {
  if (chartData.value.length < 2) {
    // Return flat line if not enough data
    return '0,40 300,40';
  }
  
  const points = chartData.value.map((value, index) => {
    const x = (index / (chartData.value.length - 1)) * 300;
    const maxValue = Math.max(...chartData.value, 1); // Avoid division by zero
    const y = 80 - (value / maxValue) * 60;
    return `${x},${y}`;
  });
  return points.join(' ');
});

// Chart time labels - show time range based on data points
const chartTimeLabels = computed(() => {
  const now = new Date();
  const minutesAgo = chartData.value.length * (10 / 60); // 10 seconds per point
  
  const times = [];
  for (let i = 0; i < 5; i++) {
    const time = new Date(now - (minutesAgo * 60000 * (4 - i) / 4));
    times.push(time.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }));
  }
  return times;
});

// Update current time
const updateCurrentTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('nl-NL', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
};

// Auto-refresh
let refreshInterval = null;
let timeInterval = null;

onMounted(async () => {
  await realtimeStore.initialize();
  await systemStore.fetchStatus();
  
  // Initialize chart with current data from either store
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components?.home_usage?.currentIn) {
    updateChartData(realtimeData.components.home_usage.currentIn);
  }
  
  // Update time every second
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
  
  if (realtimeStore.isConnected) {
    refreshInterval = setInterval(() => {
      systemStore.fetchStatus();
    }, 10000);
  }
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  if (timeInterval) {
    clearInterval(timeInterval);
  }
});
</script>

<style scoped>
.dashboard-container {
  padding: 0;
  max-width: 100%;
  height: calc(100vh - 6rem);
  background: var(--color-bg-secondary);
}

/* Hero Card - No borders, seamless */
.hero-card {
  background: var(--color-bg-secondary);
  padding: var(--gap-xl);
}

.hero-header {
  margin-bottom: var(--gap-sm);
}

.hero-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hero-value {
  font-size: 5rem;
  font-weight:500;
  line-height: 1;
  color: var(--color-text-primary);
  margin-bottom: var(--gap-lg);
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
  align-items: left;
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

/* Home Summary Card */
.home-summary {
  display: flex;
  align-items: center;
  padding: var(--gap-xl);
  background: var(--color-bg-primary);
  border-bottom: 2px solid var(--color-border);
  position: relative;
}

.home-summary.clickable {
  cursor: pointer;
  transition: all 0.3s ease;
}

.home-summary.clickable:hover {
  background: var(--color-bg-hover, #f9fafb);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.home-summary.clickable:active {
  transform: translateY(0);
}

/* Clickable breakdown card */
.breakdown-card.clickable {
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.breakdown-card.clickable:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.1);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, transparent 100%), var(--color-bg-primary);
}

.breakdown-card.clickable.even:hover {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.02) 0%, transparent 100%), #fff;
}

.breakdown-card.clickable:active {
  transform: translateY(0);
}

.click-hint {
  position: absolute;
  bottom: 0.75rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: #10b981;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.breakdown-card.clickable:hover .click-hint,
.home-summary.clickable:hover .click-hint {
  opacity: 1;
}

.click-hint i {
  font-size: 0.875rem;
}

.summary-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-icon i {
  font-size: 1.75rem;
  color: var(--color-text-primary);
}

.summary-content {
  flex: 1;
  min-width: 0;
  margin-left: 1rem;
}

.summary-label {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--gap-xs);
}

.summary-detail {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.summary-value {
  text-align: right;
  flex-shrink: 0;
}

.value-large {
  font-size: var(--font-size-3xl);
  font-weight: 500;
  line-height: 1;
  color: var(--color-text-primary);
  margin-bottom: var(--gap-xs);
}

.value-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Sockets container */
.sockets-container {
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
}

/* Slide down transition */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 600px;
  opacity: 1;
}

@media (min-width: 1400px) {
  .dashboard-container {

    margin: 0 auto;
  }
}
</style>