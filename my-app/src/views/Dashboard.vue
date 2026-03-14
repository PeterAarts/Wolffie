<template>
  <div class="bg-gray-100 lg:grid lg:grid-cols-4 lg:gap-0 overflow-hidden text-[#111827]">
    
    <div class="hero-card lg:col-span-3 p-6 lg:p-10 bg-gray-100 overflow-y-auto">
      <div class="hero-header mb-2">
        <span class="text-xs font-medium bold text-gray-500 lowercase tracking-widest">{{ t('dashboard.totalConsumed') }}</span>
      </div>
      <div class="flex gap-4 ">
        <div class="hero-value flex-2  font-bold leading-none tracking-tighter mb-8">
          {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }}
          <span class="text-base font-medium text-gray-500 ml-2 tracking-normal">kWh</span>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs  text-gray-400 lowercase tracking-wider">{{ t('dashboard.produced') }}</div>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">{{ t('dashboard.exported') }}</div>
        </div>
        <div class="flex-1 p-4 bg-white h-30">
          <div class="text-2xl font-bold">{{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(1) }}<span class="text-sm font-medium"> kWh</span></div>
          <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">{{ t('dashboard.batteryLabel') }}</div>
        </div>
      
        </div>
      <div class="mt-6 mb-6 hidden lg:block">

        <!-- Date navigation -->
        <div class="date-nav mb-4">
          <button class="date-btn" @click="goToPrevDay">‹</button>
          <span class="date-label">{{ selectedDateLabel }}</span>
          <button class="date-btn" :class="{ disabled: isToday }" @click="goToNextDay">›</button>
        </div>

        <EnergyFlowGraph 
          :period="graphPeriod"
          :date="graphDate"
          :auto-update="isToday"
          :height="'300px'"
          :granularity="15"
        />
      </div>

    </div>

    <div class="right-section flex flex-col bg-white p-4 ">

      <div class="flex-1 overflow-y-auto">
        <transition 
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-150 ease-in"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <div v-if="!showSocketsList" key="power-cards" class="flex flex-col bg-gray-100">
            
            <div class="flex items-center gap-4 p-6 lg:p-8 bg-white transition-all">
              <div class="flex flex-col items-center gap-1">
                <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                  <i class="fa-light fa-battery-bolt"></i>
                </div>
                <div v-if="batteryStatusKey !== 'idle'" class="flow-track" :class="batteryStatusKey">
                  <div class="flow-dot"></div>
                </div>
                <div v-else class="flow-track-placeholder"></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">{{ t('control.battery') }} ({{ currentBatterySOC }}%)</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.batteryCharge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.batteryDischarge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
                <div v-if="strategyStore.targetBufferSoc" class="mt-1">
                  <div class="text-xs text-blue-600 font-bold">{{ t('dashboard.targetBuffer') }}: {{ parseFloat(strategyStore.formattedTargetBuffer || 0).toFixed(2) }} kWh</div>
                </div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ currentBatteryPower }} W</div>
                <div class="text-xs font-mediumbold lowercase tracking-wider mt-1" :class="batteryStatusClass">{{ batteryStatus }}</div>
              </div>
            </div>

            <div class="flex items-center gap-4 p-6 lg:p-8 bg-gray-100 transition-all">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-sun-bright"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">{{ t('control.solar') }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.pvGeneration') }}: {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(currentSolarPower) }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">{{ t('control.live') }}</div>
              </div>
            </div>

            <div class="flex items-center gap-4 p-6 lg:p-8 bg-white transition-all">
              <div class="flex flex-col items-center gap-1">
                <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                  <i class="fa-light fa-utility-pole"></i>
                </div>
                <div v-if="gridStatusKey !== 'idle'" class="flow-track" :class="gridStatusKey">
                  <div class="flow-dot"></div>
                </div>
                <div v-else class="flow-track-placeholder"></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">{{ t('control.grid') }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.gridExport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(2) }} kWh</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.gridImport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_import || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(Math.abs(currentGridPower)) }}</div>
                <div class="text-xs font-mediumbold lowercase tracking-wider mt-1" :class="gridStatusClass">{{ gridDirection }}</div>
              </div>
            </div>

            <div @click="toggleSocketsList" class="flex items-center gap-4 p-6 lg:p-8 bg-gray-100 cursor-pointer hover:bg-gray-100 transition-all group relative">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-plug-circle-bolt"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">{{ t('dashboard.home') }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider ">{{ t('energy.loadConsumption') }}: {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-3xl font-bold leading-none">{{ formatPowerValue(currentHomePower) }}</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider  mt-1">{{ t('control.live') }}</div>
              </div>
              <div class="absolute bottom-2 right-4 flex items-center gap-1.5 text-[10px] font-bold text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <i class="fa-duotone fa-circle-info"></i>
                <span>{{ t('dashboard.clickForDetails') }}</span>
              </div>
            </div>

            <!-- Strategy block — placeholder until backend is wired -->
            <div class="flex items-center gap-4 p-6 lg:p-8 bg-white transition-all">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-layer-group"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">Strategy</div>
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">not configured</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-xs font-mediumbold text-gray-400 lowercase tracking-wider">—</div>
              </div>
            </div>

          </div>

          <div v-else key="devices-list" class="flex flex-col bg-white h-full">
            <div class="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-100">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-gray-800">
                <i class="fa-light fa-plug-circle-bolt"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-gray-900">{{ t('dashboard.home') }}</div>
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

// Date navigation
const selectedDate = ref(new Date());

const isToday = computed(() => {
  const today = new Date();
  const d = selectedDate.value;
  return d.getFullYear() === today.getFullYear() &&
         d.getMonth()    === today.getMonth()    &&
         d.getDate()     === today.getDate();
});

const selectedDateLabel = computed(() => {
  const d = selectedDate.value;
  const formatted = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  if (isToday.value) return 'Vandaag, ' + formatted;
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
});

const goToPrevDay = () => {
  const d = new Date(selectedDate.value);
  d.setDate(d.getDate() - 1);
  selectedDate.value = d;
};

const goToNextDay = () => {
  if (isToday.value) return;
  const d = new Date(selectedDate.value);
  d.setDate(d.getDate() + 1);
  selectedDate.value = d;
};

const graphPeriod = computed(() => isToday.value ? 'today' : 'date');

const graphDate = computed(() => selectedDate.value.toISOString().split('T')[0]);

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
  if (power > 50)  return t('status.discharging');
  if (power < -50) return t('status.charging');
  return t('status.idle');
});

// 'charging' | 'discharging' | 'idle' — drives BatteryIcon animation
const batteryStatusKey = computed(() => {
  const power = currentBatteryPower.value;
  if (power < -50) return 'charging';
  if (power > 50)  return 'discharging';
  return 'idle';
});

// Subtle color on the status label text
const batteryStatusClass = computed(() => {
  switch (batteryStatusKey.value) {
    case 'charging':    return 'text-green-600';
    case 'discharging': return 'text-orange-500';
    default:            return 'text-gray-400';
  }
});

const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return t('status.importing');
  if (power < -50) return t('status.exporting');
  return t('status.idle');
});

// 'importing' | 'exporting' | 'idle' — drives GridIcon animation
const gridStatusKey = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return 'importing';
  if (power < -50) return 'exporting';
  return 'idle';
});

// Subtle color on the status label text
const gridStatusClass = computed(() => {
  switch (gridStatusKey.value) {
    case 'importing': return 'text-orange-500';
    case 'exporting': return 'text-green-600';
    default:          return 'text-gray-400';
  }
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

// fetchStatus polling is handled globally in App.vue — no duplicate interval here.
let timeInterval = null;

onMounted(async () => {
  await realtimeStore.initialize();
  await systemStore.fetchStatus();
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
});
</script>
<style lang="css" scoped>
.hero-value           {font-size: 5rem}
@media (max-width: 768px) {
  .hero-value         {font-size: 3rem;}
  .hero-card          {height:auto;}
}

/* ── Date navigation ──────────────────────────────────────────────── */
.date-nav {
  display: inline-flex;
  align-items: center;
  background: #ffffff;
  border-radius: 0px;
  overflow: hidden;
}
.date-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none;
  font-size: 18px; color: #6b7280;
  cursor: pointer; transition: background .12s;
}
.date-btn:hover       { background: #f3f4f6; }
.date-btn.disabled    { opacity: .3; cursor: default; pointer-events: none; }
.date-label {
  padding: 0 14px; height: 32px;
  display: flex; align-items: center;
  font-size: 13px; font-weight: 500; color: #111827;
  white-space: nowrap;
  border-left: 1px solid #e4e7ec;
  border-right: 1px solid #e4e7ec;
}

/* ── Horizontal flow indicator ───────────────────────────────────── */
.flow-track                         {position: relative;width: 2rem;height: 5px;background: transparent;border-radius: 999px;overflow: hidden;top: -1rem;}
.flow-track-placeholder             {width: 2rem;height: 5px;background-color: transparent;}
.flow-dot                           {position: absolute;top: 0;width: .5rem;height: 5px;border-radius: 999px;}

/* Colors */
.flow-track.charging    .flow-dot,
.flow-track.exporting   .flow-dot   {background: #22c55e; }
.flow-track.discharging .flow-dot,
.flow-track.importing   .flow-dot   {background: #f97316; }

/* Charging / exporting: dot travels left → right */
.flow-track.charging   .flow-dot,
.flow-track.exporting  .flow-dot    {animation: dot-ltr 1.4s ease-in-out infinite; }

/* Discharging / importing: dot travels right → left */
.flow-track.discharging .flow-dot,
.flow-track.importing   .flow-dot   {animation: dot-rtl 1.4s ease-in-out infinite; }

@keyframes dot-ltr {
  0%   { left: -8px;    opacity: 0; }
  15%  {                opacity: 1; }
  85%  {                opacity: 1; }
  100% { left: 100%;    opacity: 0; }
}
@keyframes dot-rtl {
  0%   { left: 100%;    opacity: 0; }
  15%  {                opacity: 1; }
  85%  {                opacity: 1; }
  100% { left: -8px;    opacity: 0; }
}
</style>