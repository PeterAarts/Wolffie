<template>
  <div class="sparkline-container" :style="{ height: '100px' }">
    <canvas ref="sparklineCanvas"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, onUnmounted } from 'vue';
import Chart from 'chart.js/auto';

const props = defineProps({
  data: { type: Array, default: () => [] }
});

const sparklineCanvas = ref(null);
let chartInstance = null;

const renderChart = () => {
  if (!sparklineCanvas.value || !props.data.length) return;
  if (chartInstance) chartInstance.destroy();

  const ctx = sparklineCanvas.value.getContext('2d');
  chartInstance = new Chart(ctx, {
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
      plugins: { legend: { display: false } },
      scales: {
        y: { display: false },
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            callback: function(value, index) {
              const date = new Date(this.getLabelForValue(value));
              const hours = date.getHours();
              return hours % 4 === 0 ? `${hours}:00` : '';       // Show tick every 4 hours as requested
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