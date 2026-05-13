<!--
  Dashboard.vue — v2 (mockup-faithful, responsive single-panel)

  Wide screens (≥ lg): single rounded panel with two-column body.
    Left column:  RIGHT NOW — battery ring + status, with solar/house/grid
                  values underneath as a small flow row.
    Right column: PEAK WINDOW pill + countdown, PLAN AHEAD callout (advisory),
                  EVENING FORECAST list with right-aligned values.
    Top of panel: 3-day forecast strip (TODAY / TOMORROW / DAY-AFTER) with
                  weather icons and kWh values.

  Narrow screens (< lg): single scroll. Forecast strip at top, then RIGHT NOW
    section, then peak/plan/forecast list stacked.

  Reads from useRealtimeStore. Stub-aware: peak.state === 'idle' renders the
  right column in a calmer "no peak today" mode. Advisory id 'idle-default'
  shows muted placeholder text. Forecast nulls render as "—".
-->

<template>
  <div class="dashboard-v2 lg:p-6 p-3 text-primary">
    <div class="panel bg-secondary-50 rounded-3xl p-4 lg:p-8 max-w-7xl mx-auto">


      <!-- ── Two-column body ───────────────────────────────────────────── -->
      <div class="grid grid-cols-2 gap-8 md:gap-10">

        <!-- ── LEFT: RIGHT NOW ─────────────────────────────────────────── -->
        <section class="right-now md:border-r md:border-secondary-200 md:pr-8 lg:pr-12">
          <div class="text-xs font-medium lowercase tracking-widest text-secondary-500 mb-4">
            Right now
          </div>

          <!-- Battery ring -->
          <div class="flex justify-center mb-4">
            <div class="relative" :style="{ width: ringSize + 'px', height: ringSize + 'px' }">
              <svg :width="ringSize" :height="ringSize" :viewBox="`0 0 ${ringSize} ${ringSize}`">
                <!-- Track -->
                <circle
                  :cx="ringSize / 2" :cy="ringSize / 2" :r="ringRadius"
                  fill="none"
                  stroke="currentColor"
                  class="text-secondary-200"
                  :stroke-width="ringStroke"
                />
                <!-- Progress arc -->
                <circle
                  :cx="ringSize / 2" :cy="ringSize / 2" :r="ringRadius"
                  fill="none"
                  :stroke="ringColor"
                  :stroke-width="ringStroke"
                  stroke-linecap="round"
                  :stroke-dasharray="ringCircumference"
                  :stroke-dashoffset="ringDashOffset"
                  :transform="`rotate(-90 ${ringSize / 2} ${ringSize / 2})`"
                  class="transition-all duration-700"
                />
              </svg>
              <!-- Inner number -->
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <div class="text-5xl xl:text-6xl font-bold tracking-tighter leading-none">
                  {{ Math.round(batterySOC) }}<span class="text-3xl xl:text-4xl font-bold">%</span>
                </div>
                <div class="text-sm text-secondary-500 mt-1">battery</div>
              </div>
            </div>
          </div>

          <!-- Battery status line -->
          <div class="text-center text-sm mb-6" :class="batteryStatusClass">
            {{ batteryStatusText }}
          </div>

          <!-- Solar / House / Grid row -->
          <div class="grid grid-cols-3 gap-2 md:gap-4">
            <div class="text-center">
              <div class="text-xs lowercase tracking-wide text-secondary-500 mb-1">Solar</div>
              <div class="text-lg md:text-xl font-bold tracking-tight">
                {{ formatLocalePower(solarW) }}
              </div>
            </div>
            <div class="text-center">
              <div class="text-xs lowercase tracking-wide text-secondary-500 mb-1">House</div>
              <div class="text-lg md:text-xl font-bold tracking-tight">
                {{ formatLocalePower(houseW) }}
              </div>
            </div>
            <div class="text-center">
              <div class="text-xs lowercase tracking-wide mb-1"
                   :class="gridDirection === 'offline' ? 'text-rose-600' : 'text-secondary-500'">
                Grid
              </div>
              <div class="text-lg md:text-xl font-bold tracking-tight"
                   :class="gridDirection === 'offline'   ? 'text-rose-600'
                         : gridDirection === 'importing'  ? 'text-rose-500'
                         : gridDirection === 'exporting'  ? 'text-emerald-500' : ''">
                {{ gridDirection === 'offline' ? 'Offline' : formatLocalePower(gridAbsW) }}
              </div>
            </div>
          </div>
        </section>

        <!-- ── RIGHT: PEAK / PLAN / EVENING FORECAST ─────────────────── -->
        <section class="plan-side">
      <!-- ── Top strip: 3-day forecast ─────────────────────────────────── -->
          <header class="forecast-strip flex justify-between items-start mb-6 lg:mb-10">
            <!-- Forecast strip wraps the full width on mobile, sits right on wide -->
            <div class="hidden lg:block w-32"><!-- spacer for symmetry on wide --></div>

            <div class="flex-1 flex justify-around lg:justify-end items-start gap-6 lg:gap-10">
              <div v-for="(day, idx) in forecastDisplay" :key="day.date || idx"
                  class="text-center min-w-[60px]">
                <div class="text-[11px] font-medium lowercase tracking-widest text-secondary-500 mb-2">
                  {{ formatForecastLabel(day.date, idx) }}
                </div>
                <div class="flex justify-center mb-1">
                  <i :class="forecastIconClass(day, idx)" class="text-3xl lg:text-4xl"></i>
                </div>
                <div class="text-base lg:text-lg font-bold tracking-tight"
                    :class="day.expectedKwh === null ? 'text-secondary-500' : ''">
                  <template v-if="day.expectedKwh !== null">
                    {{ Math.round(day.expectedKwh) }}<span class="text-xs font-medium text-secondary-500"> kWh</span>
                  </template>
                  <template v-else>—</template>
                </div>
              </div>
            </div>
          </header>
          <!-- Peak window pill (state-dependent) -->
          <div v-if="peakInfo.state !== 'idle'" class="peak-pill mb-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-full"
               :class="peakPillClasses">
            <span class="w-2 h-2 rounded-full" :class="peakDotClass"></span>
            <span class="text-xs font-bold lowercase tracking-widest">
              {{ peakHeadline }}
            </span>
          </div>
          <div v-else class="mb-4 text-xs font-medium lowercase tracking-widest text-secondary-500">
            Peak window
          </div>

          <!-- Big countdown / state -->
          <div class="mb-6">
            <template v-if="peakInfo.state !== 'idle' && peakInfo.minutesUntil !== null">
              <div class="flex items-baseline gap-3">
                <span class="text-5xl md:text-6xl xl:text-7xl font-bold tracking-tighter leading-none">
                  {{ peakInfo.minutesUntil }}
                </span>
                <span class="text-xl md:text-2xl xl:text-3xl text-secondary-500 font-medium">min</span>
              </div>
              <div class="text-sm text-secondary-500 mt-2">
                {{ peakInfo.reason || 'until expensive grid hours' }}
                <template v-if="peakInfo.window"> · {{ peakInfo.window }}</template>
              </div>
            </template>
            <template v-else>
              <div class="text-xl md:text-2xl xl:text-3xl font-semibold text-secondary-500 mb-1">
                No peak detected today
              </div>
              <div class="text-sm text-secondary-500">
                Peak detection will surface here when day-ahead pricing data is processed.
              </div>
            </template>
          </div>

          <!-- Plan ahead callout -->
          <div class="mb-6 pt-6 border-t border-secondary-200">
            <div class="text-xs font-medium lowercase tracking-widest text-secondary-500 mb-3 flex items-center justify-between">
              <span>Plan ahead</span>
              <span v-if="isAdvisoryStub"
                    class="text-[10px] lowercase tracking-wider text-secondary-500 bg-secondary-100 px-2 py-0.5 rounded normal-case font-normal tracking-normal">
                Pending
              </span>
            </div>
            <div v-if="!isAdvisoryStub"
                 class="advisory-callout p-4 rounded-xl text-sm leading-relaxed"
                 :class="advisoryCalloutClass">
              <div v-if="advisory.headline" class="font-semibold mb-1">{{ advisory.headline }}</div>
              <div>{{ advisory.body }}</div>
              <div v-if="advisory.constraint" class="mt-3 pt-3 border-t border-current/10 font-medium">
                {{ advisory.constraint }}
              </div>
            </div>
            <div v-else class="text-sm text-secondary-500 italic">
              No active advisory. The system will surface guidance when peak detection is available.
            </div>
          </div>

          <!-- Evening forecast list -->
          <div class="pt-6 border-t border-secondary-200">
            <div class="text-xs font-medium lowercase tracking-widest text-secondary-500 mb-3">
              Evening forecast
            </div>
            <div class="space-y-2.5 text-sm">
              <div class="flex items-center justify-between">
                <span>Battery at peak start</span>
                <span :class="dayPlan.batteryAtPeakStartPct === null ? 'text-secondary-500' : 'font-semibold text-emerald-600'">
                  <template v-if="dayPlan.batteryAtPeakStartPct !== null">
                    ~{{ Math.round(dayPlan.batteryAtPeakStartPct) }}%
                  </template>
                  <template v-else>—</template>
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span>Battery at peak end</span>
                <span :class="dayPlan.batteryAtPeakEndPct === null ? 'text-secondary-500' : 'font-semibold text-emerald-600'">
                  <template v-if="dayPlan.batteryAtPeakEndPct !== null">
                    ~{{ Math.round(dayPlan.batteryAtPeakEndPct) }}%
                  </template>
                  <template v-else>—</template>
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span>Expected grid import tonight</span>
                <span :class="dayPlan.expectedGridImportKwhTonight === null ? 'text-secondary-500' : 'font-semibold'">
                  <template v-if="dayPlan.expectedGridImportKwhTonight !== null">
                    {{ formatLocaleEnergy(dayPlan.expectedGridImportKwhTonight * 1000) }}
                  </template>
                  <template v-else>—</template>
                </span>
              </div>
              <div class="flex items-center justify-between">
                <span>Self-suff. today</span>
                <span class="font-semibold text-emerald-600">
                  {{ selfSufficiencyPct }}%
                </span>
              </div>
            </div>
          </div>

        </section>
      </div>

      <!-- ── Footer: stub indicator ────────────────────────────────────── -->
      <div v-if="dashboardMeta.partialImplementation && dashboardMeta.partialImplementation.length"
           class="mt-6 pt-4 border-t border-secondary-200 text-xs text-secondary-500 text-center italic">
        {{ dashboardMeta.partialImplementation.length }} field{{ dashboardMeta.partialImplementation.length === 1 ? '' : 's' }} pending implementation
      </div>

    </div>
  </div>
</template>


<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRealtimeStore } from '../stores/realtime';
import { useLocale } from '../composables/useLocale';

const realtimeStore = useRealtimeStore();
const { t, formatLocaleEnergy, formatLocalePower } = useLocale();

// ── Responsive ring sizing (computed at mount, not reactive — full reactivity
//    would require a window-resize listener, which is overkill here)
const ringSize = ref(window.innerWidth >= 1280 ? 350 : window.innerWidth >= 768 ? 200 : 200);
function updateRingSize() {
  ringSize.value = window.innerWidth >= 1280 ? 350 : window.innerWidth >= 768 ? 200 : 200;
}
const ringStroke      = computed(() => Math.round(ringSize.value * 0.05));
const ringRadius      = computed(() => (ringSize.value / 2) - (ringStroke.value));
const ringCircumference = computed(() => 2 * Math.PI * ringRadius.value);
const ringDashOffset  = computed(() =>
  ringCircumference.value * (1 - (batterySOC.value / 100))
);

// ── Live values ────────────────────────────────────────────────────────

const batterySOC = computed(() => realtimeStore.batterySOC || 0);
const batteryPowerW = computed(() => realtimeStore.batteryPower || 0);
const batteryAbsW   = computed(() => Math.abs(batteryPowerW.value));

const batteryDirection = computed(() => {
  const p = batteryPowerW.value;
  if (Math.abs(p) < 50) return 'idle';
  return p > 0 ? 'discharging' : 'charging';
});

const batteryStatusText = computed(() => {
  switch (batteryDirection.value) {
    case 'charging':    return `Charging · ${formatLocalePower(batteryAbsW.value)}`;
    case 'discharging': return `Discharging · ${formatLocalePower(batteryAbsW.value)}`;
    default:            return batterySOC.value >= 95 ? 'Full · evening covered'
                              : batterySOC.value <= 5 ? 'Empty'
                              : 'Idle';
  }
});

const batteryStatusClass = computed(() => {
  if (batteryDirection.value === 'charging') return 'text-emerald-600';
  if (batteryDirection.value === 'discharging') return 'text-amber-600';
  if (batterySOC.value >= 95) return 'text-emerald-600';
  return 'text-secondary-500';
});

// Ring color mirrors status
const ringColor = computed(() => {
  if (batteryDirection.value === 'charging') return '#10b981';   // emerald-500
  if (batterySOC.value >= 95) return '#10b981';                  // emerald-500 (full)
  if (batterySOC.value <= 20) return '#f43f5e';                  // rose-500
  if (batteryDirection.value === 'discharging') return '#f59e0b'; // amber-500
  return '#10b981';                                              // emerald-500 (idle, healthy)
});

// Solar / Grid / House
const solarW        = computed(() => realtimeStore.solarPower || 0);
const gridPowerW    = computed(() => realtimeStore.gridPower || 0);
const gridAbsW      = computed(() => Math.abs(gridPowerW.value));
const gridConnected = computed(() => realtimeStore.gridConnected ?? true);
const gridDirection = computed(() => {
  if (!gridConnected.value) return 'offline';
  const p = gridPowerW.value;
  if (Math.abs(p) < 50) return 'idle';
  return p > 0 ? 'importing' : 'exporting';
});
const houseW = computed(() => realtimeStore.loadPower || 0);

// ── Self-sufficiency (today) ───────────────────────────────────────────
// Self-sufficiency = (load - grid_import) / load. Capped to 0..100.
const selfSufficiencyPct = computed(() => {
  const load   = parseFloat(realtimeStore.summaryData.today_load) || 0;
  const import_ = parseFloat(realtimeStore.summaryData.today_grid_import) || 0;
  if (load <= 0) return 0;
  const ratio = (load - import_) / load;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
});

// ── v2 blocks ──────────────────────────────────────────────────────────

const peakInfo      = computed(() => realtimeStore.peakInfo);
const dayPlan       = computed(() => realtimeStore.dayPlan);
const forecast      = computed(() => realtimeStore.forecast);
const advisory      = computed(() => realtimeStore.advisory);
const dashboardMeta = computed(() => realtimeStore.dashboardMeta);

// ── Peak pill styling ──────────────────────────────────────────────────

const peakHeadline = computed(() => {
  const state = peakInfo.value?.state;
  if (state === 'active')      return 'Peak window · active';
  if (state === 'approaching') return `Peak window · starts ${formatPeakStartTime()}`;
  if (state === 'recent')      return 'Peak window · recent';
  return 'Peak window';
});

function formatPeakStartTime() {
  const w = peakInfo.value?.window;
  if (!w) return '';
  // window is expected as a string like "18:00-21:00" — show only the start
  const m = String(w).match(/^(\d{1,2}:\d{2})/);
  return m ? m[1] : w;
}

const peakPillClasses = computed(() => {
  switch (peakInfo.value?.state) {
    case 'active':       return 'bg-rose-100 text-rose-700';
    case 'approaching':  return 'bg-rose-100 text-rose-700';
    case 'recent':       return 'bg-secondary-100 text-secondary-500';
    default:             return 'bg-secondary-100 text-secondary-500';
  }
});

const peakDotClass = computed(() => {
  switch (peakInfo.value?.state) {
    case 'active':       return 'bg-rose-500 animate-pulse';
    case 'approaching':  return 'bg-rose-500';
    default:             return 'bg-secondary-500';
  }
});

// ── Advisory styling ───────────────────────────────────────────────────

const isAdvisoryStub = computed(() =>
  !advisory.value || advisory.value.id === 'idle-default' || !advisory.value.headline
);

const advisoryCalloutClass = computed(() => {
  switch (advisory.value?.tone) {
    case 'positive':  return 'bg-emerald-50 text-emerald-800';
    case 'warning':   return 'bg-amber-50 text-amber-800';
    case 'critical':  return 'bg-rose-50 text-rose-800';
    case 'neutral':
    default:          return 'bg-secondary-100 text-secondary-500';
  }
});

// ── Forecast strip ─────────────────────────────────────────────────────

const forecastDisplay = computed(() => {
  const days = Array.isArray(forecast.value) ? forecast.value : [];
  return days.filter(d => d.expectedKwh !== null).slice(0, 3);
});

function formatForecastLabel(dateStr, idx) {
  if (idx === 0) return 'Today';
  if (idx === 1) return 'Tomorrow';
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function forecastIconClass(day, idx) {
  // Until cloud-cover lookup ships, condition is 'unknown' for all.
  // Use yield magnitude as a soft proxy: higher kWh → sun, lower → cloud.
  // Tunable; replace with day.condition mapping when real data lands.
  if (day.expectedKwh === null) return 'ph-light ph-cloud text-secondary-500';
  if (day.expectedKwh >= 18) return 'ph-light ph-sun-fill text-amber-500';
  if (day.expectedKwh >= 10) return 'ph-light ph-cloud-sun text-amber-400';
  return 'ph-light ph-cloud text-secondary-500';
}

// ── Lifecycle ──────────────────────────────────────────────────────────

onMounted(() => {
  if (!realtimeStore.hasInitialized) {
    realtimeStore.initialize();
  }
  window.addEventListener('resize', updateRingSize);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateRingSize);
});
</script>


<style scoped>
.advisory-callout {
  border: 1px solid currentColor;
  border-color: rgba(0, 0, 0, 0.05);
}
</style>