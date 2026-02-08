<template>
  <div class="dashboard-container">

    <div class="summary-groups-container">
      <div class="summary-group today-group">
        <div class="group-header"><h2 class="group-title">Today</h2></div>
        <div class="group-cards">
          <StatusCard title="Home & Solar" :icon="icons.home" titleClass="blue-text" :stats="homeSolarStats" />
          <StatusCard title="Battery" :icon="icons.battery" titleClass="green-text" :stats="batteryStats" />
          <StatusCard title="Grid" :icon="icons.grid" titleClass="orange-text" :stats="gridStats" />
        </div>
      </div>
      <div class="summary-group total-group">
        <div class="group-header"><h2 class="group-title">Total</h2></div>
        <div class="group-cards">
          <StatusCard title="Economic" :icon="icons.eco" titleClass="orange-text" :stats="economicStats" />
          <StatusCard title="Green" :icon="icons.green" titleClass="green-text" :stats="greenStats" />
        </div>
      </div>
    </div>

    <Card class="diagram-card">
      <template #content>
        <TabView>
          <TabPanel header="Real-time Power Graph">
            <div class="tab-content">
              <div class="diagram-layout">
                <div class="soc-panel-wrapper">
                  <BatteryStatus 
                    :soc="realtimeSOC" 
                    :power="systemStore.status.battery?.power || 0"
                    :voltage="systemStore.status.battery?.voltage"
                    :temperature="systemStore.status.battery?.temperature"
                  />
                </div>
                <div class="diagram-wrapper">
                  <DynamicSystemDiagram :powerData="systemStore.status" />
                </div>
              </div>
              <div class="power-stats">
                <div class="stat-item">
                  <span class="stat-label">Grid:</span>
                  <span class="stat-value" :class="gridStatusClass">{{ formatPower(systemStore.status.grid.power) }}</span>
                  <span class="stat-status">{{ gridStatus }}</span>
                </div>
                </div>
            </div>
          </TabPanel>
          <TabPanel header="Energy Diagram">
            <div class="tab-content">
              <div class="tab-header">
                <Calendar v-model="energyDateRange" selectionMode="range" dateFormat="yy-mm-dd" />
              </div>
              <EnergyFlowDiagram :data="energyFlowData" />
            </div>
          </TabPanel>
        </TabView>
      </template>
    </Card>
    <Toast />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '@/stores/system';
import { useRealtimeStore } from '@/stores/realtime';


// Component Imports
import StatusCard from '@/components/common/StatusCard.vue';
import DynamicSystemDiagram from '@/components/dashboard/DynamicSystemDiagram.vue';
import EnergyFlowDiagram from '@/components/dashboard/EnergyFlowDiagram.vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import BatteryStatus from '@/components/dashboard/batteryStatus.vue'; 
import Calendar from 'primevue/calendar';
import Toast from 'primevue/toast';

const systemStore = useSystemStore();
const realtimeStore = useRealtimeStore();

const currentDate = ref(new Date());

// --- Computed properties for diagrams ---
const gridStatus = computed(() => (systemStore.status?.grid?.power || 0) >= 0 ? 'Importing' : 'Exporting');
const gridStatusClass = computed(() => (systemStore.status?.grid?.power || 0) >= 0 ? 'import-color' : 'export-color');
const batteryStatus = computed(() => (systemStore.status?.battery?.power || 0) >= 0 ? 'Charging' : 'Discharging');
const batteryStatusClass = computed(() => (systemStore.status?.battery?.power || 0) >= 0 ? 'charge-color' : 'discharge-color');
const energyDateRange = ref([new Date(), new Date()]); // For the calendar
const energyFlowData = ref({ solar: 0, totalLoad: 0, feedIn: 0 }); // For the flow diagram
const todaySummary = ref({ charged: 0 });

const realtimeSOC = computed(() => {
  // Get SOC from WebSocket if available
  if (systemStore.realtimeData?.batterySOC !== undefined) {
    return systemStore.realtimeData.batterySOC;
  }
  // Fallback to status
  return systemStore.status?.battery?.soc || 0;
});


const homeSolarStats = computed(() => [
  { label: 'Consumed', value: realtimeStore.summaryData.today_load || '0.00', unit: 'kWh' },
  { label: 'Generation', value: realtimeStore.summaryData.today_pv_gen || '0.00', unit: 'kWh' }
]);

const batteryStats = computed(() => [
  { label: 'Charged', value: realtimeStore.summaryData.today_battery_charge || '0.00', unit: 'kWh' },
  { label: 'Discharge', value: realtimeStore.summaryData.today_battery_discharge || '0.00', unit: 'kWh' }
]);

const gridStats = computed(() => [
  { label: 'Feed-in', value: realtimeStore.summaryData.today_grid_export || '0.00', unit: 'kWh' },
  { label: 'Consumed', value: realtimeStore.summaryData.today_grid_import || '0.00', unit: 'kWh' }
]);

const economicStats = computed(() => [
  { label: 'Self-Consumed', value: realtimeStore.summaryData.total_self_consumption || '0', unit: '%' },
  { label: 'Incentive', value: '0.00', unit: '€' }
]);

const greenStats = computed(() => [
  { label: 'Trees Planted', value: realtimeStore.summaryData.total_trees || '0.0', unit: '' },
  { label: 'CO2 Reduction', value: realtimeStore.summaryData.total_co2 || '0.0', unit: 'kg' }
]);

const icons = {
  home: new URL('@/assets/dashboard/stat-home.png', import.meta.url).href,
  battery: new URL('@/assets/dashboard/stat-battery.png', import.meta.url).href,
  grid: new URL('@/assets/dashboard/stat-grid.png', import.meta.url).href,
  eco: new URL('@/assets/dashboard/stat-eco.png', import.meta.url).href,
  green: new URL('@/assets/dashboard/stat-green.png', import.meta.url).href
};

// ✅ ADDED: formatPower function
const formatPower = (power) => {
  if (power === null || power === undefined) return '0 W';
  
  const absolutePower = Math.abs(power);
  
  if (absolutePower >= 1000) {
    return `${(power / 1000).toFixed(2)} kW`;
  }
  
  return `${power.toFixed(0)} W`;
};

const formatDate = (date) => date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

onMounted(async () => {
  await realtimeStore.initialize();
  if (realtimeStore.isConnected) {
    await systemStore.fetchStatus();
  }
});
</script>

<style scoped>
/* Include your existing CSS here */
.summary-groups-container { display: flex; gap: 1.5rem; margin-bottom: 2rem; }
.summary-group { background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e2e8f0; }
.today-group { flex: 3; }
.total-group { flex: 2; }
.group-cards { display: flex; gap: 1rem; justify-content: space-between; }
.group-cards > * { flex: 1; }
.diagram-layout { display: grid; grid-template-columns: 200px 1fr; gap: 2rem; padding: 1rem; }
.power-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 2rem; }
</style>