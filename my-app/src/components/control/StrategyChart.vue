<!-- src/components/control/StrategyChart.vue -->
<!--
  Strategy Chart — rolling 24-36h plan visualisation.
  Reads entirely from strategyStore — no API calls needed.

  Layers (back to front):
    1. Price bars        — left Y axis (ct/kWh), green/grey/red by percentile
    2. Solar area        — hidden right axis, amber fill area
    3. Predicted SoC     — right axis 0–100%, green above floor / red below
    4. Actual SoC dot    — single scatter point at current time
    5. Floor line        — dashed red line at minSocPct (custom plugin)
    6. Now line          — dashed vertical at current slot (custom plugin)
-->
<template>
  <div class="strategy-chart">
    <div class="strategy-chart__legend">
      <span class="sc-legend-item">
        <span class="sc-legend-swatch" style="background:#22c55e; border-radius:50%"></span>
        Predicted SoC
      </span>
      <span class="sc-legend-item">
        <span class="sc-legend-swatch" style="background:#3b82f6; border-radius:50%"></span>
        Actual SoC
      </span>
      <span class="sc-legend-item">
        <span class="sc-legend-swatch" style="background:rgba(245,158,11,0.7)"></span>
        Solar forecast
      </span>
      <span class="sc-legend-item">
        <span class="sc-legend-swatch" style="background:#d1d5db; border-radius:2px"></span>
        Price
      </span>
      <span class="sc-legend-item">
        <span class="sc-legend-swatch" style="background:rgba(239,68,68,0.4); border-radius:0"></span>
        SoC floor ({{ minSocPct }}%)
      </span>
    </div>
    <div class="strategy-chart__canvas-wrap">
      <canvas ref="canvasEl" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Chart, registerables } from 'chart.js';
import { useStrategyStore } from '@/stores/strategy';

Chart.register(...registerables);

const emit = defineEmits(['chart-area']);

const strategyStore = useStrategyStore();
const canvasEl      = ref(null);
let chart           = null;

/**
 * Emit the chart inner area bounds as percentages of total canvas width.
 * StrategyPanel uses this to apply matching left/right margin to the
 * timeline ruler so tick positions align with chart X axis ticks.
 */
function emitChartArea() {
  if (!chart || !canvasEl.value) return;
  const ca     = chart.chartArea;
  const totalW = canvasEl.value.offsetWidth;
  if (!ca || !totalW) return;
  emit('chart-area', {
    leftPct : (ca.left  / totalW) * 100,
    rightPct: ((totalW - ca.right) / totalW) * 100,
    leftPx  : ca.left,
    rightPx : totalW - ca.right,
  });
}

// ── Store accessors ────────────────────────────────────────────────────────

const slots = computed(() => {
  const raw = strategyStore.dayPlan;
  return Array.isArray(raw) ? raw : [];
});

const windowStart = computed(() =>
  strategyStore.windowStart ? new Date(strategyStore.windowStart) : null
);

const minSocPct = computed(() =>
  strategyStore.config?.minSocPct ?? 20
);

// ── Current slot index ─────────────────────────────────────────────────────

const currentSlotIndex = computed(() => {
  const start = windowStart.value;
  if (!start || !slots.value.length) return -1;
  const elapsed = (Date.now() - start.getTime()) / (15 * 60 * 1000);
  return Math.max(0, Math.min(slots.value.length - 1, Math.floor(elapsed)));
});

// ── Dataset computeds ──────────────────────────────────────────────────────

const labels = computed(()    => slots.value.map(s => `${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}`) );
const priceData = computed(() => slots.value.map(s => s.priceCtKwh ?? null));
const solarData = computed(() => slots.value.map(s => (s.solarForecastW ?? 0) / 1000)  ); // W → kW
const socData = computed(()   => slots.value.map(s => s.simSocPct ?? null) );
const priceColors = computed(() => {
  const valid = priceData.value.filter(p => p !== null);
  if (!valid.length) return slots.value.map(() => '#e5e7eb');

  const minP  = Math.min(...valid);
  const maxP  = Math.max(...valid);
  const range = maxP - minP || 1;
  const green = minP + range * 0.10;
  const red   = minP + range * 0.90;
  const nowIdx = currentSlotIndex.value;

  return priceData.value.map((p, i) => {
    if (i === nowIdx)  return '#222';
    if (p === null)    return '#f8f8f8';
    if (p <= 0)        return 'rgba(134,197,94,0.15)';
    if (p <= green)    return 'rgba(34,197,94,1.0)';
    if (p >= red)      return 'rgba(239,68,68,0.80)';
    return '#d1d5db';
  });
});

// Actual SoC from latest decision context if available
const actualSocScatter = computed(() => {
  const nowIdx = currentSlotIndex.value;
  // Try to get actual SoC from strategyStore decision context
  const soc = strategyStore.decision?.soc ?? null;
  if (soc === null || nowIdx < 0) return [];
  return [{ x: nowIdx, y: soc }];
});

// ── Custom plugins ─────────────────────────────────────────────────────────

// Dashed floor line at minSocPct on the SoC axis
const floorLinePlugin = {
  id: 'scFloorLine',
  afterDraw(ch) {
    const ySoc = ch.scales.ySoc;
    if (!ySoc) return;
    const y             = ySoc.getPixelForValue(minSocPct.value);
    const { left, right } = ch.chartArea;
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.strokeStyle = 'rgba(239,68,68,0.5)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    // Label
    ctx.font      = '9px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(239,68,68,0.6)';
    ctx.fillText(`${minSocPct.value}%`, right + 4, y + 3);
    ctx.restore();
  },
};

// Vertical "now" line at current slot
const nowLinePlugin = {
  id: 'scNowLine',
  afterDraw(ch) {
    const idx = currentSlotIndex.value;
    if (idx < 0) return;
    const meta = ch.getDatasetMeta(0);   // price bars
    if (!meta?.data?.[idx]) return;
    const x           = meta.data[idx].x;
    const { top, bottom } = ch.chartArea;
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = 'rgba(99,102,241,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    // "Now" label at top
    ctx.font      = 'bold 9px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(99,102,241,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('now', x, top - 2);
    ctx.restore();
  },
};

// ── Chart build ────────────────────────────────────────────────────────────

function buildConfig() {
  const sl = slots.value;
  if (!sl.length) return null;

  const tickColor  = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-text-tertiary').trim() || '#9ca3af';
  const gridColor  = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-border').trim() || '#f3f4f6';

  const maxSolar = Math.max(...solarData.value, 0.1);

  // Aligned-zero: compute yPrice range, then derive negative floors for ySoc
  // and ySolar so that 0ct / 0% / 0 kW all land on the same pixel row.
  const prices    = priceData.value.filter(p => p !== null);
  const priceMin  = prices.length ? Math.min(0, ...prices) : 0;
  const priceMax  = prices.length ? Math.max(0, ...prices) : 15;
  const zeroFrac  = (priceMax - priceMin) > 0 ? -priceMin / (priceMax - priceMin) : 0;
  // Solve for each axis: (0 − axisMin) / (axisMax − axisMin) = zeroFrac
  //   → axisMin = zeroFrac * axisMax / (zeroFrac − 1)
  const ySocMin   = zeroFrac > 0 ? (100 * zeroFrac) / (zeroFrac - 1) : 0;
  const ySolarMax = maxSolar * 1.25;
  const ySolarMin = zeroFrac > 0 ? (ySolarMax * zeroFrac) / (zeroFrac - 1) : 0;

  return {
    type: 'bar',
    data: {
      labels   : labels.value,
      datasets : [
        // 0 — Price bars
        {
          type              : 'bar',
          label             : 'Price (ct/kWh)',
          data              : priceData.value,
          backgroundColor   : priceColors.value,
          borderWidth       : 0,
          borderRadius      : 2,
          yAxisID           : 'yPrice',
          order             : 3,
          barPercentage     : 0.5,
          categoryPercentage: 0.65,
        },
        // 1 — Solar area
        {
          type            : 'line',
          label           : 'Solar (kW)',
          data            : solarData.value,
          borderColor     : 'rgba(245,158,11,0.75)',
          backgroundColor : 'rgba(245,158,11,0.09)',
          borderWidth     : 1.5,
          pointRadius     : 0,
          pointHoverRadius: 3,
          tension         : 0.45,
          fill            : true,
          yAxisID         : 'ySolar',
          order           : 2,
        },
        // 2 — Predicted SoC line
        {
          type            : 'line',
          label           : 'Predicted SoC (%)',
          data            : socData.value,
          borderColor     : '#22c55e',
          backgroundColor : 'transparent',
          borderWidth     : 2.5,
          pointRadius     : 0,
          pointHoverRadius: 5,
          tension         : 0.3,
          fill            : false,
          yAxisID         : 'ySoc',
          order           : 1,
          segment         : {
            borderColor: ctx => {
              const floor = minSocPct.value;
              const y0    = ctx.p0.parsed.y;
              const y1    = ctx.p1.parsed.y;
              return (y0 < floor || y1 < floor) ? '#ef4444' : '#22c55e';
            },
          },
        },
        // 3 — Actual SoC scatter dot
        {
          type            : 'scatter',
          label           : 'Actual SoC',
          data            : actualSocScatter.value,
          backgroundColor : '#3b82f6',
          borderColor     : '#ffffff',
          borderWidth     : 2.5,
          pointRadius     : 7,
          pointHoverRadius: 9,
          yAxisID         : 'ySoc',
          order           : 0,
        },
      ],
    },
    options: {
      responsive         : true,
      maintainAspectRatio: false,
      interaction        : { mode: 'index', intersect: false },
      plugins: {
        legend : { display: false },
        tooltip: {
          backgroundColor: '#ffffff',
          borderColor    : '#e5e7eb',
          borderWidth    : 1,
          padding        : { top: 8, right: 14, bottom: 8, left: 14 },
          titleColor     : '#111827',
          titleFont      : { size: 11, weight: '600' },
          bodyColor      : '#374151',
          bodyFont       : { size: 11 },
          bodySpacing    : 5,
          boxWidth       : 8,
          boxHeight      : 8,
          boxPadding     : 4,
          usePointStyle  : true,
          filter         : item => {
            // Hide scatter from tooltip unless it has data
            if (item.dataset.type === 'scatter') return item.parsed.y != null;
            return true;
          },
          callbacks: {
            title: items => {
              const s = sl[items[0]?.dataIndex];
              if (!s) return '';
              if (windowStart.value) {
                const dt      = new Date(windowStart.value.getTime() + s.slot * 15 * 60 * 1000);
                const hh      = String(dt.getHours()).padStart(2, '0');
                const mm      = String(dt.getMinutes()).padStart(2, '0');
                const nextDay = dt.getDate() !== windowStart.value.getDate();
                return nextDay ? `${hh}:${mm} (tomorrow)` : `${hh}:${mm}`;
              }
              // Fallback: no windowStart — parse datetime string as local time
              const dt = new Date(s.datetime);
              return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
            },
            label: ctx => {
              switch (ctx.dataset.yAxisID) {
                case 'yPrice': {
                  const v = ctx.parsed.y;
                  return v != null ? `  Price: ${v.toFixed(2)} ct/kWh` : '  Price: —';
                }
                case 'ySolar':
                  return `  Solar: ${(ctx.parsed.y * 1000).toFixed(0)} W`;
                case 'ySoc':
                  if (ctx.dataset.type === 'scatter')
                    return `  Actual SoC: ${ctx.parsed.y}%`;
                  return `  Predicted SoC: ${ctx.parsed.y ?? '—'}%`;
                default:
                  return ctx.formattedValue;
              }
            },
          },
        },
      },
      scales: {
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
              // Show tick every 3h from windowStart — identical logic to ruler.
              // 12 slots = 3h. Slot 0 is always windowStart so slot % 12 === 0
              // lands on the same times as the ruler's h += 3 loop.
              if (s.slot % 12 !== 0) return '';
              if (windowStart.value) {
                const dt = new Date(windowStart.value.getTime() + s.slot * 15 * 60 * 1000);
                const hh = String(dt.getHours()).padStart(2, '0');
                return dt.getDate() !== windowStart.value.getDate()
                  ? `${hh}:00+`
                  : `${hh}:00`;
              }
              return `${String(s.hour).padStart(2, '0')}:00`;
            },
          },
        },
        yPrice: {
          type    : 'linear',
          position: 'left',
          min     : priceMin,
          max     : priceMax,
          grid    : { color: gridColor },
          ticks   : {
            color   : tickColor,
            font    : { size: 10 },
            callback: v => `${v.toFixed(0)}ct`,
          },
          title: {
            display: true,
            text   : 'ct / kWh',
            color  : tickColor,
            font   : { size: 9 },
          },
        },
        ySoc: {
          type    : 'linear',
          position: 'right',
          min     : ySocMin,
          max     : 100,
          grid    : { drawOnChartArea: false },
          ticks   : {
            color    : tickColor,
            font     : { size: 10 },
            callback : v => v < 0 ? '' : `${v}%`,
          },
          title: {
            display: true,
            text   : 'Battery %',
            color  : tickColor,
            font   : { size: 9 },
          },
        },
        // Solar uses a hidden axis so it doesn't fight SoC for the right axis scale
        ySolar: {
          type    : 'linear',
          position: 'right',
          min     : ySolarMin,
          max     : ySolarMax,
          display : false,
          grid    : { drawOnChartArea: false },
        },
      },
      animation: { duration: 250 },
    },
    plugins: [floorLinePlugin, nowLinePlugin, {
      id: 'scAlignZero',
      // Chart.js 4 signature: first arg is Chart instance, second is { scale }
      afterDataLimits(_, { scale }) {
        if (scale.id === 'ySoc') {
          scale.min = ySocMin;
          scale.max = 100;
        } else if (scale.id === 'ySolar') {
          scale.min = ySolarMin;
          scale.max = ySolarMax;
        }
      },
    }],
  };
}

function rebuild() {
  if (!canvasEl.value) return;
  chart?.destroy();
  chart = null;
  const cfg = buildConfig();
  if (!cfg) return;
  chart = new Chart(canvasEl.value, cfg);
  // Two rAF frames so Chart.js fully settles chartArea before we measure
  requestAnimationFrame(() => requestAnimationFrame(emitChartArea));
}

// Light update when only decision changes (avoid full rebuild)
function updateDecision() {
  if (!chart) { rebuild(); return; }
  // Update actual SoC scatter
  chart.data.datasets[3].data = actualSocScatter.value;
  // Update price bar colours (now-slot highlight)
  chart.data.datasets[0].backgroundColor = priceColors.value;
  chart.update('none');
  requestAnimationFrame(() => requestAnimationFrame(emitChartArea));
}

watch(() => strategyStore.dayPlan, rebuild, { deep: false });
watch(() => strategyStore.decision, updateDecision);
watch(() => strategyStore.config, rebuild, { deep: false });

let _resizeObserver = null;

onMounted(() => {
  rebuild();
  // Re-emit on canvas resize so alignment stays correct on window resize
  if (canvasEl.value && window.ResizeObserver) {
    _resizeObserver = new ResizeObserver(() =>
      requestAnimationFrame(() => requestAnimationFrame(emitChartArea))
    );
    _resizeObserver.observe(canvasEl.value);
  }
});

onUnmounted(() => {
  chart?.destroy();
  chart = null;
  _resizeObserver?.disconnect();
});
</script>

<style scoped>
.strategy-chart         { display: flex;flex-direction: column;gap: 0.5rem;width: 100%;}
.strategy-chart__canvas-wrap 
                        { position: relative;height: 200px;width: 100%;}
.strategy-chart__canvas-wrap canvas 
                        { width: 100% !important;height: 100% !important;}
.strategy-chart__legend { display: flex;gap: 1rem;flex-wrap: wrap;padding: 0 3rem;}
.sc-legend-item         { display: flex;align-items: center;gap: 0.375rem;font-size: 0.7rem;color: var(--color-text-secondary);white-space: nowrap;}
.sc-legend-swatch       { width: 10px;height: 10px;flex-shrink: 0;border-radius: 50%;}
</style>