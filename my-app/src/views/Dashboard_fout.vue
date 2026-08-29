<template>
  <div class="lg:grid lg:grid-cols-4 lg:gap-6 lg:p-6 p-1 overflow-hidden text-primary">
    <!-- ── Left: hero + chart ──────────────────────────────────────────────── -->
    <div class="hero-card lg:col-span-3 p-6 lg:p-10 overflow-hidden bg-secondary-50" >

      <!-- Five vertical bars: Solar · Home · Battery · Export · Import -->
      <div class="flex items-end gap-0 mb-2">

        <!-- Main three: solar, home, battery — scale relative to each other -->
        <div class="flex items-end flex-1 justify-around">

          <!-- Solar -->
          <div class="flex flex-col items-center gap-2">
            <div class="text-base font-medium tracking-tight">{{ todaySolar.toFixed(1) }} <span class="text-xs text-secondary-400 font-normal">kWh</span></div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: solarBarPct + '%' }"></div>
            </div>
            <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-400">{{ t('control.solar') }}</div>
            <div class="text-[10px] text-secondary-400 text-center">
              <template v-if="solarScale !== null">
                {{ solarScaleLabel }} {{ solarScale.toFixed(1) }}<span v-if="solarOverAvg"> ↑+{{ solarOver.toFixed(1) }}</span>
              </template>
              <template v-else>no forecast yet</template>
            </div>
          </div>

          <!-- Home -->
          <div class="flex flex-col items-center gap-2">
            <div class="text-base font-medium tracking-tight">{{ todayLoad.toFixed(1) }} <span class="text-xs text-secondary-400 font-normal">kWh</span></div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: homeBarPct + '%' }"></div>
            </div>
            <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-400">{{ t('dashboard.home') }}</div>
            <div class="text-[10px] text-secondary-400 text-center">
              <template v-if="avgLoad !== null">avg {{ avgLoad.toFixed(1) }} kWh<span v-if="loadOverAvg"> ↑+{{ loadOver.toFixed(1) }}</span></template>
              <template v-else>no avg yet</template>
            </div>
          </div>

          <!-- Battery -->
          <div class="flex flex-col items-center gap-2">
            <div class="text-base font-medium tracking-tight">{{ currentBatterySOC }}<span class="text-xs text-secondary-400 font-normal">%</span></div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: currentBatterySOC + '%' }"></div>
            </div>
            <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-400">{{ t('dashboard.batteryLabel') }}</div>
            <div class="text-[10px] text-secondary-400 text-center">{{ battStatusText }}</div>
          </div>

        </div>

        <!-- Separator -->
        <div class="w-px bg-secondary-200 mx-4 self-center" style="height: 80px; margin-bottom: 42px;"></div>

        <!-- Grid pair: export + import + net label -->
        <div class="flex items-end gap-3">

          <!-- Export -->
          <div class="flex flex-col items-center gap-2">
            <div class="text-base font-medium tracking-tight">{{ gridExportKwh.toFixed(1) }} <span class="text-xs text-secondary-400 font-normal">kWh</span></div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: exportBarPct + '%' }"></div>
            </div>
            <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-400">Export</div>
            <div class="text-[10px] text-secondary-400 min-h-[14px]">&nbsp;</div>
          </div>

          <!-- Import -->
          <div class="flex flex-col items-center gap-2">
            <div class="text-base font-medium tracking-tight">{{ gridImportKwh.toFixed(1) }} <span class="text-xs text-secondary-400 font-normal">kWh</span></div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: importBarPct + '%' }"></div>
            </div>
            <div class="text-[10px] font-medium uppercase tracking-widest text-secondary-400">Import</div>
            <div class="text-[10px] text-secondary-400 min-h-[14px]">&nbsp;</div>
          </div>

          <!-- Net label -->
          <div class="flex flex-col justify-center text-[11px] text-secondary-400 leading-snug pb-10 whitespace-nowrap">
            Net<br>
            <span class="font-medium text-primary">{{ gridNetLabel }}</span><br>
            {{ gridNetDirection }}
          </div>

        </div>
      </div>
 

      <!-- Date nav + both charts (desktop only) -->
      <div class=" mt-6 mb-6 hidden lg:block h-full" >
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
     <div class="right-section flex flex-col bg-card">
 
      <!-- Panel switcher pill -->
      <div class="panel-switcher-wrap">
        <div class="panel-switcher">
          <button
            class="switcher-btn"
            :class="{ active: panelView === 'list' }"
            @click="setPanelView('list')"
            :title="t('dashboard.viewList')"
          >
            <i class="ph-light ph-list-bullets"></i>
          </button>
          <div class="switcher-sep"></div>
          <button
            class="switcher-btn"
            :class="{ active: panelView === 'flow' }"
            @click="setPanelView('flow')"
            :title="t('dashboard.viewFlow')"
          >
            <i class="ph-light ph-graph"></i>
          </button>
        </div>
      </div>
 
      <!-- Swappable panel -->
      <div class="flex-1 overflow-y-auto">
        <transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="transition duration-150 ease-in"
          leave-to-class="opacity-0"
          mode="out-in"
        >
          <DashboardPowerList v-if="panelView === 'list'" key="list" />
          <EnergyFlowDiagram  v-else                      key="flow" />
        </transition>
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
import DashboardPowerList from '@/components/common/DashboardPowerList.vue';
import EnergyFlowDiagram  from '@/components/common/EnergyFlowDiagram.vue';

const router = useRouter();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

console.log('Dashboard step 1 loaded');

// ── Bar computeds (replaces ring computeds) ────────────────────────────────
// Today's kWh totals
const todaySolar = computed(() => parseFloat(realtimeStore.summaryData.today_pv_gen) || 0);
const todayLoad  = computed(() => parseFloat(realtimeStore.summaryData.today_load)   || 0);

// Solar scale: forecast preferred → 14-day average → null
const solarForecast   = computed(() => {
  const kwh = realtimeStore.forecast?.[0]?.expectedKwh;
  return kwh !== null && kwh !== undefined ? parseFloat(kwh) : null;
});
const solarScale      = computed(() => solarForecast.value ?? realtimeStore.averages?.avg_solar_14d ?? null);
const solarScaleLabel = computed(() => solarForecast.value !== null ? 'forecast' : 'avg');
const avgLoad         = computed(() => realtimeStore.averages?.avg_load_14d ?? null);

const solarOverAvg = computed(() => solarScale.value !== null && todaySolar.value > solarScale.value);
const solarOver    = computed(() => solarOverAvg.value ? todaySolar.value - (solarScale.value ?? 0) : 0);
const loadOverAvg  = computed(() => avgLoad.value !== null && todayLoad.value > avgLoad.value);
const loadOver     = computed(() => loadOverAvg.value ? todayLoad.value - (avgLoad.value ?? 0) : 0);

// Main three bars scale relative to each other.
// Battery SoC (0–100) is used directly for its bar; divide by 10 as a kWh
// proxy so a full battery doesn't collapse solar/home bars on low-yield days.
const mainMax = computed(() =>
  Math.max(todaySolar.value, todayLoad.value, (realtimeStore.realtimeData?.batterySOC || 0) / 10, 0.01)
);
const solarBarPct = computed(() => Math.round((todaySolar.value / mainMax.value) * 100));
const homeBarPct  = computed(() => Math.round((todayLoad.value  / mainMax.value) * 100));

// Grid today
const gridExportKwh = computed(() => parseFloat(realtimeStore.summaryData?.today_grid_export) || 0);
const gridImportKwh = computed(() => parseFloat(realtimeStore.summaryData?.today_grid_import) || 0);

const gridMax      = computed(() => Math.max(gridExportKwh.value, gridImportKwh.value, 0.01));
const exportBarPct = computed(() => Math.round((gridExportKwh.value / gridMax.value) * 100));
const importBarPct = computed(() => Math.round((gridImportKwh.value / gridMax.value) * 100));

const gridNetKwh       = computed(() => gridExportKwh.value - gridImportKwh.value);
const gridNetLabel     = computed(() => {
  const val = Math.abs(gridNetKwh.value);
  return val >= 1 ? `${val.toFixed(1)} kWh` : `${Math.round(val * 1000)} Wh`;
});
const gridNetDirection = computed(() => gridNetKwh.value >= 0 ? 'to grid' : 'from grid');
// ── End bar computeds ──────────────────────────────────────────────────────
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

// ── Dashboard panel view preference ───────────────────────────────────────
const panelView = ref('list'); // default until setting loads
 
const loadPanelView = async () => {
  try {
    const res = await apiClient.get('/settings/ui/dashboard-panel-view');
    if (res.data?.value === 'flow') panelView.value = 'flow';
  } catch {
    // setting not yet in DB — stay on default 'list'
  }
};
 
const setPanelView = async (view) => {
  panelView.value = view;
  try {
    await apiClient.put('/settings/ui/dashboard-panel-view', { value: view });
  } catch (e) {
    console.warn('Could not persist panel view preference:', e.message);
  }
};

// fetchStatus polling is handled globally in App.vue — no duplicate interval here.
let timeInterval = null;

onMounted(() => {
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
  strategyStore.fetchActive();
  loadPanelView();
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
  // stopPolling() removed — polling ownership belongs to App.vue
});
</script>

<style lang="css" scoped>
/* ── Vertical bars ────────────────────────────────────────────────────── */
.bar-track {
  width: 44px;
  height: 80px;
  background: var(--color-secondary-100);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}
.bar-fill {
  width: 100%;
  background: var(--color-secondary-400);
  border-radius: var(--radius-md);
  transition: height 0.6s ease;
}

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

/* ── Panel switcher pill ──────────────────────────────────────────────── */
.panel-switcher-wrap  { display: flex; justify-content: flex-end; padding: 0.75rem 1rem; }
.panel-switcher       { display: inline-flex; align-items: center; gap: 0; background: var(--color-secondary-100); border: var(--border-width) solid var(--color-secondary-200); border-radius: 999px; padding: 3px; }
.switcher-btn         { display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border: none; background: transparent; border-radius: 999px; color: var(--color-text-secondary); cursor: pointer; font-size: 1rem; transition: background .15s, color .15s; }
.switcher-btn:hover   { background: var(--color-secondary-200); color: var(--color-text-primary); }
.switcher-btn.active  { background: var(--color-white); color: var(--color-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.10); }
.switcher-sep         { width: 1px; height: 1.25rem; background: var(--color-secondary-200); margin: 0 2px; }
 

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