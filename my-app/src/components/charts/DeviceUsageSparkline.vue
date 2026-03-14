<template>
  <div class="sparkline-container" :style="{ height: '100px' }">
    <canvas ref="sparklineCanvas"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, onUnmounted } from 'vue';
import Chart from 'chart.js/auto';
import { Tooltip } from 'chart.js';

const props = defineProps({
  data: { type: Array, default: () => [] }
});

const sparklineCanvas = ref(null);
let chartInstance = null;

// Fixed top-right positioner — registered once per component mount
Chart.registry.plugins  // ensure Chart is ready
Tooltip.positioners.topRight = function(elements, eventPosition) {
  const chart = this.chart;
  return {
    x: chart.chartArea.right,
    y: chart.chartArea.top,
    xAlign: 'right',
    yAlign: 'bottom',
  };
};

// ── Hairline plugin ───────────────────────────────────────────────────────────
const hairlinePlugin = {
  id: 'hairline',
  afterDraw(chart) {
    const { ctx, chartArea, tooltip } = chart;
    if (!tooltip || !tooltip._active || tooltip._active.length === 0) return;

    const x = tooltip._active[0].element.x;
    if (x < chartArea.left || x > chartArea.right) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#9ca3af';
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();
  }
};

const renderChart = () => {
  if (!sparklineCanvas.value || !props.data.length) return;
  if (chartInstance) chartInstance.destroy();

  // Build a set of which tick labels have already been rendered,
  // so each hour label appears exactly once even when multiple
  // data points share the same hour bucket.
  const seenLabels = new Set();

  const ctx = sparklineCanvas.value.getContext('2d');
  chartInstance = new Chart(ctx, {
    plugins: [hairlinePlugin],
    type: 'line',
    data: {
      labels: props.data.map(d => d.timestamp),
      datasets: [{
        data: props.data.map(d => d.power),
        borderColor: '#374151',
        backgroundColor: '',
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          position: 'topRight',
          backgroundColor: 'rgba(255,255,255,0.85)',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          titleColor: '#1e293b',
          bodyColor: '#475569',
          padding: 6,
          callbacks: {
            title: () => '',
            label: (item) => {
              const date = new Date(item.label);
              const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return ` ${time}  ${item.parsed.y.toFixed(1)} W`;
            }
          }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        y: { display: false },
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: false,  // We handle deduplication ourselves below
            callback: function(value, index) {
              const date = new Date(this.getLabelForValue(value));
              const hours = date.getHours();
              const minutes = date.getMinutes();

              // Only show on exact 4-hour boundaries (0, 4, 8, 12, 16, 20)
              if (hours % 4 !== 0 || minutes !== 0) return '';

              const label = `${String(hours).padStart(2, '0')}:00`;

              // Deduplicate: only render the first data point that maps to this hour
              if (seenLabels.has(label)) return '';
              seenLabels.add(label);
              return label;
            },
            font: { size: 9 },
            color: '#9ca3af'
          },
          grid: { display: false }
        }
      }
    }
  });
};

watch(() => props.data, renderChart, { deep: true });
onMounted(renderChart);
onUnmounted(() => chartInstance?.destroy());
</script>