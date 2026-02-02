<!-- src/components/dashboard/BatteryStatus.vue -->
<template>
  <div class="battery-status">
    <div class="battery-icon-container">
      <img src="@/assets/dashboard/stat-battery.png" alt="Battery" class="battery-status-icon" />
      <div class="battery-level" :style="{ height: soc + '%' }"></div>
    </div>
    <div class="battery-info">
      <span class="soc-label">State of Charge</span>
      <span class="soc-value">{{ soc }}<span class="unit">%</span></span>
    </div>
    <div v-if="showDetails" class="battery-details">
      <div class="detail-row">
        <span class="detail-label">Power:</span>
        <span class="detail-value" :class="powerClass">{{ formatPower(power) }}</span>
      </div>
      <div v-if="voltage" class="detail-row">
        <span class="detail-label">Voltage:</span>
        <span class="detail-value">{{ voltage.toFixed(1) }}V</span>
      </div>
      <div v-if="temperature" class="detail-row">
        <span class="detail-label">Temperature:</span>
        <span class="detail-value">{{ temperature.toFixed(1) }}°C</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatPower } from '@/utils/formatters';

const props = defineProps({
  soc: {
    type: Number,
    required: true,
    default: 0
  },
  power: {
    type: Number,
    default: 0
  },
  voltage: {
    type: Number,
    default: null
  },
  temperature: {
    type: Number,
    default: null
  },
  showDetails: {
    type: Boolean,
    default: false
  }
});

const powerClass = computed(() => {
  if (props.power > 0) return 'charging';
  if (props.power < 0) return 'discharging';
  return 'idle';
});
</script>

<style scoped>
.battery-status {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-radius: 12px;
}

.battery-icon-container {
  position: relative;
  width: 60px;
  height: 80px;
  border: 3px solid #10b981;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  overflow: hidden;
  flex-shrink: 0;
}

.battery-status-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  position: relative;
  z-index: 2;
}

.battery-level {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(180deg, #10b981 0%, #059669 100%);
  transition: height 0.5s ease;
  z-index: 1;
}

.battery-info {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.soc-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}

.soc-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: #10b981;
  line-height: 1;
}

.unit {
  font-size: 1.25rem;
}

.battery-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-left: 1.5rem;
  border-left: 2px solid #d1fae5;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.detail-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.detail-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
}

.detail-value.charging {
  color: #10b981;
}

.detail-value.discharging {
  color: #f59e0b;
}

.detail-value.idle {
  color: #6b7280;
}

@media (max-width: 768px) {
  .battery-status {
    flex-direction: column;
    gap: 1rem;
  }
  
  .battery-details {
    padding-left: 0;
    padding-top: 1rem;
    border-left: none;
    border-top: 2px solid #d1fae5;
    width: 100%;
  }
}
</style>