<template>
  <div class="bg-gray-100 lg:grid lg:grid-cols-4 lg:gap-0 overflow-hidden text-[#111827]">
    
    <div class="hero-card lg:col-span-3 p-6 lg:p-10 bg-gray-100 overflow-y-auto">
      <div class="hero-header mb-2">
        <span class="text-xs font-medium bold text-gray-500 lowercase tracking-widest">Total Consumed</span>
      </div>
      <div class="flex gap-4 ">
        <div class="hero-value flex-2  font-bold leading-none tracking-tighter mb-8">
          {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }}
          <span class="text-base font-medium text-gray-500 ml-2 tracking-normal">kWh</span>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs  text-gray-400 lowercase tracking-wider">Produced</div>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">Exported</div>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">Battery</div>
        </div>
      
        </div>
      <div class="flex gap-2 mb-8 mt-8 hidden lg:block">
      <!--  <button 
          v-for="period in periods" 
          :key="period.value"
          @click="activePeriod = period.value"
          class="p-2 text-sm font-bold transition-all"
          :class="activePeriod === period.value ? 'bg-black text-white' : 'bg-transparent text-gray-500 hover:bg-gray-100'"
        >
          {{ period.label }}
        </button>-->

        <EnergyFlowGraph 
          :period="graphPeriod"
          :auto-update="activePeriod === 'day'"
          :height="'350px'"
          :granularity="graphGranularity"
        />
      </div>

    </div>

    <div class="right-section flex flex-col bg-white p-4 ">
      <div class="flex justify-between items-center p-4 border-b border-gray-200 bg-white">
        <h2 class="text-xl font-bold m-0  tracking-tight">Current Power</h2>
        <div class="flex items-center gap-4">
          <div v-if="realtimeStore.isConnected" class="flex items-center gap-2">
              <i v-if="realtimeStore.connectionSource === 'cloud'" class="fa-light fa-cloud text-gray-400" title="Cloud API"></i>
              <i v-if="realtimeStore.connectionSource === 'modbus'" class="fa-light fa-server text-gray-400" title="Local ModBus"></i>
          </div>
          <div class="text-sm text-gray-500 font-medium">{{ currentTime }}</div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <transition 
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-150 ease-in"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <div v-if="!showSocketsList" key="power-cards" class="flex flex-col bg-gray-100">
            
            <div class="flex items-center p-6 lg:p-8 bg-white transition-all">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-battery-bolt "></i>
              </div>
              <div class="flex-1 ms-4 min-w-0">
                <div class="text-base font-bold text-gray-900">Battery ({{ currentBatterySOC }}%)</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Opgeladen: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Ontladen: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
                <div v-if="strategyStore.targetBufferSoc" class="mt-1">
                  <div class="text-xs text-blue-600 font-bold">Doel buffer: {{ parseFloat(strategyStore.formattedTargetBuffer || 0).toFixed(2) }} kWh</div>
                </div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ currentBatteryPower }} W</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">{{ batteryStatus }}</div>
              </div>
            </div>

            <div class="flex items-center p-6 lg:p-8 bg-gray-100 transition-all">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-sun-bright"></i>
              </div>
              <div class="flex-1 ml-4 min-w-0">
                <div class="text-base font-bold text-gray-900">Solar</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Productie: {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(currentSolarPower) }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">Live</div>
              </div>
            </div>

            <div class="flex items-center p-6 lg:p-8 bg-white transition-all">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-utility-pole"></i>
              </div>
              <div class="flex-1 ml-4 min-w-0">
                <div class="text-base font-bold text-gray-900">Grid</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Teruglevering: {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(2) }} kWh</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Verbruikt: {{ parseFloat(realtimeStore.summaryData.today_grid_import || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(Math.abs(currentGridPower)) }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">{{ gridDirection }}</div>
              </div>
            </div>

            <div @click="toggleSocketsList" class="flex items-center p-6 lg:p-8 bg-gray-100 cursor-pointer hover:bg-gray-100 transition-all group relative">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-plug-circle-bolt"></i>
              </div>
              <div class="flex-1 ml-4 min-w-0">
                <div class="text-base font-bold text-gray-900">Home</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">Verbruikt: {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(currentHomePower) }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">Live</div>
              </div>
              <div class="absolute bottom-2 right-4 flex items-center gap-1.5 text-[10px] font-bold text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <i class="fa-duotone fa-circle-info"></i>
                <span>click for details</span>
              </div>
            </div>

          </div>

          <div v-else key="devices-list" class="flex flex-col bg-white h-full">
            <div class="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-100">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-plug-circle-bolt"></i>
              </div>
              <div class="flex-1 ml-4 min-w-0">
                <div class="text-base font-bold text-gray-900">Home</div>
              </div>  
              <button @click="toggleSocketsList" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
                <i class="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <EnergySocketsList @socket-selected="onSocketSelected" />
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import { useRealtimeStore } from '../stores/realtime';
import { useStrategyStore } from '@/stores/strategy';
import { useLocale } from '../composables/useLocale';

// Components
import EnergyFlowGraph from '@/components/common/EnergyFlowGraph.vue';
import EnergySocketsList from '@/components/EnergySocketsList.vue';

const systemStore   = useSystemStore();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

// PERIOD LOGIC: EXACTLY AS PER YOUR CODE
const periods = [
  { value: 'day', label: t('dashboard.periodDay') },
  { value: 'week', label: t('dashboard.periodWeek')  },
  { value: 'month', label: t('dashboard.periodMonth')  },
  { value: 'year', label: t('dashboard.periodYear')  }
];
const activePeriod = ref('day');

const graphPeriod = computed(() => {
  switch (activePeriod.value) {
    case 'day': return 'today';
    case 'week': return 'last-7-days';
    case 'month': return 'last-30-days';
    case 'year': return 'last-365-days';
    default: return 'today';
  }
});

const graphGranularity = computed(() => {
  switch (activePeriod.value) {
    case 'day': return 15;
    case 'week': return 60;
    case 'month': return 360;
    case 'year': return 1440;
    default: return 15;
  }
});

// REAL-TIME COMPUTEDS: STRICTLY FROM YOUR DASHBOARD.VUE
const currentBatterySOC = computed(() => {
  if (systemStore.realtimeData?.batterySOC !== undefined && systemStore.realtimeData.batterySOC !== null) {
    return Math.round(systemStore.realtimeData.batterySOC);
  }
  if (realtimeStore.realtimeData?.batterySOC !== undefined && realtimeStore.realtimeData.batterySOC !== null) {
    return Math.round(realtimeStore.realtimeData.batterySOC);
  }
  if (systemStore.status?.battery?.soc !== undefined) {
    return Math.round(systemStore.status.battery.soc);
  }
  return 0;
});

const currentBatteryPower = computed(() => {
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components) {
    const batteryOut = realtimeData.components.battery_1?.currentOut || 0;
    const batteryIn = realtimeData.components.battery_1?.currentIn || 0;
    return batteryIn - batteryOut;
  }
  return systemStore.status?.battery?.power || 0;
});

const currentSolarPower = computed(() => {
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
 /*if (realtimeData?.components) {
    const solar1 = realtimeData.components.solar_1?.currentOut || 0;
    const solar2 = realtimeData.components.solar_2?.currentOut || 0;
    const solar3 = realtimeData.components.solar_3?.currentOut || 0;
    return solar1 + solar2 + solar3;
  }*/
  return realtimeData.components.solar?.currentOut || 0;
});

const currentGridPower = computed(() => {
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components?.grid) {
    const gridIn = realtimeData.components.grid.currentIn || 0;
    const gridOut = realtimeData.components.grid.currentOut || 0;
    return gridIn - gridOut;
  }
  return systemStore.status?.grid?.power || 0;
});

const currentHomePower = computed(() => {
  const realtimeData = systemStore.realtimeData || realtimeStore.realtimeData;
  if (realtimeData?.components?.home_usage) {
    return realtimeData.components.home_usage.currentIn || 0;
  }
  return systemStore.status?.load?.power || 0;
});

const batteryStatus = computed(() => {
  const power = currentBatteryPower.value;
  if (power > 50) return 'Discharging';
  if (power < -50) return 'Charging';
  return 'Idle';
});

const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50) return 'Importing';
  if (power < -50) return 'Exporting';
  return 'Idle';
});

// FUNCTIONS: EXACTLY AS PER YOUR CODE
const showSocketsList = ref(false);
const toggleSocketsList = () => {
  showSocketsList.value = !showSocketsList.value;
};

const onSocketSelected = (socket) => {
  console.log('Socket selected:', socket);
};

const formatPowerValue = (watts) => {
  if (Math.abs(watts) >= 1000) {
    return `${(watts / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(watts)} W`;
};

// TIME & LIFECYCLE: EXACTLY AS PER YOUR CODE
const currentTime = ref('');
const updateCurrentTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('nl-NL', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

let refreshInterval = null;
let timeInterval = null;

onMounted(async () => {
  await realtimeStore.initialize();
  await systemStore.fetchStatus();
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
  
  if (realtimeStore.isConnected) {
    refreshInterval = setInterval(() => {
      systemStore.fetchStatus();
    }, 10000);
  }
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
  if (timeInterval) clearInterval(timeInterval);
});
</script>
<style lang="css" scoped>
.hero-value           {font-size: 5rem}
@media (max-width: 768px) {
  .hero-value         {font-size: 3rem;}
  .hero-card          {height:auto;}
} 
</style>