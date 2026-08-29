<template>
  <div class="lg:grid lg:grid-cols-4 lg:gap-6 lg:p-6 p-1 overflow-hidden text-primary">
    <!-- ── Left: hero + chart ──────────────────────────────────────────────── -->
    <div class="hero-card lg:col-span-3 p-6 lg:p-10 overflow-y-auto bg-secondary-50" >

      <!-- Hero row: mobile = heroes on row 1, badges on row 2; desktop = heroes left, badges pushed right -->
      <div class="flex flex-col gap-6 lg:flex-row lg:gap-4 lg:items-start">

        <!-- Heroes: total consumed + battery SoC -->
        <div class="flex justify-between gap-6 lg:justify-start lg:gap-10">

          <!-- Total consumed -->
          <div class="shrink-0">
            <div class="mb-2">
              <span class="text-xs font-medium lowercase tracking-widest text-secondary-500">
                {{ t('dashboard.totalConsumed') }}
              </span>
            </div>
            <div class="hero-value font-bold leading-none tracking-tighter">
              {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }}
              <span class="text-base font-medium ml-2 tracking-normal text-secondary-500">kWh</span>
            </div>
          </div>

          <!-- Battery state of charge -->
          <div class="shrink-0">
            <div class="mb-2">
              <span class="text-xs font-medium lowercase tracking-widest text-secondary-500">
                {{ t('control.battery') }}
              </span>
            </div>
            <div class="hero-value font-bold leading-none tracking-tighter">
              {{ currentBatterySOC }}
              <span class="text-base font-medium ml-2 tracking-normal text-secondary-500">%</span>
            </div>
          </div>

        </div>

        <!-- Summary badges -->
        <div class="flex gap-4 lg:gap-6 lg:ml-auto">
          <div class="flex-1 p-4 bg-card rounded-md">
            <div class="text-2xl font-bold text-primary">
              {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(1) }}
              <span class="text-sm font-medium"> kWh</span>
            </div>
            <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('dashboard.produced') }}</div>
          </div>
          <div class="flex-1 p-4 bg-card rounded-md">
            <div class="text-2xl font-bold text-primary">
              {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(1) }}
              <span class="text-sm font-medium"> kWh</span>
            </div>
            <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('dashboard.exported') }}</div>
          </div>
          <div class="flex-1 p-4 bg-card rounded-md">
            <div class="text-2xl font-bold text-primary">
              {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(1) }}
              <span class="text-sm font-medium"> kWh</span>
            </div>
            <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('dashboard.batteryLabel') }}</div>
          </div>
        </div>

      </div>

      <!-- Date nav + both charts (desktop only) -->
      <div class="hidden lg:block mt-6 mb-6">
        <div class="date-nav mb-4">
          <button class="date-btn" @click="goToPrevDay"><i class="ph-light ph-caret-left"></i></button>
          <span class="date-label">{{ selectedDateLabel }}</span>
          <button class="date-btn" :class="{ disabled: isToday }" @click="goToNextDay"><i class="ph-light ph-caret-right"></i></button>
        </div>

        <EnergyFlowGraph
          :period="graphPeriod"
          :date="graphDate"
          :auto-update="isToday"
          :height="'300px'"
          :granularity="5"
        />

      </div>

    </div>

    <!-- ── Right: power cards ──────────────────────────────────────────────── -->
    <div class="right-section flex flex-col bg-card">
      <div class="flex-1 overflow-y-auto">
        <transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-150 ease-in"
          leave-to-class="opacity-0"
          mode="out-in"
        ><div v-if="!showSocketsList" key="power-cards" class="flex flex-col divide-y divide-secondary-200">

            <!-- Battery -->
            <div class="power-card hover:bg-secondary-100 transition-colors">
              <div class="flex flex-col items-center gap-1 w-12 shrink-0">
                <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary">
                  <i class="ph-light ph-battery-charging"></i>
                </div>
                <div v-if="batteryStatusKey !== 'idle'" class="flow-track" :class="batteryStatusKey">
                  <div class="flow-dot"></div>
                </div>
                <div v-else class="flow-track-placeholder"></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">{{ t('control.battery') }} </div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.batteryCharge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500">{{ t('energy.batteryDischarge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
                <!--<div v-if="strategyStore.targetBufferSoc" class="text-xs font-bold text-blue-600 mt-1">
                  {{ t('dashboard.targetBuffer') }}: {{ parseFloat(strategyStore.formattedTargetBuffer || 0).toFixed(2) }} kWh
                </div>-->
              </div>
              <div class="text-right shrink-0">
                <div class="text-3xl font-bold leading-none text-primary">{{ currentBatteryPower }} W</div>
                <div class="text-xs lowercase tracking-wider mt-1" :class="batteryStatusClass">{{ batteryStatus }}</div>
              </div>
            </div>

            <!-- Solar -->
            <div class="power-card  hover:bg-secondary-100 transition-colors">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
                <i class="ph-light ph-solar-roof"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">{{ t('control.solar') }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.pvGeneration') }}: {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(currentSolarPower) }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('control.live') }}</div>
              </div>
            </div>

            <!-- Grid -->
            <div class="power-card hover:bg-secondary-100 transition-colors">
              <div class="flex flex-col items-center gap-1 w-12 shrink-0">
                <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary">
                  <i class="ph-light ph-circuitry"></i>
                </div>
                <div v-if="gridStatusKey !== 'idle'" class="flow-track" :class="gridStatusKey">
                  <div class="flow-dot"></div>
                </div>
                <div v-else class="flow-track-placeholder"></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">{{ t('control.grid') }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.gridExport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(2) }} kWh</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500">{{ t('energy.gridImport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_import || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(Math.abs(currentGridPower)) }}</div>
                <div class="text-xs lowercase tracking-wider mt-1" :class="gridStatusClass">{{ gridDirection }}</div>
              </div>
            </div>

            <!-- Home / devices -->
            <div @click="toggleSocketsList" class="power-card  hover:bg-secondary-100 transition-colors cursor-pointer group relative">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
                <i class="ph-light ph-house"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">{{ t('dashboard.home') }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.loadConsumption') }}: {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }} kWh</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(currentHomePower) }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('control.live') }}</div>
              </div>
              <div class="absolute bottom-2 right-4 flex items-center gap-1.5 text-[10px] font-bold text-secondary-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <i class="ph-duotone ph-circle-info"></i>
                <span>{{ t('dashboard.clickForDetails') }}</span>
              </div>
            </div>

            <!-- Strategy -->
            <div class="power-card hover:bg-secondary-100 transition-colors cursor-pointer" @click="router.push('/control')">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
                <i class="ph-light ph-strategy"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">Strategy</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">
                  <template v-if="strategyStore.activeStrategy">
                    {{ strategyStore.activeStrategy.name }}
                    <template v-if="strategyNextAction"> · {{ strategyNextAction }}</template>
                  </template>
                  <template v-else>not configured</template>
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-xs lowercase tracking-wider mt-1" :class="strategyModeClass">
                  {{ strategyCurrentMode }}
                </div>
              </div>
            </div>

          </div><div v-else key="devices-list" class="flex flex-col h-full">
            <div class="flex items-center gap-4 p-4 bg-secondary-100 rounded-lg">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
                <i class="ph-light ph-house"></i>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-base font-bold text-primary">{{ t('dashboard.home') }}</div>
              </div>
              <button @click="toggleSocketsList" class="w-8 h-8 flex items-center justify-center rounded-md text-secondary-500 hover:bg-secondary-200 transition-colors">
                <i class="ph-fill ph-xmark text-lg"></i>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <SmartDeviceList @socket-selected="onSocketSelected" />
            </div>
          </div></transition>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useRealtimeStore } from '../stores/realtime';
import { useStrategyStore } from '@/stores/strategy';
import { useLocale } from '../composables/useLocale';
import apiClient from '@/services/api';

// Components
import EnergyFlowGraph      from '@/components/common/EnergyFlowGraph.vue';
import SmartDeviceFlowGraph from '@/components/common/SmartDeviceFlowGraph.vue';
import SmartDeviceList    from '@/components/SmartDeviceList.vue';

const router = useRouter();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

console.log('Dashboard step 1 loaded');
// PERIOD LOGIC: EXACTLY AS PER YOUR CODE
const periods = [
  { value: 'day',   label: t('dashboard.periodDay')   },
  { value: 'week',  label: t('dashboard.periodWeek')  },
  { value: 'month', label: t('dashboard.periodMonth') },
  { value: 'year',  label: t('dashboard.periodYear')  },
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

console.log('Dashboard step 2 loaded');
const graphPeriod = computed(() => isToday.value ? 'today' : 'date');

// Timezone-safe date string — avoids toISOString() which returns UTC and can
// produce the wrong date after midnight CET (UTC+2).
const graphDate = computed(() => {
  const d = selectedDate.value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

// REAL-TIME COMPUTEDS: STRICTLY FROM YOUR DASHBOARD.VUE
const currentBatterySOC = computed(() => {
  return Math.round(realtimeStore.realtimeData?.batterySOC || 0);
});

const currentBatteryPower = computed(() => {
  const components = realtimeStore.realtimeData?.components;
  if (components?.battery_1) {
    return (components.battery_1.currentIn || 0) - (components.battery_1.currentOut || 0);
  }
  return 0;
});

const currentSolarPower = computed(() => {
  return realtimeStore.realtimeData?.components?.solar?.currentOut || 0;
});

const currentGridPower = computed(() => {
  const grid = realtimeStore.realtimeData?.components?.grid;
  if (grid) {
    return (grid.currentIn || 0) - (grid.currentOut || 0);
  }
  return 0;
});

const currentHomePower = computed(() => {
  return realtimeStore.realtimeData?.components?.home_usage?.currentIn || 0;
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
    default:            return 'text-secondary-500';
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
    default:          return 'text-secondary-500';
  }
});

console.log('Dashboard step 3 loaded');
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

console.log('Dashboard step 4 loaded');
// ── Strategy card computeds ────────────────────────────────────────────────
// Current mode label from latest decision (e.g. 'charge', 'hold', 'discharge')
const strategyCurrentMode = computed(() => strategyStore.decision?.action ?? '—');

// Next upcoming slot action from the day plan.
// slot.action is a camelCase key (e.g. 'smartEco') — resolve via i18n if possible.
const strategyNextAction = computed(() => {
  const now = new Date();
  const plan = Array.isArray(strategyStore.dayPlan) ? strategyStore.dayPlan : [];
  const next = plan.find(slot => new Date(slot.start) > now);
  if (!next?.action) return null;
  const key = `control.strategy.${next.action}.name`;
  const resolved = t(key);
  // vue-i18n returns the key itself when missing — fall back to raw action string
  return resolved !== key ? resolved : next.action;
});

// Color the mode label to match battery/grid conventions
const strategyModeClass = computed(() => {
  switch (strategyStore.decision?.action) {
    case 'charge':    return 'text-green-600';
    case 'discharge': return 'text-orange-500';
    default:          return 'text-secondary-500';
  }
});

console.log('Dashboard step 5 loaded');
console.log('Dashboard step 6 loaded');

// ── TIME & LIFECYCLE ───────────────────────────────────────────────────────
const currentTime = ref('');
const updateCurrentTime = () => {
  const now = new Date();
  currentTime.value = now.toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

// fetchStatus polling is handled globally in App.vue — no duplicate interval here.
let timeInterval = null;

onMounted(() => {
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
  strategyStore.fetchActive();
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
  // stopPolling() removed — polling ownership belongs to App.vue
});
</script>

<style lang="css" scoped>
/* Hero value font size — too large for Tailwind's scale */
.hero-value           { font-size: 4rem; }
@media (max-width: 768px) {
  .hero-value         { font-size: 3rem; }
  .hero-card          { height: auto; }
}

/* Power card layout — shared by all 5 cards in the right column */
.power-card                   { display: flex;align-items: center;gap: 1rem;padding: 1.25rem;position: relative;border-radius: var(--radius-md);border : var(--border-width) solid var(--color-secondary-200);margin-bottom: 1rem;}
/* ── Date navigation ──────────────────────────────────────────────── */
.date-nav                     { display: inline-flex;align-items: center;background: var(--color-white);overflow: hidden;}
.date-btn                     { width: 32px; height: 42px;display: flex; align-items: center; justify-content: center;background: none; border: none;font-size: 1rem;line-height: 1rem;color: var(--color-text-secondary);cursor: pointer; transition: background .12s;}
.date-btn:hover               { background: var(--color-secondary-subtle); }
.date-btn.disabled            { opacity: .3; cursor: default; pointer-events: none; }
.date-label                   { padding: 0 14px; height: 32px;display: flex; align-items: center;font-size: 13px; font-weight: 500;color: var(--color-text-primary);white-space: nowrap;}

/* ── Flow direction indicator ─────────────────────────────────────── */
.flow-track                   { position: relative; width: 2rem; height: 5px; background: transparent; border-radius: 999px; overflow: hidden; top: -1rem; }
.flow-track-placeholder       { width: 2rem; height: 5px; }
.flow-dot                     { position: absolute; top: 0; width: .5rem; height: 5px; border-radius: 999px; }

.flow-track.charging   .flow-dot,
.flow-track.exporting  .flow-dot  { background: #22c55e; animation: dot-ltr 1.4s ease-in-out infinite; }
.flow-track.discharging .flow-dot,
.flow-track.importing   .flow-dot { background: #f97316; animation: dot-rtl 1.4s ease-in-out infinite; }

@keyframes dot-ltr {
  0%   { left: -8px;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: 100%;  opacity: 0; }
}
@keyframes dot-rtl {
  0%   { left: 100%;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: -8px;  opacity: 0; }
}
</style>