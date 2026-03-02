<template>
  <div class="energy-flow-graph-container">
    <!-- Stats Overview Cards (optional) -->
    <div v-if="showStats && !loading && !error && stats" class="stats-overview mb-8">
      <div class="stat-card solar">
        <span class="label">Solar</span>
        <span class="value">{{ stats.pv_generation.toFixed(1) }} <small>kWh</small></span>
      </div>
      <div class="stat-card home">
        <span class="label">Home</span>
        <span class="value">{{ stats.load_consumption.toFixed(1) }} <small>kWh</small></span>
      </div>
      <div class="stat-card grid">
        <span class="label">Grid</span>
        <span class="value">
          {{ stats.grid_import.toFixed(1) }} <small>Import</small> / {{ stats.grid_export.toFixed(1) }} <small>export</small>
        </span>
      </div>
      <div class="stat-card battery">
        <span class="label">Battery</span>
        <span class="value">
          {{ stats.battery_charge.toFixed(1) }} <small>Charge</small> / {{ stats.battery_discharge.toFixed(1) }} <small>Discharge</small>
        </span>
      </div>
    </div>

    <!-- Chart Area -->
    <div class="energy-flow-graph">
      <div v-if="loading" class="loading-state">
        <span>Data laden...</span>
      </div>
      <div v-else-if="error" class="error-state">
        <span>{{ error }}</span>
        <button @click="loadData" class="retry-btn">Opnieuw proberen</button>
      </div>
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import Chart from 'chart.js/auto';
import { historyService } from '@/services/history';

const props = defineProps({
  period: { type: String, default: 'today' },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  granularity: { type: Number, default: 15 },
  height: { type: String, default: '200px' },
  showStats: { type: Boolean, default: false }
});

const emit = defineEmits(['data-loaded']);

const chartCanvas = ref(null);
const chartInstance = ref(null);
const loading = ref(false);
const error = ref(null);
const chartData = ref([]);
const stats = ref(null);

// Helper to calculate date range for multi-day periods
const getRangeDates = (period) => {
  const end = new Date().toISOString().split('T')[0];
  let days = 7;
  
  if (period === 'last-7-days') days = 7;
  else if (period === 'last-30-days') days = 30;
  else if (period === 'last-365-days') days = 365;
  
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  return { start, end };
};

const loadData = async () => {
  loading.value = true;
  error.value = null;
  
  try {
    let response;
    
    // Determine API call based on period
    if (props.period === 'today') {
      response = await historyService.getToday(props.granularity);
    } else if (props.period === 'date') {
      response = await historyService.getDateData(props.date, props.granularity);
    } else {
      // Use range endpoint for multi-day periods
      const { start, end } = getRangeDates(props.period);
      response = await historyService.getRange(start, end);
    }

    // New API structure: { stats, data }
    const { stats: apiStats, data: apiData } = response.data;
    
    // Store stats for display
    stats.value = apiStats;
    chartData.value = apiData;
    
    // Emit stats to parent component
    emit('data-loaded', apiStats);

    await nextTick();
    renderChart();
  } catch (err) {
    console.error('Error loading history data:', err);
    error.value = 'Kon historische data niet ophalen';
  } finally {
    loading.value = false;
  }
};

const renderChart = () => {
  if (!chartCanvas.value || chartData.value.length === 0) return;
  if (chartInstance.value) chartInstance.value.destroy();

  const ctx = chartCanvas.value.getContext('2d');
  
  // Check if this is range data (has 'date' field) or intraday data (has 'timestamp' field)
  const isRangeData = chartData.value[0]?.date !== undefined && chartData.value[0]?.timestamp === undefined;
  
  // Calculate min/max for power data to align zero lines
  const powerValues = isRangeData ? [] : chartData.value.flatMap(d => [
    d.solar || 0,
    d.home || 0,
    d.grid || 0,
    d.battery_power || 0
  ]);
  const minPower = isRangeData ? 0 : Math.min(...powerValues, 0);
  const maxPower = isRangeData ? 100 : Math.max(...powerValues, 0);
  
  // Calculate range for y-axis (power)
  const powerRange = Math.max(Math.abs(minPower), Math.abs(maxPower));
  // Add 15% padding above and below the power range so lines never touch the edges
  const PAD = 0.15;
  const yMax =  Math.ceil( powerRange * (1 + PAD));
  const yMin = minPower < 0 ? -Math.ceil(powerRange * (1 + PAD)) : 0;

  // SoC axis (y1) must share the same zero line as the power axis (y).
  // We extend it beyond 0–100 proportionally so 100% SoC never hits the top
  // and 0% never hits the bottom.  The ratio yMax/yMin maps power → SoC space.
  //
  // Visual chart height represents (yMax - yMin) units.
  // We want SoC 0-100 to occupy the same fraction as power 0-yMax,
  // then add the same proportional padding above 100 and below 0.
  const y1Max = Math.ceil(100 * (yMax / powerRange) * (1 + PAD));
  const y1Min = yMin === 0 ? 0 : -Math.ceil(100 * (Math.abs(yMin) / powerRange) * (1 + PAD));
  
  // Format labels: time for single-day view, date for multi-day view
  const labels = chartData.value.map(d => {
    const dt = new Date(d.timestamp || d.date);
    return props.period === 'today' || props.period === 'date' 
      ? dt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      : dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
  });

  chartInstance.value = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: isRangeData ? [
        {
          label: 'Solar (kWh)',
          data: chartData.value.map(d => d.solar || 0),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Home (kWh)',
          data: chartData.value.map(d => d.home || 0),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Grid Import (kWh)',
          data: chartData.value.map(d => d.grid_import || 0),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Grid Export (kWh)',
          data: chartData.value.map(d => d.grid_export || 0),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Battery Charge (kWh)',
          data: chartData.value.map(d => d.battery_charge || 0),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Battery Discharge (kWh)',
          data: chartData.value.map(d => d.battery_discharge || 0),
          borderColor: '#a78bfa',
          backgroundColor: 'rgba(167, 139, 250, 0.1)',
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y'
        }
      ] : [
        {
          label: 'Solar(W)',
          data: chartData.value.map(d => d.solar || 0),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
          pointRadius: 0,
          borderWidth: 2,
          pointHoverRadius: 4
        },
        {
          label: 'Home  (W)',
          data: chartData.value.map(d => d.home || 0),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: false,
          tension: 0.4,
          yAxisID: 'y',
          pointRadius: 0,
          borderWidth: 2,
          pointHoverRadius: 4
        },
        {
          label: 'Grid (W)',
          data: chartData.value.map(d => d.grid || 0),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: false,
          tension: 0.4,
          yAxisID: 'y',
          pointRadius: 0,
          borderWidth: 2,
          pointHoverRadius: 4
        },
        {
          label: 'Battery (W)',
          data: chartData.value.map(d => d.battery_power || 0),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
          pointRadius: 0,
          borderWidth: 2,
          pointHoverRadius: 4
        },
        {
          label: 'Battery SoC (%)',
          data: chartData.value.map(d => d.battery_soc || 0),
          borderColor: '#6B7280',
          backgroundColor: '#F2F3FA',
          fill: true,
          yAxisID: 'y1',
          borderDash: [0, 0],
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
          pointHoverRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
              layout: {
            padding: 0
        },
      plugins: {
        legend: { 
          position: 'bottom',
          labels: {usePointStyle: true,padding: 15,font: {size: 11,}}
        },
        tooltip: {
          backgroundColor: 'rgba(255,255, 255, 1)',
          bodyColor: '#111827',
          padding: 12,
          titleColor: '#111827',
          boxPadding: 10,
          titleFont: {size: 13,weight: 'bold',},
          bodyFont: {size: 12,color: '#111827'},
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                if (context.dataset.yAxisID === 'y1') {
                  // Battery SoC - show percentage
                  label += context.parsed.y.toFixed(1) + '%';
                } else {
                  // Power values - show watts
                  label += context.parsed.y.toFixed(0) + ' W';
                }
              }
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,  // Changed from false to true
          position: 'left',
          padding: { top: 40, bottom: 10 },
          min: yMin,
          max: yMax,
          title: { 
            display: false  // Hide the "Vermogen (W)" title for cleaner look
          },
          ticks: {
            font: { size: 11 },
            color: '#6b7280',
            // Only show the "0" label
            callback: function(value) {
              return value === 0 ? '0' : '';
            }
          },
          grid: {
            color: (context) => {
              // Make zero line more prominent, hide other grid lines
              return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0)';
            },
            lineWidth: (context) => {
              return context.tick.value === 0 ? 2 : 0;
            },
            drawTicks: false
          },
          border: {
            display: false
          }
        },
        y1: {
          type: 'linear',
          display: false,
          padding: {top: 40, bottom: 10},
          position: 'right',
          min: y1Min,
          max: y1Max, // Add some padding above 100% for better visualization
          grid: { drawOnChartArea: true }
        },
        x: {
          display: true,
          ticks: {
            font: { size: 10 },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            autoSkipPadding: 50,
            callback: function(value, index, ticks) {
              const label = this.getLabelForValue(value);
              // For time-based labels (HH:MM format)
              if (label && label.includes(':')) {
                const [hours, minutes] = label.split(':');
                // Only show labels at even hours (00:00, 02:00, 04:00, etc.)
                if (parseInt(hours) % 2 === 0 && minutes === '00') {
                  return hours + ':00';
                }
                return '';
              }
              // For date-based labels, show every other label
              if (index % 2 === 0) {
                return label;
              }
              return '';
            },
            color: '#9ca3af',
            padding: 8
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
            drawTicks: false,
            tickLength: 0
          },
          border: {
            display: false
          }
        }
      }
    }
  });
};

watch(() => [props.period, props.date, props.granularity], loadData);

onMounted(loadData);

onUnmounted(() => {
  if (chartInstance.value) chartInstance.value.destroy();
});
</script>

<style scoped>
.energy-flow-graph-container    {display: flex;flex-direction: column;width: 100%;}
.stats-overview                 {display: grid;grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));gap: 16px;}
.stat-card                      {background-color: var(--color-bg-primary, #f8f9fa);padding: 20px;display: flex;flex-direction: column;gap: 8px;border-radius:0; border-width:0px;}
.stat-card .label               {font-size: 11px;text-transform: uppercase;color: var(--color-text-secondary, #6b7280);font-weight: 600;letter-spacing: 0.5px;}
.stat-card .value               {font-size: 20px;font-weight: 700;font-family: 'Rubik', sans-serif;color: var(--color-text-primary, #111827);line-height: 1.2;}
.stat-card .value small         {font-size: 12px;font-weight: 500;opacity: 0.7;margin-left: 4px;}
.stat-card.solar .value         {color: #f59e0b; }
.stat-card.home .value          {color: #3b82f6; }
.stat-card.grid .value          {color: #ef4444; }
.stat-card.battery .value       {color: #10b981; }
.energy-flow-graph              {width: 100%;position: relative;height: v-bind(height);}
.loading-state, .error-state    {display: flex;flex-direction: column;align-items: center;justify-content: center;height: 100%;gap: 12px;font-family: 'Rubik', sans-serif;}
.loading-state span             {color: var(--color-text-secondary, #6b7280);font-size: 14px;}
.error-state span               {color: #ef4444;font-size: 14px;text-align: center;}
.retry-btn                      {padding: 10px 20px;background: var(--color-text-primary, #111827);color: var(--color-bg-primary, #ffffff);border: none;border-radius: 8px;cursor: pointer;font-family: 'Rubik', sans-serif;font-size: 14px;font-weight: 500;transition: all 0.2s ease;}
.retry-btn:hover                {opacity: 0.9;transform: translateY(-1px);}
.retry-btn:active               {transform: translateY(0);}

@media (max-width: 768px) {
  .stats-overview       {grid-template-columns: repeat(2, 1fr);}
  .energy-flow-graph    {padding: 12px;}
  .stat-card            {padding: 16px;}
  .stat-card .value     {font-size: 18px;}
}
</style>