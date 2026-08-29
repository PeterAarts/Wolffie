<!-- src/components/control/DayAheadChart.vue -->
<template>
  <div class="flex flex-col gap-3 pt-5 border-t border-[color:var(--color-border)]">

    <!-- ── Header ── -->
    <div class="flex flex-col gap-2">

      <!-- Row 1: title + legend + thresholds -->
      <div class="flex items-center gap-3 flex-wrap">

        <!-- Title -->
        <span class="text-sm font-semibold whitespace-nowrap "
              style="color: var(--color-text-primary)">
          {{ t('control.forecast.title') }}
        </span>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1">

        <button
          class="w-6 h-6 flex items-center justify-center text-base leading-none cursor-pointer p-0 transition-colors duration-[120ms]"
          :class="canGoPrev
            ? ' hover:border-[color:var(--color-border-dark)] hover:bg-[color:var(--color-secondary-subtle)]'
            : ' opacity-30 cursor-not-allowed'"
          style="color: var(--color-text-secondary); border-radius: var(--border-radius)"
          :disabled="!canGoPrev"
          :title="t('control.forecast.prevDay')"
          @click="shiftDate(-1)"
        >‹</button>

        <div class="relative">
          <input
            type="date"
            class="dac-date-input"
            :value="selectedDate"
            :min="minDate"
            :max="maxDate"
            @change="onDateChange"
          />
          <span
            class="flex items-center gap-1.5 px-2 py-1 text-[0.78rem] whitespace-nowrap select-none cursor-pointer bg-card transition-colors duration-[120ms]  hover:border-[color:var(--color-border-dark)] hover:bg-[color:var(--color-secondary-subtle)]"
            style="color: var(--color-text-primary); border-radius: var(--border-radius)"
            @click="openPicker"
          >
            {{ formattedDate }}
            <span v-if="isToday"
                  class="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5"
                  style="background: var(--color-secondary-muted); color: var(--color-text-primary); border-radius: var(--border-radius)">
              {{ t('control.forecast.today') }}
            </span>
            <span v-else-if="isTomorrow"
                  class="text-[0.65rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-amber-100 text-amber-800"
                  style="border-radius: var(--border-radius)">
              {{ t('control.forecast.tomorrow') }}
            </span>
          </span>
        </div>

        <button
          class="w-6 h-6 flex items-center justify-center text-base leading-none cursor-pointer p-0 transition-colors duration-[120ms]"
          :class="canGoNext
            ? '  hover:bg-[color:var(--color-secondary-subtle)]'
            : ' opacity-30 cursor-not-allowed'"
          style="color: var(--color-text-secondary); border-radius: var(--border-radius)"
          :disabled="!canGoNext"
          :title="t('control.forecast.nextDay')"
          @click="shiftDate(1)"
        >›</button>

      </div>
        <!-- Threshold controls -->
        <div v-if="hasPrices" class="flex items-center gap-4 ml-auto">
          <span class="flex items-center gap-1.5 text-[0.72rem] whitespace-nowrap"
                style="color: var(--color-text-secondary)">
            <span class="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-green-200" />
            ≤
            <input type="range" min="0" max="100" step="1"
                   :value="greenBelow"
                   class="dac-slider dac-slider--green"
                   @input="greenBelow = Math.min(+$event.target.value, redAbove - 5); recolourCurrentBar(); scheduleSave()" />
            <span class="font-semibold w-10 text-right text-green-600">{{ greenBelow }}%</span>
          </span>
          <span class="flex items-center gap-1.5 text-[0.72rem] whitespace-nowrap"
                style="color: var(--color-text-secondary)">
            <span class="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-red-200" />
            ≥
            <input type="range" min="0" max="100" step="1"
                   :value="redAbove"
                   class="dac-slider dac-slider--red"
                   @input="redAbove = Math.max(+$event.target.value, greenBelow + 5); recolourCurrentBar(); scheduleSave()" />
            <span class="font-semibold w-10 text-right text-red-600">{{ redAbove }}%</span>
          </span>
        </div>
      </div>      
    </div>

    <!-- ── Canvas ── -->
    <div class="relative h-[250px]">
      <canvas ref="canvasEl" class="!w-full !h-full" />
      <Transition name="dac-fade">
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-card/75">
          <span class="dac-spinner" />
        </div>
      </Transition>
    </div>

    <!-- ── No-data ── -->
    <div v-if="!loading && !hasPrices && !hasSolar"
         class="text-center text-[0.8rem] italic py-2"
         style="color: var(--color-text-tertiary)">
      {{ t('control.forecast.noData') }}
    </div>
        <!-- Legend -->
    <div class="flex gap-3.5 mr-auto">
      <span v-if="hasPrices" class="flex items-center gap-1.5 text-[0.72rem]"
            style="color: var(--color-text-secondary)">
        <span class="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style="background: var(--color-secondary-muted)" />
        {{ t('control.forecast.price') }}
      </span>
      <span v-if="hasSolar" class="flex items-center gap-1.5 text-[0.72rem]"
            style="color: var(--color-text-secondary)">
        <span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
        {{ t('control.forecast.solar') }}
        <span class="text-[0.68rem]" style="color: var(--color-text-tertiary)">({{ solarKwhLabel }})</span>
      </span>
    </div>
    <!-- ── Current-slot pill (today only) ── 
    <div v-if="!loading && isToday && currentSlot"
         class="flex items-center gap-2 px-2.5 py-1.5 text-[0.75rem] border border-[color:var(--color-border)]"
         style="background: var(--color-secondary-subtle); border-radius: var(--border-radius)">
      <span class="text-[0.68rem] font-medium uppercase tracking-wide whitespace-nowrap"
            style="color: var(--color-text-tertiary)">
        {{ t('control.forecast.now') }}
      </span>
      <span v-if="hasPrices && currentSlot.price != null"
            class="font-semibold"
            style="color: var(--color-text-primary)">
        {{ formatPrice(currentSlot.price) }}
      </span>
      <span v-if="hasSolar && currentSlot.solarWh > 0"
            class="font-semibold text-amber-600">
        ☀ {{ formatPower(currentSlot.solarWh) }}
      </span>
    </div>-->

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { Chart, registerables } from 'chart.js';
import apiClient from '@/services/api';
import { useLocale } from '@/composables/useLocale';

Chart.register(...registerables);

const { t } = useLocale();

// ─── Config ────────────────────────────────────────────────────────────────────
const PRICE_IN_MWH       = false;
const SOLAR_FORECAST_URL = '/solar-forecast';
const LATITUDE           = parseFloat(import.meta.env.VITE_LOCATION_LATITUDE ?? '50.861');

// ─── Date helpers ──────────────────────────────────────────────────────────────
function localDateStr(d = new Date()) { return d.toLocaleDateString('en-CA'); }
function todayStr()    { return localDateStr(); }
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return localDateStr(d); }
function minDateStr()  { const d = new Date(); d.setMonth(d.getMonth() - 1); return localDateStr(d); }

// ─── State ─────────────────────────────────────────────────────────────────────
const canvasEl     = ref(null);
const loading      = ref(false);
const selectedDate = ref(todayStr());
const isMobile     = ref(false);

// Processed slots — set directly after fetch, not via intermediate rawPrices ref
// This avoids any watcher timing issues: we build slots in JS, then call rebuildChart()
const chartSlots = ref([]);    // [{ index, hour, minute, label, price, solarWh }]
const solarKwh   = ref(null);  // daily kWh total (for legend display)

const minDate = minDateStr();
const maxDate = computed(() => tomorrowStr());

// ─── Price threshold state ─────────────────────────────────────────────────────
// greenBelow: slots with price <= this percentile of [min,max] are green
// redAbove:   slots with price >= this percentile of [min,max] are red
const greenBelow = ref(30);   // default: bottom 30% = green (cheap)
const redAbove   = ref(70);   // default: top 30% = red (expensive)
const settingsSaving = ref(false);

// ─── Threshold persistence ─────────────────────────────────────────────────────
async function loadThresholds() {
  try {
    // GET /api/settings/day-ahead-chart → { green_below: number, red_above: number }
    const res     = await apiClient.get('/settings/day-ahead-chart');
    const payload = res?.data ?? res;
    if (payload?.green_below != null) greenBelow.value = Number(payload.green_below);
    if (payload?.red_above   != null) redAbove.value   = Number(payload.red_above);
  } catch {
    // No saved settings yet — keep defaults
  }
}

async function saveThresholds() {
  settingsSaving.value = true;
  try {
    // PUT /api/settings/day-ahead-chart → upserts rows, no pre-existing rows needed
    await apiClient.put('/settings/day-ahead-chart', {
      green_below: greenBelow.value,
      red_above  : redAbove.value,
    });
  } catch (e) {
    console.warn('[DayAheadChart] Could not save thresholds:', e.message);
  } finally {
    settingsSaving.value = false;
  }
}

// Debounce save — only write to server 800ms after user stops dragging
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveThresholds, 800);
}

let chart     = null;
let slotTimer = null;

// ─── Date nav ──────────────────────────────────────────────────────────────────
const isToday    = computed(() => selectedDate.value === todayStr());
const isTomorrow = computed(() => selectedDate.value === tomorrowStr());
const canGoPrev  = computed(() => selectedDate.value > minDate);
const canGoNext  = computed(() => selectedDate.value < maxDate.value);

const formattedDate = computed(() => {
  const d = new Date(selectedDate.value + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
});

function shiftDate(delta) {
  const d = new Date(selectedDate.value + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const next = localDateStr(d);
  if (next >= minDate && next <= maxDate.value) selectedDate.value = next;
}

function onDateChange(e) {
  const v = e.target.value;
  if (v >= minDate && v <= maxDate.value) selectedDate.value = v;
}

function openPicker() {
  canvasEl.value?.closest('.dac')?.querySelector('.dac__date-input')?.showPicker?.();
}

// ─── Derived from chartSlots ───────────────────────────────────────────────────
const hasPrices    = computed(() => chartSlots.value.some(s => s.price !== null));
const hasSolar     = computed(() => solarKwh.value != null && solarKwh.value > 0);
const solarKwhLabel = computed(() => hasSolar.value ? `${solarKwh.value.toFixed(1)} kWh` : '');

const currentSlot = computed(() => {
  if (!isToday.value || !chartSlots.value.length) return null;
  const h = new Date().getHours();
  const m = new Date().getMinutes();
  return chartSlots.value.find(s => s.hour === h && m >= s.minute && m < s.minute + 15)
      ?? chartSlots.value.find(s => s.hour === h)
      ?? null;
});

// ─── Solar bell-curve ──────────────────────────────────────────────────────────
function sunriseSunset(latDeg, dateStr) {
  const lat  = latDeg * (Math.PI / 180);
  const d    = new Date(dateStr + 'T12:00:00');
  const doy  = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 86_400_000);
  const decl = -23.45 * (Math.PI / 180) * Math.cos((2 * Math.PI / 365) * (doy + 10));
  const cos  = Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl)));
  const ha   = Math.acos(cos) * (180 / Math.PI) / 15;
  return { rise: 12 - ha, set: 12 + ha };
}

function buildSolarSlots(dailyKwh, dateStr, count) {
  if (!dailyKwh || dailyKwh <= 0 || !count) return new Array(count).fill(0);
  const { rise, set } = sunriseSunset(LATITUDE, dateStr);
  const noon  = (rise + set) / 2;
  const sigma = (set - rise) / 4;
  const step  = 24 / count;
  const w = Array.from({ length: count }, (_, i) => {
    const mid = i * step + step / 2;
    return mid < rise || mid > set ? 0 : Math.exp(-0.5 * ((mid - noon) / sigma) ** 2);
  });
  const total = w.reduce((a, b) => a + b, 0);
  return w.map(v => total > 0 ? (v / total) * dailyKwh * 1000 : 0);
}

// ─── Build chartSlots from raw API prices array ────────────────────────────────
/**
 * @param prices      Raw price rows from API
 * @param dailyKwh    Daily solar total kWh (for bell-curve fallback)
 * @param dateStr     'YYYY-MM-DD'
 * @param solarHours  { [hour: number]: Wh } from API — null if not available
 */
/**
 * @param prices      Raw price rows from API
 * @param dailyKwh    Daily solar total kWh (for bell-curve fallback)
 * @param dateStr     'YYYY-MM-DD'
 * @param solarSlots  { "YYYY-MM-DD HH:MM": Wh } datetime-keyed map (primary)
 * @param solarHours  { [hour]: Wh } hour-keyed map (fallback for hourly prices)
 */
function buildSlots(prices, dailyKwh, dateStr, solarSlots = null, solarHours = null) {
  const hasSolarData = solarSlots || solarHours || dailyKwh;

  // If no prices but we have solar data, generate 24 hourly solar-only slots
  if (!prices || !prices.length) {
    if (!hasSolarData) return [];
    const bellCurve = (solarSlots || solarHours) ? [] : buildSolarSlots(dailyKwh, dateStr, 24);
    return Array.from({ length: 24 }, (_, h) => {
      const dtKey = `${dateStr} ${String(h).padStart(2,'0')}:00`;
      const wh = solarSlots?.[dtKey] ?? solarHours?.[h] ?? null;
      return {
        index   : h,
        hour    : h,
        minute  : 0,
        label   : `${String(h).padStart(2,'0')}:00`,
        price   : null,
        solarWh : wh != null ? Math.round(wh) : Math.round(bellCurve[h] ?? 0),
      };
    });
  }

  // slotsPerHour: 4 for 15-min price data, 1 for hourly
  // Solar API returns Wh per full hour — divide across 15-min slots so the
  // line chart area represents the same total as hourly data
  const is15min      = prices[0]?.datetime != null;
  const slotsPerHour = is15min ? 4 : 1;

  /**
   * Resolve solarWh for a slot.
   * Priority: datetime-keyed slotMap > hour-keyed hourMap > bell-curve
   */
  function solarWhForSlot(hour, minute, bellCurveArr, idx) {
    // Try exact datetime match first (aligns with 15-min price slot's hour)
    if (solarSlots) {
      const dtKey = `${dateStr} ${String(hour).padStart(2,'0')}:00`;
      if (solarSlots[dtKey] != null) return Math.round(solarSlots[dtKey] / slotsPerHour);
    }
    // Fallback to hour-keyed map
    if (solarHours?.[hour] != null) return Math.round(solarHours[hour] / slotsPerHour);
    // Final fallback: bell-curve estimate
    return Math.round(bellCurveArr[idx] ?? 0);
  }

  // ── 15-min format: { datetime, price_eur_per_kwh, ... } ───────────────────
  if (prices[0]?.datetime != null) {
    const sorted = [...prices].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const bellCurve = (solarSlots || solarHours) ? [] : buildSolarSlots(dailyKwh, dateStr, sorted.length);

    return sorted.map((r, i) => {
      // Normalise datetime string to UTC: "2026-03-31 06:00:00" → "2026-03-31T06:00:00Z"
      // Without this, browsers parse space-separated datetimes as local time, shifting
      // d.getHours() by the UTC offset and breaking the solarSlots key lookup.
      const rawDt = String(r.datetime).replace(' ', 'T');
      const utcDt = /[Zz]$|[+-]\d{2}:\d{2}$/.test(rawDt) ? rawDt : rawDt + 'Z';
      const d    = new Date(utcDt);
      const hour = d.getHours();
      let price  = parseFloat(r.price_eur_per_kwh ?? r.price ?? r.price_eur_kwh ?? r.value);
      if (!isFinite(price)) price = null;
      if (price !== null && PRICE_IN_MWH) price /= 1000;
      return {
        index   : i,
        hour,
        minute  : d.getMinutes(),
        label   : `${String(hour).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
        price,
        solarWh : solarWhForSlot(hour, d.getMinutes(), bellCurve, i),
      };
    });
  }

  // ── Hourly fallback: { hour, price, ... } ─────────────────────────────────
  const bellCurve = (solarSlots || solarHours) ? [] : buildSolarSlots(dailyKwh, dateStr, 24);
  return Array.from({ length: 24 }, (_, h) => {
    const row   = prices.find(r => Number(r.hour) === h);
    let   price = row ? parseFloat(row.price ?? row.price_eur_kwh ?? row.value) : null;
    if (price !== null && !isFinite(price)) price = null;
    if (price !== null && PRICE_IN_MWH) price /= 1000;
    return {
      index   : h,
      hour    : h,
      minute  : 0,
      label   : `${String(h).padStart(2,'0')}:00`,
      price,
      solarWh : solarWhForSlot(h, 0, bellCurve, h),
    };
  });
}

// ─── Mobile aggregation ────────────────────────────────────────────────────────
/**
 * Collapse 15-min slots into hourly slots for mobile display.
 * Price: average of non-null prices in the hour.
 * Solar: sum of solarWh across the 4 slots.
 */
function aggregateToHourly(slots) {
  if (!slots.length) return slots;
  // If already hourly (≤ 24 slots), no-op
  if (slots.length <= 24) return slots;

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const group = slots.filter(s => s.hour === h);
    if (!group.length) continue;
    const prices  = group.map(s => s.price).filter(p => p !== null);
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    hours.push({
      index   : h,
      hour    : h,
      minute  : 0,
      label   : `${String(h).padStart(2,'0')}:00`,
      price   : avgPrice,
      solarWh : group.reduce((a, s) => a + (s.solarWh ?? 0), 0),
    });
  }
  return hours;
}


function formatPrice(v) {
  return v != null ? `${(v * 100).toFixed(2)} ct/kWh` : '—';
}
function formatPower(wh) {
  return wh >= 1000 ? `${(wh / 1000).toFixed(2)} kW` : `${Math.round(wh)} W`;
}

// ─── Chart colours ─────────────────────────────────────────────────────────────
const C = {
  barDefault : '#ebe6e7',
  barCurrent : '#3c3c3d',
  barCheap   : 'rgba(83, 218, 101,1)',
  barCostly  : 'rgba(153, 27, 27,1)',
  solar      : 'rgba(245,158,11,0.9)',
  solarFill  : 'rgba(245,158,11,0.05)',
};

function barColors(sl) {
  const valid = sl.map(s => s.price).filter(p => p !== null);
  if (!valid.length) return sl.map(() => C.barDefault);

  const minP = Math.min(...valid);
  const maxP = Math.max(...valid);
  const range = maxP - minP || 1;

  // Convert percentile thresholds to absolute price values
  const greenThreshold = minP + (range * greenBelow.value / 100);
  const redThreshold   = minP + (range * redAbove.value   / 100);

  const cur = currentSlot.value;
  return sl.map(s => {
    if (isToday.value && cur && s.index === cur.index) return C.barCurrent;
    if (s.price === null)              return C.barDefault;
    if (s.price <= greenThreshold)     return C.barCheap;
    if (s.price >= redThreshold)       return C.barCostly;
    return C.barDefault;
  });
}

// ─── Chart ─────────────────────────────────────────────────────────────────────
function buildConfig(sl) {
  const labels = sl.map(s => s.label);
  const dsets  = [];
  const pSlots = sl.filter(s => s.price !== null);
  const hasP   = pSlots.length > 0;
  const hasS   = hasSolar.value;

  if (hasP) {
    dsets.push({
      type               : 'bar',
      label              : t('control.forecast.price'),
      data               : sl.map(s => s.price),
      backgroundColor    : barColors(sl),
      borderWidth        : 0,
      borderRadius       : 5,
      yAxisID            : 'yPrice',
      order              : 2,
      barPercentage      : 1.0,
      categoryPercentage : .5,
    });
  }

  if (hasS) {
    dsets.push({
      type             : 'line',
      label            : t('control.forecast.solar'),
      data             : sl.map(s => s.solarWh / 1000),
      borderColor      : C.solar,
      backgroundColor  : C.solarFill,
      borderWidth      : 2,
      pointRadius      : 0,
      pointHoverRadius : 4,
      tension          : 0.45,
      fill             : true,
      yAxisID          : 'ySolar',
      order            : 1,
    });
  }

  const tickColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary').trim() || '#9ca3af';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#f3f4f6';

  const scales = {
    x: {
      grid : { display: false },
      ticks: {
        color      : tickColor,
        font       : { size: 10 },
        maxRotation: 0,
        autoSkip   : false,
        callback   : (_, i) => {
          const s = sl[i];
          if (!s) return '';
          // Show label at midnight, 03:00, 06:00 ... 21:00 only
          if (s.minute !== 0 || s.hour % 3 !== 0) return '';
          // On mobile (hourly), show hour only to save space
          return isMobile.value ? `${String(s.hour).padStart(2,'0')}` : s.label;
        },
      },
    },
  };

  if (hasP) {
    scales.yPrice = {
      type    : 'linear',
      position: 'left',
      grid    : { color: gridColor },
      ticks   : {
        color   : tickColor,
        font    : { size: 10 },
        callback: v => v != null ? `${(v * 100).toFixed(0)}ct` : '',
      },
      title: { display: true, text: 'ct/kWh', color: tickColor, font: { size: 9 } },
    };
  }

  if (hasS) {
    scales.ySolar = {
      type        : 'linear',
      position    : 'right',
      beginAtZero : true,
      grid        : { drawOnChartArea: false },
      ticks       : {
        color   : tickColor,
        font    : { size: 10 },
        callback: v => `${v.toFixed(1)}`,
      },
      title: { display: true, text: 'kW', color: tickColor, font: { size: 9 } },
    };
  }

  return {
    type   : 'bar',
    data   : { labels, datasets: dsets },
    options: {
      responsive          : true,
      maintainAspectRatio : false,
      interaction         : { mode: 'index', intersect: false },
      plugins: {
        legend : { display: false },
        tooltip: {
          backgroundColor  : '#ffffff',
          borderColor      : '#e5e7eb',
          borderWidth      : 1,
          padding          : { top: 8, right: 12, bottom: 8, left: 12 },
          titleColor       : '#111827',
          titleFont        : { size: 12, weight: '600' },
          bodyColor        : '#374151',
          bodyFont         : { size: 12, weight: '400' },
          bodySpacing      : 5,
          boxWidth         : 8,
          boxHeight        : 8,
          boxPadding       : 4,
          usePointStyle    : true,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.dataset.yAxisID === 'yPrice') {
                const v = ctx.parsed.y;
                return v != null ? `Price: ${formatPrice(v)}` : 'Price: —';
              }
              if (ctx.dataset.yAxisID === 'ySolar') {
                return `Solar: ${formatPower(Math.round(ctx.parsed.y * 1000))}`;
              }
              return ctx.formattedValue;
            },
          },
        },
      },
      scales,
      animation: { duration: 400 },
    },
  };
}

function rebuildChart(sl) {
  if (!canvasEl.value) return;
  chart?.destroy();
  chart = null;
  if (!sl || !sl.length) return;
  const displaySlots = isMobile.value ? aggregateToHourly(sl) : sl;
  chart = new Chart(canvasEl.value, buildConfig(displaySlots));
}

function recolourCurrentBar() {
  if (!chart || !chartSlots.value.length) return;
  const ds = chart.data.datasets.find(d => d.yAxisID === 'yPrice');
  if (!ds) return;
  const displaySlots = isMobile.value ? aggregateToHourly(chartSlots.value) : chartSlots.value;
  ds.backgroundColor = barColors(displaySlots);
  chart.update('none');
}

// Thresholds are handled directly in slider @input — no watcher needed

// ─── Data fetching ─────────────────────────────────────────────────────────────
async function fetchPrices(date) {
  try {
    const endpoint = `/day-ahead-prices?date=${date}`;
    const res = await apiClient.get(endpoint);
    // Response may be wrapped: { data: { prices: [...] } } or { prices: [...] }
    const payload = res?.data ?? res;
    if (Array.isArray(payload?.prices)) return payload.prices;
    if (Array.isArray(payload)) return payload;
    return [];
  } catch (err) {
    console.warn('[DayAheadChart] Prices unavailable:', err.message);
    return [];
  }
}

async function fetchSolar(date) {
  try {
    // Use query-param endpoint consistently (avoids /today named-route issues)
    const rawSolar = await apiClient.get(`${SOLAR_FORECAST_URL}?date=${date}`);
    const res = rawSolar?.data ?? rawSolar;

    // New shape: { expected_kwh, hours: [{ slot_datetime, hourly_wh, cumulative_wh }] }
    if (res?.hours?.length) {
      // Build two lookup maps:
      //   slotMap : "2026-02-27 08:00:00" → Wh  (for exact datetime match with price slots)
      //   hourMap : 8 → Wh                       (fallback for hourly price data)
      const slotMap = {};
      const hourMap = {};
      for (const h of res.hours) {
        const wh = Number(h.hourly_wh);
        // slot_datetime comes as "2026-02-27 08:00:00"
        const dt = String(h.slot_datetime).substring(0, 16); // "2026-02-27 08:00"
        slotMap[dt] = wh;
        // Also index by hour integer for fallback
        const hour = parseInt(dt.split(' ')[1].split(':')[0], 10);
        hourMap[hour] = wh;
      }
      return { kwh: Number(res.expected_kwh ?? 0), slotMap, hourMap };
    }
    // hours array present but empty — still return kwh for bell-curve fallback
    if (res?.expected_kwh != null) {
      return { kwh: Number(res.expected_kwh), slotMap: null, hourMap: null };
    }

    // Legacy: just a daily total number
    const kwh = res?.expected_kwh ?? res?.forecast_kwh ?? res?.total_kwh ?? res?.kwh ?? null;
    return kwh != null ? { kwh: Number(kwh), hours: null } : null;
  } catch {
    return null;
  }
}

/**
 * Main load function. Fetches both data sources in parallel,
 * builds slots directly from the results, then renders the chart.
 * No intermediate reactive state that could cause watcher race conditions.
 */
async function loadAndRender(date) {
  loading.value    = true;
  chartSlots.value = [];
  solarKwh.value   = null;
  chart?.destroy();
  chart = null;

  // Fetch in parallel
  const [prices, solar] = await Promise.all([fetchPrices(date), fetchSolar(date)]);

  // solar = { kwh, slotMap: {"2026-02-27 08:00": Wh}, hourMap: {8: Wh} } | null
  const solarDaily  = solar?.kwh     ?? null;
  const solarSlots  = solar?.slotMap ?? null;  // datetime-keyed (primary)
  const solarHours  = solar?.hourMap ?? null;  // hour-keyed (fallback)

  // Build slots synchronously from the fetched data
  const sl = buildSlots(prices, solarDaily, date, solarSlots, solarHours);


  // Update reactive state for template (legend, pill, etc.)
  solarKwh.value   = solarDaily;
  chartSlots.value = sl;
  loading.value    = false;

  // Wait for Vue to flush DOM (canvas element needs to be visible/sized)
  await nextTick();


  // Render chart
  rebuildChart(sl);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────
let mq = null;
let resizeObs = null;

function onMqChange(e) {
  const wasMobile = isMobile.value;
  isMobile.value = e.matches;
  // Re-render chart if mobile state changed and we have data
  if (wasMobile !== isMobile.value && chartSlots.value.length) {
    rebuildChart(chartSlots.value);
  }
}

onMounted(async () => {
  // Detect mobile breakpoint (< 640px)
  mq = window.matchMedia('(max-width: 639px)');
  isMobile.value = mq.matches;
  mq.addEventListener('change', onMqChange);

  await loadThresholds();
  await loadAndRender(selectedDate.value);

  // Recolour current bar every 15 min
  const now        = new Date();
  const msToNext15 = ((15 - (now.getMinutes() % 15)) * 60 - now.getSeconds()) * 1_000;
  slotTimer = setTimeout(() => {
    recolourCurrentBar();
    slotTimer = setInterval(recolourCurrentBar, 15 * 60_000);
  }, msToNext15);
});

onUnmounted(() => {
  chart?.destroy();
  clearTimeout(slotTimer);
  clearInterval(slotTimer);
  mq?.removeEventListener('change', onMqChange);
});

watch(selectedDate, date => loadAndRender(date));
</script>

<style scoped>
/* ── Hidden date input overlay (must cover the label exactly) ── */
.dac-date-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border: none;
  padding: 0;
}

/* ── Range sliders — thumb pseudo-elements can't be expressed in Tailwind ── */
.dac-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 120px;
  height: 3px;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.dac-slider--green {
  background: linear-gradient(to right, #86efac, var(--color-secondary-muted, #e5e7eb));
}
.dac-slider--green::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #16a34a;
  cursor: pointer;
}

.dac-slider--red {
  background: linear-gradient(to right, var(--color-secondary-muted, #e5e7eb), #fca5a5);
}
.dac-slider--red::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #dc2626;
  cursor: pointer;
}

/* ── Loading spinner ── */
.dac-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-border, #e5e7eb);
  border-top-color: var(--color-text-tertiary, #9ca3af);
  border-radius: 50%;
  animation: dac-spin 0.8s linear infinite;
}
@keyframes dac-spin { to { transform: rotate(360deg); } }

/* ── Vue transition ── */
.dac-fade-enter-active,
.dac-fade-leave-active { transition: opacity 0.2s; }
.dac-fade-enter-from,
.dac-fade-leave-to    { opacity: 0; }
</style>