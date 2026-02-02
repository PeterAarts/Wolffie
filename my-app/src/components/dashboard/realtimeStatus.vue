<!-- src/components/dashboard/RealTimeStatus.vue -->
<template>
  <div class="real-time-status">
    <div class="power-flow">
      <div class="flow-column">
        <div class="flow-icon-wrapper">
          <img src="@/assets/dashboard/stat-grid.png" alt="Grid" class="flow-icon" />
        </div>
        <div class="flow-label">Grid</div>
        <div class="flow-value" :class="gridClass">{{ formatPower(Math.abs(gridPower)) }}</div>
        <div class="flow-status">{{ gridStatus }}</div>
      </div>

      <div class="flow-separator">→</div>

      <div class="flow-column">
        <div class="flow-icon-wrapper">
          <img src="@/assets/dashboard/stat-green.png" alt="Solar" class="flow-icon" />
        </div>
        <div class="flow-label">Solar</div>
        <div class="flow-value solar-color">{{ formatPower(solarPower) }}</div>
        <div class="flow-status">Generating</div>
      </div>

      <div class="flow-separator">→</div>

      <div class="flow-column">
        <div class="flow-icon-wrapper">
          <img src="@/assets/dashboard/stat-battery.png" alt="Battery" class="flow-icon" />
        </div>
        <div class="flow-label">Battery</div>
        <div class="flow-value battery-color">{{ formatPower(Math.abs(batteryPower)) }}</div>
        <div class="flow-status">{{ batteryStatus }}</div>
      </div>

      <div class="flow-separator">→</div>

      <div class="flow-column">
        <div class="flow-icon-wrapper">
          <img src="@/assets/dashboard/stat-home.png" alt="Load" class="flow-icon" />
        </div>
        <div class="flow-label">Load</div>
        <div class="flow-value load-color">{{ formatPower(loadPower) }}</div>
        <div class="flow-status">Consuming</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatPower } from '@/utils/formatters';

const props = defineProps({
  gridPower: {
    type: Number,
    default: 0
  },
  solarPower: {
    type: Number,
    default: 0
  },
  batteryPower: {
    type: Number,
    default: 0
  },
  loadPower: {
    type: Number,
    default: 0
  }
});

const gridStatus = computed(() => {
  if (props.gridPower > 0) return 'Importing';
  if (props.gridPower < 0) return 'Exporting';
  return 'Idle';
});

const gridClass = computed(() => {
  if (props.gridPower > 0) return 'grid-import';
  if (props.gridPower < 0) return 'grid-export';
  return '';
});

const batteryStatus = computed(() => {
  if (props.batteryPower > 0) return 'Charging';
  if (props.batteryPower < 0) return 'Discharging';
  return 'Idle';
});
</script>

<style scoped>
.real-time-status {
  background: white;
  border-radius: 12px;
  padding: 1rem;
}

.power-flow {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 1.5rem 0;
  gap: 1rem;
}

.flow-column {
  text-align: center;
  flex: 1;
  min-width: 0;
}

.flow-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.75rem;
  transition: all 0.3s ease;
}

.flow-icon-wrapper:hover {
  transform: scale(1.1);
}

.flow-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
}

.flow-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.flow-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #111827;
  margin-bottom: 0.25rem;
}

.flow-status {
  font-size: 0.75rem;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.flow-separator {
  font-size: 1.5rem;
  color: #cbd5e1;
  font-weight: 300;
  flex-shrink: 0;
}

/* Color classes */
.solar-color { color: #f59e0b; }
.battery-color { color: #10b981; }
.load-color { color: #3b82f6; }
.grid-import { color: #ef4444; }
.grid-export { color: #10b981; }

@media (max-width: 768px) {
  .power-flow {
    flex-wrap: wrap;
    gap: 2rem;
  }
  
  .flow-column {
    flex-basis: calc(50% - 1rem);
  }
  
  .flow-separator {
    display: none;
  }
}
</style>