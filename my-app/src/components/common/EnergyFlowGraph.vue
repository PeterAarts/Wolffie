<template>
  <div class="energy-flow-graph">
    <div v-if="loading" class="loading-state">
      <span>Loading graph data...</span>
    </div>
    <div v-else-if="error" class="error-state">
      <span>{{ error }}</span>
    </div>
    <div v-else class="graph-container">
      <div class="graph-controls">
        <button @click="resetZoom" class="reset-zoom-btn" title="Reset zoom">
          <span>🔍</span> Reset Zoom
        </button>
      </div>
      <canvas ref="chartCanvas"></canvas>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { useRealtimeStore } from '@/stores/realtime';
import api from '@/services/api';

// Register Chart.js components and zoom plugin
Chart.register(...registerables, zoomPlugin);

const props = defineProps({
  period: {
    type: String,
    default: 'today'
  },
  date: {
    type: String,
    default: null
  },
  autoUpdate: {
    type: Boolean,
    default: false
  },
  height: {
    type: String,
    default: '280px'
  },
  granularity: {
    type: Number,
    default: 15,
    validator: (value) => value >= 1 && value <= 60
  }
});

const realtimeStore = useRealtimeStore();
const chartCanvas = ref(null);
const loading = ref(true);
const error = ref(null);
let chartInstance = null;

// Chart data structure
const chartData = ref({
  labels: [],
  datasets: [
    {
      label: 'Battery',
      data: [],
      type: 'line',  // Bar chart for battery
      backgroundColor: 'rgba(26, 26, 26, 0.7)',
      borderColor: 'var(--color-data-primary)',
      borderWidth: 1,
      barThickness: 'flex',
      maxBarThickness: 8,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      order: 1  // Draw bars first (lower order = background)
    },
    {
      label: 'Solar',
      data: [],
      type: 'line',  // Line chart for solar
      borderColor: '#10b981',  // Green color
      backgroundColor: '#10b98166',
      borderWidth: 2,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: true,
      order: 1  // Draw lines on top
    },
    {
      label: 'Grid',
      data: [],
      type: 'line',  // Bar chart for grid
      backgroundColor: 'rgba(255, 60, 60, 1)',
      borderColor: 'rgba(255, 60, 60, 0.6)',
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 1,
      barThickness: 'flex',
      maxBarThickness: 8,
      order: 1
    },
    {
      label: 'Home',
      data: [],
      type: 'line',  // Line chart for home
      borderColor: '#3b82f6',  // Blue color
      backgroundColor: '#3b82f666',
      borderWidth: 2,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      order: 1  // Draw lines on top
    }
  ]
});

// Fetch historical data based on period
const fetchData = async () => {
  loading.value = true;
  error.value = null;
  
  try {
    let endpoint;
    
    switch (props.period) {
      case 'today':
        endpoint = `/history/today?granularity=${props.granularity}`;
        break;
      case 'date':
        if (!props.date) {
          throw new Error('Date parameter required for date period');
        }
        endpoint = `/history/date/${props.date}?granularity=${props.granularity}`;
        break;
      case 'last-24-hours':
        endpoint = `/history/last-24-hours?granularity=${props.granularity}`;
        break;
      case 'last-7-days':
        endpoint = `/history/last-7-days?granularity=${props.granularity}`;
        break;
      case 'last-30-days':
        endpoint = `/history/last-30-days?granularity=${props.granularity}`;
        break;
      case 'last-365-days':
        endpoint = `/history/last-365-days?granularity=${props.granularity}`;
        break;
      default:
        throw new Error(`Unknown period: ${props.period}`);
    }
    
    // Use centralized API service (baseURL already includes /api)
    const data = await api.get(endpoint);
    
    // Process and populate chart data
    populateChartData(data);
    
    loading.value = false;
  } catch (err) {
    console.error('Error fetching graph data:', err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
};

// Populate chart with historical data
const populateChartData = (data) => {
  if (!Array.isArray(data) || data.length === 0) {
    chartData.value.labels = [];
    chartData.value.datasets.forEach(ds => ds.data = []);
    return;
  }
  
  // Sort by timestamp
  const sortedData = [...data].sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  // Determine if we need to show dates (multi-day view)
  const isMultiDay = props.period !== 'today' && props.period !== 'last-24-hours';
  
  // Extract labels with appropriate format
  chartData.value.labels = sortedData.map(item => {
    const date = new Date(item.timestamp);
    
    if (isMultiDay) {
      // For multi-day views, show date + time or just date
      if (props.period === 'last-7-days') {
        // Week view: "Mon 13, 14:00"
        return date.toLocaleDateString('en-US', { 
          weekday: 'short', 
          day: 'numeric'
        }) + ', ' + date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      } else if (props.period === 'last-30-days') {
        // Month view: "Jan 13"
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric'
        });
      } else if (props.period === 'last-365-days') {
        // Year view: "Jan 2025"
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          year: 'numeric'
        });
      }
    }
    
    // Single day view: just time "14:00"
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  });
  
  // Populate datasets
  // Battery: positive = charging, negative = discharging
  chartData.value.datasets[0].data = sortedData.map(item => 
    item.battery_power || 0
  );
  
  // Solar: always positive
  chartData.value.datasets[1].data = sortedData.map(item => 
    item.pv_power || 0
  );
  
  // Grid: positive = importing, negative = exporting
  chartData.value.datasets[2].data = sortedData.map(item => 
    item.grid_power || 0
  );
  
  // Home: always positive (consuming)
  chartData.value.datasets[3].data = sortedData.map(item => 
    item.load_power || 0
  );
};

// Append new data point from WebSocket
const appendDataPoint = (powerUpdate) => {
  if (!chartInstance || !powerUpdate) return;
  
  const now = new Date();
  const timeLabel = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  
  // Add new label
  chartData.value.labels.push(timeLabel);
  
  // Add new data points
  chartData.value.datasets[0].data.push(powerUpdate.battery_power || 0);
  chartData.value.datasets[1].data.push(powerUpdate.pv_power || 0);
  chartData.value.datasets[2].data.push(powerUpdate.grid_power || 0);
  chartData.value.datasets[3].data.push(powerUpdate.load_power || 0);
  
  // Keep only data from start of day (max ~1440 points for 24h)
  const maxPoints = 1440;
  if (chartData.value.labels.length > maxPoints) {
    chartData.value.labels.shift();
    chartData.value.datasets.forEach(ds => ds.data.shift());
  }
  
  // Update chart with animation
  chartInstance.update('active');
};

// Initialize chart
const initChart = () => {
  if (!chartCanvas.value) return;
  
  const ctx = chartCanvas.value.getContext('2d');
  
  chartInstance = new Chart(ctx, {
    type: 'bar',  // Base type (will be overridden by dataset types)
    data: chartData.value,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        zoom: {
          zoom: {
            wheel: {
              enabled: false,
              speed: 0.1
            },
            pinch: {
              enabled: false
            },
            mode: 'x',
            drag: {
              enabled: true,
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderColor: 'rgba(59, 130, 246, 0.5)',
              borderWidth: 1
            }
          },
          pan: {
            enabled: true,
            mode: 'x'
          },

        },
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            padding: 25,
            font: {
              size: 12,
              family: 'Rubik, sans-serif'
            },
            color: 'var(--color-text-secondary)',
            usePointStyle: false
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#222222',
          mode: 'index',          // ✅ Shows all datasets at X position
          intersect: false,       // ✅ Easy hover (don't need exact position)
          bodyColor: '#1e293b',
          borderColor: 'var(--color-text-secondary)',
          borderWidth: 0.5,
          padding: 10,
          displayColors: true,
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              const unit = ' W';
              return `${label} : ${value >= 0 ? '+' : ''}${value.toFixed(0)}${unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          },
          ticks: {
            color: '#333',
            font: {
              size: 10,
              family: 'Rubik, sans-serif'
            },
            maxRotation: 45,  // Allow rotation for long labels
            minRotation: 0,   // Start flat
            autoSkipPadding: 20,
            maxTicksLimit: 12  // Show more labels for multi-day views
          }
        },
        y: {
          display: true,  // Show Y-axis
          position: 'left',
          grid: {
            display: true,
            drawBorder: false,
            drawOnChartArea: true,
            drawTicks: false,
            color: function(context) {
              // Make zero line very prominent
              if (context.tick.value === 0) {
                return '#1A1A1A';
              }
              return 'rgba(0, 0, 0, 0.8)';
            },
            lineWidth: function(context) {
              // Thicker zero line
              if (context.tick.value === 0) {
                return 3;
              }
              return 0.5;
            }
          },
          ticks: {
            display: true,
            color: 'var(--color-text-secondary)',
            font: {
              size: 10,
              family: 'Rubik, sans-serif'
            },
            maxTicksLimit: 5,  // Show only ~5 ticks (including max/min/zero)
            callback: function(value) {
              // Format values with K for thousands
              if (value >= 1000) {
                return (value / 1000).toFixed(1) + 'k';
              } else if (value <= -1000) {
                return (value / 1000).toFixed(1) + 'k';
              }
              return value;
            }
          }
        }
      },
      animation: {
        duration: 500,
        easing: 'easeInOutQuart'
      }
    }
  });
};

// Reset zoom to original view
const resetZoom = () => {
  if (chartInstance) {
    chartInstance.resetZoom();
  }
};

// Destroy chart instance
const destroyChart = () => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
};

// Watch for power updates from realtime store
watch(
  () => realtimeStore.powerUpdate,
  (newPowerUpdate) => {
    if (props.autoUpdate && newPowerUpdate) {
      appendDataPoint(newPowerUpdate);
    }
  },
  { deep: true }
);

// Watch for period changes
watch(
  () => props.period,
  async () => {
    destroyChart();
    await fetchData();
    // Reinitialize chart with new data
    setTimeout(() => {
      if (chartCanvas.value) {
        initChart();
      }
    }, 100);
  }
);

// Watch for date changes
watch(
  () => props.date,
  async () => {
    if (props.period === 'date') {
      destroyChart();
      await fetchData();
      // Reinitialize chart with new data
      setTimeout(() => {
        if (chartCanvas.value) {
          initChart();
        }
      }, 100);
    }
  }
);

// Watch for granularity changes
watch(
  () => props.granularity,
  async () => {
    destroyChart();
    await fetchData();
    // Reinitialize chart with new data
    setTimeout(() => {
      if (chartCanvas.value) {
        initChart();
      }
    }, 100);
  }
);

// Lifecycle hooks
onMounted(async () => {
  await fetchData();
  
  // Wait for next tick to ensure canvas is rendered
  setTimeout(() => {
    if (chartCanvas.value) {
      initChart();
    }
  }, 100);
});

onUnmounted(() => {
  destroyChart();
});
</script>

<style scoped>
.energy-flow-graph        {width: 100%;height: v-bind(height);position: relative;}
.graph-container          {width: 100%;height: 100%;position: relative;}
.graph-controls           {position: absolute;top: 8px;right: 8px;z-index: 10;}
.reset-zoom-btn           {background: var(--color-bg-secondary);border: 1px solid var(--color-text-secondary);border-radius: 6px;padding: 6px 12px;font-size: 12px;font-family: 'Rubik', sans-serif;color: var(--color-text-primary);cursor: pointer;transition: all 0.2s ease;display: flex;align-items: center;gap: 4px;}
.reset-zoom-btn:hover     {background: var(--color-bg-primary);border-color: var(--color-text-primary);box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);}
.reset-zoom-btn:active    {transform: scale(0.95);}
.loading-state,
.error-state              {display: flex;align-items: center;justify-content: center;height: 100%;color: var(--color-text-secondary);font-size: 14px;font-family: 'Rubik', sans-serif;}
.error-state              {color: #ef4444;}
canvas                    {width: 100% !important;height: calc(100% - 40px) !important;margin-top: 32px;}
</style>