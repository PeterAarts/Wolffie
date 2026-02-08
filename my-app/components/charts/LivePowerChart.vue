<!-- src/components/charts/LivePowerChart.vue -->
<template>
  <div class="live-power-chart">
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Chart, registerables } from 'chart.js';
import { CHART_COLORS } from '@/utils/constants';

Chart.register(...registerables);

const props = defineProps({
  data: {
    type: Array,
    default: () => []
  },
  maxDataPoints: {
    type: Number,
    default: 60
  }
});

const chartCanvas = ref(null);
let chartInstance = null;

const initChart = () => {
  if (!chartCanvas.value) return;

  const ctx = chartCanvas.value.getContext('2d');
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Solar',
          data: [],
          borderColor: CHART_COLORS.SOLAR,
          backgroundColor: `${CHART_COLORS.SOLAR}20`,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Battery',
          data: [],
          borderColor: CHART_COLORS.BATTERY,
          backgroundColor: `${CHART_COLORS.BATTERY}20`,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Grid',
          data: [],
          borderColor: CHART_COLORS.GRID,
          backgroundColor: `${CHART_COLORS.GRID}20`,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Load',
          data: [],
          borderColor: CHART_COLORS.LOAD,
          backgroundColor: `${CHART_COLORS.LOAD}20`,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: {
            size: 13
          },
          bodyFont: {
            size: 12
          },
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              label += context.parsed.y.toFixed(2) + ' W';
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: 'Time'
          },
          grid: {
            display: false
          }
        },
        y: {
          display: true,
          title: {
            display: true,
            text: 'Power (W)'
          },
          beginAtZero: true,
          grid: {
            color: '#f3f4f6'
          }
        }
      },
      animation: {
        duration: 750
      }
    }
  });
};

const updateChart = (newData) => {
  if (!chartInstance || !newData || newData.length === 0) return;

  const latestData = newData.slice(-props.maxDataPoints);
  
  chartInstance.data.labels = latestData.map(d => {
    const date = new Date(d.timestamp || Date.now());
    return date.toLocaleTimeString();
  });
  
  chartInstance.data.datasets[0].data = latestData.map(d => d.solar || 0);
  chartInstance.data.datasets[1].data = latestData.map(d => Math.abs(d.battery || 0));
  chartInstance.data.datasets[2].data = latestData.map(d => Math.abs(d.grid || 0));
  chartInstance.data.datasets[3].data = latestData.map(d => d.load || 0);
  
  chartInstance.update('none'); // Update without animation for real-time feel
};

watch(() => props.data, (newData) => {
  updateChart(newData);
}, { deep: true });

onMounted(() => {
  initChart();
  if (props.data.length > 0) {
    updateChart(props.data);
  }
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy();
  }
});
</script>

<style scoped>
.live-power-chart {
  width: 100%;
  height: 300px;
  padding: 1rem 0;
}
</style>