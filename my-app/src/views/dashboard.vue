<template>
  <div class="lg:grid lg:grid-cols-4 lg:gap-6 lg:p-6 p-1 overflow-hidden text-primary">
    <!-- ── Left: hero + chart ──────────────────────────────────────────────── -->
    <div class="hero-card lg:col-span-3 p-6 lg:p-10 overflow-y-auto bg-secondary-50" >

      <!-- Three rings: Solar · Home · Battery SoC -->
      <div class="flex items-start justify-around gap-4 mb-2">

        <!-- Solar ring — always amber, fills to forecast -->
        <div class="flex flex-col items-center gap-2">
          <div class="relative" :style="{ width: ringSz + 'px', height: ringSz + 'px' }">
            <svg :width="ringSz" :height="ringSz" :viewBox="`0 0 ${ringSz} ${ringSz}`">
              <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="currentColor" class="text-secondary-200" :stroke-width="rSW"/>
              <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="#f59e0b" :stroke-width="rSW"
                      stroke-linecap="round" :stroke-dasharray="rCirc" :stroke-dashoffset="solarOuterOffset"
                      :transform="`rotate(-90 ${rC} ${rC})`" class="transition-all duration-700"/>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="font-bold leading-none tracking-tight" :style="{ fontSize: rNumSz + 'px' }">{{ todaySolar.toFixed(1) }}</span>
              <span class="text-[11px] text-secondary-500 mt-0.5">kWh</span>
            </div>
          </div>
          <div class="text-sm font-semibold text-primary">{{ t('control.solar') }}</div>
          <div class="text-xs text-secondary-500">
            <template v-if="solarScale !== null">
              {{ solarScaleLabel }} {{ solarScale.toFixed(1) }} kWh
              <span v-if="solarOverAvg" class="text-amber-600 font-medium"> ↑ +{{ solarOver.toFixed(1) }}</span>
            </template>
            <template v-else>no forecast yet</template>
          </div>
        </div>

        <!-- Home ring — always blue, fills to avg consumption -->
        <div class="flex flex-col items-center gap-2">
          <div class="relative" :style="{ width: ringSz + 'px', height: ringSz + 'px' }">
            <svg :width="ringSz" :height="ringSz" :viewBox="`0 0 ${ringSz} ${ringSz}`">
              <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="currentColor" class="text-secondary-200" :stroke-width="rSW"/>
              <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="#3b82f6" :stroke-width="rSW"
                      stroke-linecap="round" :stroke-dasharray="rCirc" :stroke-dashoffset="loadOuterOffset"
                      :transform="`rotate(-90 ${rC} ${rC})`" class="transition-all duration-700"/>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="font-bold leading-none tracking-tight" :style="{ fontSize: rNumSz + 'px' }">{{ todayLoad.toFixed(1) }}</span>
              <span class="text-[11px] text-secondary-500 mt-0.5">kWh</span>
            </div>
          </div>
          <div class="text-sm font-semibold text-primary">{{ t('dashboard.home') }}</div>
          <div class="text-xs text-secondary-500">
            <template v-if="avgLoad !== null">
              avg {{ avgLoad.toFixed(1) }} kWh
              <span v-if="loadOverAvg" class="text-blue-500 font-medium"> ↑ +{{ loadOver.toFixed(1) }}</span>
            </template>
            <template v-else>no avg yet</template>
          </div>
        </div>

        <!-- Battery SoC ring — always green -->
        <div class="flex flex-col items-center gap-3">
            <!-- Ring -->
            <div class="relative shrink-0" :style="{ width: ringSz + 'px', height: ringSz + 'px' }">
                <svg :width="ringSz" :height="ringSz" :viewBox="`0 0 ${ringSz} ${ringSz}`">
                    <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="currentColor" class="text-secondary-200" :stroke-width="rSW"/>
                    <circle :cx="rC" :cy="rC" :r="rR" fill="none" stroke="#10b981" :stroke-width="rSW"
                            stroke-linecap="round" :stroke-dasharray="rCirc" :stroke-dashoffset="battOffset"
                            :transform="`rotate(-90 ${rC} ${rC})`" class="transition-all duration-700"/>
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                    <span class="font-bold leading-none tracking-tight" :style="{ fontSize: rNumSz + 'px' }">{{ currentBatterySOC }}%</span>
                    <span class="text-[11px] text-secondary-500 mt-0.5">SoC</span>
                </div>
                <div class="flex flex-col items-center gap-3">
                    <span class="text-sm font-semibold text-primary">{{ t('dashboard.batteryLabel') }}</span>
                    <span class="text-xs text-secondary-500">{{ battStatusText }}</span>
                </div>
                <!-- Strategy text to the right of the ring -->
                <div v-if="strategyDecision" class="battery-strategy-inline justify-center mt-2">
                    <span>{{ strategyDecision.reason }}</span>
                </div>
            </div>
        </div>
        </div>
 

      <!-- Date nav + both charts (desktop only) -->
      <div class=" mt-6 mb-6">
        <div class="date-nav mb-4">
          <button class="date-btn" @click="goToPrevDay"><i class="ph-light ph-caret-left"></i></button>
          <span class="date-label">{{ selectedDateLabel }}</span>
          <button class="date-btn" :class="{ disabled: isToday }" @click="goToNextDay"><i class="ph-light ph-caret-right"></i></button>
        </div>
        <EnergyFlowGraph
          :period="graphPeriod"
          :date="graphDate"
          :auto-update="isToday"
          :height="'200px'"
          :granularity="10"
        />
        <!--<DashboardGraph
          :date="graphDate"
          :auto-update="isToday"
          height="200px"
        /> -->

      </div>

    </div>

    <!-- ── Right: power cards ──────────────────────────────────────────────── -->
    <div class="right-section flex flex-col bg-white">
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
                <div class="text-base font-bold text-primary">{{ t('control.battery') }}</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.batteryCharge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
                <div class="text-xs lowercase tracking-wider text-secondary-500">{{ t('energy.batteryDischarge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
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
                <i class="ph-light ph-x text-lg"></i>
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
import SmartDeviceList      from '@/components/SmartDeviceList.vue';
import DashboardGraph       from '@/components/common/DashboardGraph.vue';

const router = useRouter();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

console.log('Dashboard step 1 loaded');

// ── Ring computeds (v3 addition) ───────────────────────────────────────────
const ringSz     = ref(150);
const updateRingSize = () => { ringSz.value = window.innerWidth >= 1024 ? 180 : 100; };
const rC         = computed(() => ringSz.value / 2);
const rSW        = computed(() => Math.round(ringSz.value * 0.11));
const rR         = computed(() => rC.value - rSW.value);
const rCirc      = computed(() => 2 * Math.PI * rR.value);
const rNumSz     = computed(() => Math.round(ringSz.value * 0.2));

// Solar ring scale: today's forecast (preferred) → 14-day average → null
const solarForecast = computed(() => {
  const kwh = realtimeStore.forecast?.[0]?.expectedKwh;
  return kwh !== null && kwh !== undefined ? parseFloat(kwh) : null;
});
const solarScale    = computed(() => solarForecast.value ?? realtimeStore.averages?.avg_solar_14d ?? null);
const solarScaleLabel = computed(() => solarForecast.value !== null ? 'forecast' : 'avg');

const avgLoad    = computed(() => realtimeStore.averages?.avg_load_14d  ?? null);
const todaySolar = computed(() => parseFloat(realtimeStore.summaryData.today_pv_gen) || 0);
const todayLoad  = computed(() => parseFloat(realtimeStore.summaryData.today_load)   || 0);

function _ringOuter(value, avg, circ) {
  const scale = avg !== null && avg > 0 ? avg : 10;
  return circ.value * (1 - Math.min(value / scale, 1));
}
function _ringInner(value, avg, circ) {
  if (!avg || avg <= 0) return circ.value;
  return circ.value * (1 - Math.min((value - avg) / avg, 1));
}

const solarOverAvg     = computed(() => solarScale.value !== null && todaySolar.value > solarScale.value);
const solarOver        = computed(() => solarOverAvg.value ? todaySolar.value - (solarScale.value ?? 0) : 0);
const solarOuterOffset = computed(() => _ringOuter(todaySolar.value, solarScale.value, rCirc));
const solarInnerOffset = computed(() => _ringInner(todaySolar.value, solarScale.value, rInnerCirc));
const loadOverAvg      = computed(() => avgLoad.value !== null && todayLoad.value > avgLoad.value);
const loadOver         = computed(() => loadOverAvg.value ? todayLoad.value - (avgLoad.value ?? 0) : 0);
const loadOuterOffset  = computed(() => _ringOuter(todayLoad.value, avgLoad.value, rCirc));
const loadInnerOffset  = computed(() => _ringInner(todayLoad.value, avgLoad.value, rInnerCirc));

const battOffset = computed(() => rCirc.value * (1 - (realtimeStore.realtimeData?.batterySOC || 0) / 100));
const battRingColor = computed(() => {
  const soc   = realtimeStore.realtimeData?.batterySOC || 0;
  const b     = realtimeStore.realtimeData?.components?.battery_1;
  const power = b ? (b.currentIn || 0) - (b.currentOut || 0) : 0;
  if (power < -50) return '#10b981';
  if (soc >= 95)   return '#10b981';
  if (soc <= 20)   return '#f43f5e';
  if (power > 50)  return '#f59e0b';
  return '#10b981';
});
// ── Strategy decision ─────────────────────────────────────────────────────
const strategyDecision = computed(() => realtimeStore.strategyDecision);
const decisionAge = computed(() => {
  const d = strategyDecision.value;
  if (!d?.evaluatedAt) return '';
  const evaluated = new Date(d.evaluatedAt);
  const diffMin   = Math.round((Date.now() - evaluated.getTime()) / 60000);
  if (diffMin < 2)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
});

// Shorten reason to first sentence — split on '. ' not on decimal points
const strategyDecisionShort = computed(() => {
  const reason = strategyDecision.value?.reason;
  if (!reason) return '';
  // Split on '. ' followed by capital letter to avoid splitting on decimals like "6.0"
  const match = reason.match(/^(.*?\.\s)(?=[A-Z])/);
  const first = match ? match[1].trim() : reason.split('. ')[0];
  return first.length > 80 ? first.slice(0, 77) + '…' : first;
});

const battStatusText = computed(() => {
  const b     = realtimeStore.realtimeData?.components?.battery_1;
  const power = b ? (b.currentIn || 0) - (b.currentOut || 0) : 0;
  const absW  = Math.abs(power);
  const fmt   = absW >= 1000 ? `${(absW / 1000).toFixed(2)} kW` : `${Math.round(absW)} W`;
  if (power < -50) return `${t('status.charging')} · ${fmt}`;
  if (power > 50)  return `${t('status.discharging')} · ${fmt}`;
  const soc = realtimeStore.realtimeData?.batterySOC || 0;
  return soc >= 95 ? 'Full' : soc <= 5 ? 'Empty' : t('status.idle');
});
// ── End ring computeds ────────────────────────────────────────────────────;
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
  updateRingSize();
  window.addEventListener('resize', updateRingSize);
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
  window.removeEventListener('resize', updateRingSize);
  // stopPolling() removed — polling ownership belongs to App.vue
});
</script>

<style lang="css" scoped>
/* Strategy text inline to the right of the battery ring */
.battery-strategy-inline {
  gap: 0.3rem;
  font-size: 11px;
  color: var(--color-text-secondary, #6b7280);
  line-height: 1.45;
}
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