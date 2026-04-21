<template>
  <div class="smart-device-graph-container">

    <!-- Stats cards — mirrors EnergyFlowGraph showStats layout -->
    <div v-if="showStats && !loading && deviceStats.length > 0" class="stats-overview mb-8 ml-auto">
      <div
        v-for="(device, idx) in deviceStats"
        :key="device.device_id"
        class="stat-card"
      >
        <!-- Colour dot matches chart line -->
        <span class="label">
         <!-- <span class="tt-dot" :style="{ backgroundColor: palette[idx % palette.length] }"></span>-->
          {{ device.device_name }}
        </span>
        <span class="value">
          {{ device.daily_kwh.toFixed(2) }} <small>kWh</small>
        </span>
      </div>
    </div>

    <!-- Chart area — same structure as EnergyFlowGraph -->
    <div class="smart-device-graph" style="position:relative;">
      <div v-if="loading" class="loading-state">
        <span>{{ $t('common.loading') }}</span>
      </div>
      <div v-else-if="error" class="error-state">
        <span>{{ error }}</span>
        <button @click="fetchData" class="retry-btn">{{ $t('common.retry') }}</button>
      </div>
      <div v-else-if="datasets.length === 0 && !loading" class="empty-state">
        <span>{{ $t('dashboard.smartDevices.noUsage') }}</span>
      </div>
      <canvas v-show="datasets.length > 0" ref="canvasRef"></canvas>
      <!-- Custom HTML tooltip — same style as EnergyFlowGraph -->
      <div ref="tooltipEl" style="display:none;position:absolute;pointer-events:none;background:#ffffff;border:1px solid #e4e7ec;border-radius:10px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,.08);min-width:170px;z-index:100;font-family:system-ui,sans-serif;"></div>
    </div>

  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import Chart from 'chart.js/auto'
import { useDeviceChartData } from '@/composables/useDeviceChartData.js'

// ── Props — identical interface to EnergyFlowGraph ───────────────────────────
const props = defineProps({
  date:        { type: String,  required: true },
  period:      { type: String,  default: 'day' },
  autoUpdate:  { type: Boolean, default: false },
  height:      { type: String,  default: '250px' },
  granularity: { type: Number,  default: 5 },
  showStats:   { type: Boolean, default: false },
})

// Palette exposed for template colour dots — must match composable order
const palette = [
  '#7c3aed', '#db2777', '#059669', '#d97706',
  '#0284c7', '#9333ea', '#16a34a', '#dc2626',
  '#0891b2', '#65a30d',
]

// ── Reactive prop refs ───────────────────────────────────────────────────────
const dateRef        = computed(() => props.date)
const granularityRef = computed(() => props.granularity)

const { deviceStats, datasets, labels, loading, error, fetchData } =
  useDeviceChartData(dateRef, granularityRef)

// ── Chart ────────────────────────────────────────────────────────────────────
const canvasRef  = ref(null)
const tooltipEl  = ref(null)
let chartInstance = null

function buildChart() {
  if (!canvasRef.value || datasets.value.length === 0) return
  destroyChart()

  const ctx = canvasRef.value.getContext('2d')

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   labels.value,
      datasets: datasets.value,
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      interaction: {
        mode:      'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false },   // Stats cards serve as legend
        tooltip: {
          enabled: false,             // Use custom HTML tooltip below
          external(context) {
            const el = tooltipEl.value
            if (!el) return

            const { tooltip } = context
            if (tooltip.opacity === 0) {
              el.style.display = 'none'
              return
            }

            // Title: HH:MM from label
            const title = tooltip.title?.[0] ?? ''

            // Rows: one per visible dataset
            const rows = tooltip.dataPoints
              .filter(dp => dp.parsed.y !== null)
              .map(dp => {
                const color = dp.dataset.borderColor
                return `
                  <div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                    <span style="flex:1;font-size:13px;color:#6b7280;">${dp.dataset.label}</span>
                    <span style="font-size:13px;font-weight:600;color:#111827;font-variant-numeric:tabular-nums;">${dp.parsed.y.toFixed(0)} W</span>
                  </div>`
              }).join('')

            el.innerHTML = `
              <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${title}</div>
              ${rows}`
            el.style.display = 'block'

            const chartEl       = context.chart.canvas
            const containerWidth = chartEl.parentElement.offsetWidth
            let left = tooltip.caretX + 14
            if (left + 185 > containerWidth) left = tooltip.caretX - 185 - 14
            el.style.left = left + 'px'
            el.style.top  = Math.max(0, tooltip.caretY - (el.offsetHeight / 2)) + 'px'
          }
        },
      },
      scales: {
        x: {
          display: true,
          ticks: {
            font:        { size: 10 },
            maxRotation: 0,
            minRotation: 0,
            autoSkip:    false,
            color:       '#9ca3af',
            padding:     6,
            // Only show even hours — same logic as EnergyFlowGraph
            callback(value) {
              const label = this.getLabelForValue(value)
              if (!label || !/^\d{2}:\d{2}$/.test(label)) return ''
              const [hh, mm] = label.split(':')
              return (mm === '00' && parseInt(hh, 10) % 2 === 0) ? label : ''
            },
          },
          grid: {
            color(context) {
              const label = context.chart.data.labels[context.index]
              if (!label || !/^\d{2}:\d{2}$/.test(label)) return 'transparent'
              const [hh, mm] = label.split(':')
              return (mm === '00' && parseInt(hh, 10) % 2 === 0)
                ? 'rgba(0,0,0,0.07)' : 'transparent'
            },
            drawTicks:  false,
            tickLength: 0,
          },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          display:     true,
          position:    'left',
          ticks: {
            font:  { size: 11 },
            color: '#6b7280',
            // Only label zero — keeps it clean
            callback: value => value === 0 ? '0' : '',
          },
          grid: {
            color:     ctx => ctx.tick.value === 0 ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0)',
            lineWidth: ctx => ctx.tick.value === 0 ? 2 : 0,
            drawTicks: false,
          },
          border:  { display: false },
          title: {
            display: true,
            text:    'W',
            color:   '#9ca3af',
            font:    { size: 11 },
          },
        },
      },
    },
  })
}

function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy()
    chartInstance = null
  }
}

function updateChart() {
  if (!chartInstance) {
    buildChart()
    return
  }
  chartInstance.data.labels   = labels.value
  chartInstance.data.datasets = datasets.value
  chartInstance.update('none')
}

// Rebuild when data arrives
watch([datasets, labels], async () => {
  await nextTick()
  if (datasets.value.length > 0) updateChart()
  else destroyChart()
})

// ── Auto-update polling ──────────────────────────────────────────────────────
let pollTimer = null

watch(() => props.autoUpdate, (val) => {
  clearInterval(pollTimer)
  if (val) pollTimer = setInterval(fetchData, 60_000)
}, { immediate: true })

onMounted(() => {
  if (datasets.value.length > 0) buildChart()
})

onUnmounted(() => {
  clearInterval(pollTimer)
  destroyChart()
})
</script>

<style scoped>
/* Container */
.smart-device-graph-container   { display: flex; flex-direction: column; width: 100%; overflow: hidden; }

/* Chart area — height driven by prop via v-bind */
.smart-device-graph             { width: 100%; position: relative; height: v-bind(height); }

/* States — mirrors EnergyFlowGraph */
.loading-state,
.error-state,
.empty-state                    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; font-family: 'Rubik', sans-serif; }
.loading-state span,
.empty-state span               { color: var(--color-text-secondary, #6b7280); font-size: 14px; }
.error-state span               { color: #ef4444; font-size: 14px; text-align: center; }
.retry-btn                      { padding: 10px 20px; background: var(--color-text-primary, #111827); color: var(--color-bg-primary, #ffffff); border: none; border-radius: var(--radius-sm); cursor: pointer; font-family: 'Rubik', sans-serif; font-size: 14px; font-weight: 500; transition: all 0.2s ease; }
.retry-btn:hover                { opacity: .9; transform: translateY(-1px); }


.tt-dot                         { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.5rem; flex-shrink: 0; }

@media (max-width: 768px) {
  .stats-overview   { grid-template-columns: repeat(2, 1fr); }
}
</style>