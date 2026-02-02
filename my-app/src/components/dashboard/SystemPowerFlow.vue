<!-- src/components/dashboard/SystemPowerFlowHorizontal.vue -->
<template>
  <div class="system-power-flow-horizontal">
    <div class="flow-container">
      <!-- Step 1: Grid (External) -->
      <div class="flow-step">
        <div class="step-label">Step 1</div>
        <div class="component-box grid-box">
          <div class="component-header">
            <img src="@/assets/dashboard/stat-grid.png" alt="Grid" class="component-icon" />
            <h3 class="component-title">Grid</h3>
            <div class="location-badge external">External</div>
          </div>
          <div class="component-data">
            <div class="data-value" :class="gridStatusClass">{{ formatPower(gridPower) }}</div>
            <div class="data-label">{{ gridStatus }}</div>
          </div>
        </div>
        <div class="flow-arrow" :class="{ active: Math.abs(gridPower) > 0 }">
          <i class="pi pi-arrow-right"></i>
        </div>
      </div>

      <!-- Step 2: Backup Unit -->
      <div class="flow-step">
        <div class="step-label">Step 2</div>
        <div class="component-box backup-box">
          <div class="component-header">
            <i class="pi pi-shield component-icon-text"></i>
            <h3 class="component-title">Backup Unit</h3>
            <div class="location-badge in-home">In-Home</div>
          </div>
          <div class="component-data">
            <div class="data-sublabel">Transfer Switch</div>
            <div class="status-indicator" :class="backupStatus">
              {{ backupStatus === 'active' ? 'On Grid' : 'On Battery' }}
            </div>
          </div>
        </div>
        <div class="flow-arrow active">
          <i class="pi pi-arrow-right"></i>
        </div>
      </div>

      <!-- Step 3: Solar System (Group) -->
      <div class="flow-step">
        <div class="step-label">Step 3</div>
        <div class="component-group solar-group">
          <div class="group-header">
            <img src="@/assets/dashboard/stat-green.png" alt="Solar" class="group-icon" />
            <h3 class="group-title">Solar System</h3>
            <div class="location-badge in-home">In-Home</div>
          </div>
          
          <!-- Level 2 Sub-components -->
          <div class="sub-components">
            <!-- Step 1: Solar Inverter -->
            <div class="sub-component">
              <div class="sub-step">L2-S1</div>
              <div class="sub-header">
                <i class="pi pi-bolt"></i>
                <span class="sub-title">Inverter</span>
              </div>
              <div class="sub-specs">
                <span class="spec">1-Phase</span>
                <span class="spec">Max 3 kW</span>
              </div>
              <div class="efficiency-bar">
                <div class="efficiency-fill" :style="{ width: solarEfficiency + '%' }"></div>
                <span class="efficiency-text">{{ solarEfficiency }}%</span>
              </div>
            </div>

            <!-- Step 2: Solar Panels -->
            <div class="sub-component">
              <div class="sub-step">L2-S2</div>
              <div class="sub-header">
                <i class="pi pi-sun"></i>
                <span class="sub-title">Solar Panels</span>
              </div>
              <div class="sub-specs">
                <span class="spec">9 × 395W</span>
                <span class="spec-total">= 3.56 kWp</span>
              </div>
              <div class="sub-value solar-color">{{ formatPower(solarPower) }}</div>
            </div>
          </div>
        </div>
        <div class="flow-arrow" :class="{ active: solarPower > 0 }">
          <i class="pi pi-arrow-right"></i>
        </div>
      </div>

      <!-- Step 4: Home Load -->
      <div class="flow-step">
        <div class="step-label">Step 4</div>
        <div class="component-box home-box">
          <div class="component-header">
            <img src="@/assets/dashboard/stat-home.png" alt="Home" class="component-icon" />
            <h3 class="component-title">Home Load</h3>
            <div class="location-badge in-home">In-Home</div>
          </div>
          <div class="component-data">
            <div class="data-value load-color">{{ formatPower(loadPower) }}</div>
            <div class="data-label">Consuming</div>
          </div>
          <div class="load-breakdown" v-if="showDetails">
            <div class="breakdown-item">
              <span class="breakdown-dot solar"></span>
              <span class="breakdown-value">{{ formatPower(loadFromSolar) }}</span>
            </div>
            <div class="breakdown-item">
              <span class="breakdown-dot battery"></span>
              <span class="breakdown-value">{{ formatPower(loadFromBattery) }}</span>
            </div>
            <div class="breakdown-item">
              <span class="breakdown-dot grid"></span>
              <span class="breakdown-value">{{ formatPower(loadFromGrid) }}</span>
            </div>
          </div>
        </div>
        <div class="flow-arrow active">
          <i class="pi pi-arrow-right"></i>
        </div>
      </div>

      <!-- Step 5: Battery System (Group) -->
      <div class="flow-step">
        <div class="step-label">Step 5</div>
        <div class="component-group battery-group">
          <div class="group-header">
            <img src="@/assets/dashboard/stat-battery.png" alt="Battery" class="group-icon" />
            <h3 class="group-title">Battery System</h3>
            <div class="location-badge in-home">In-Home</div>
          </div>
          
          <!-- Level 2 Sub-components -->
          <div class="sub-components">
            <!-- Step 1: Battery Inverter -->
            <div class="sub-component">
              <div class="sub-step">L2-S1</div>
              <div class="sub-header">
                <i class="pi pi-bolt"></i>
                <span class="sub-title">Inverter</span>
              </div>
              <div class="sub-specs">
                <span class="spec">3-Phase</span>
                <span class="spec">Max 10 kW</span>
              </div>
              <div class="sub-value" :class="batteryStatusClass">
                {{ formatPower(Math.abs(batteryPower)) }}
              </div>
              <div class="sub-status">{{ batteryStatus }}</div>
            </div>

            <!-- Step 2: Battery Packs -->
            <div class="sub-component">
              <div class="sub-step">L2-S2</div>
              <div class="sub-header">
                <i class="pi pi-database"></i>
                <span class="sub-title">Battery Packs</span>
              </div>
              <div class="sub-specs">
                <span class="spec">3 × 3.4 kWh</span>
                <span class="spec-total">= 10.2 kWh</span>
              </div>
              <div class="battery-soc">
                <div class="soc-bar">
                  <div class="soc-fill" :style="{ width: batterySoc + '%' }"></div>
                </div>
                <span class="soc-text">{{ batterySoc }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Flow Summary -->
    <div class="flow-summary" v-if="showSummary">
      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-icon solar"></span>
          <span class="summary-label">Solar Generation:</span>
          <span class="summary-value solar-color">{{ formatPower(solarPower) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-icon home"></span>
          <span class="summary-label">Home Consumption:</span>
          <span class="summary-value load-color">{{ formatPower(loadPower) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-icon battery"></span>
          <span class="summary-label">Battery:</span>
          <span class="summary-value" :class="batteryStatusClass">
            {{ batteryStatus }} {{ formatPower(Math.abs(batteryPower)) }}
          </span>
        </div>
        <div class="summary-item">
          <span class="summary-icon grid"></span>
          <span class="summary-label">Grid:</span>
          <span class="summary-value" :class="gridStatusClass">
            {{ gridStatus }} {{ formatPower(Math.abs(gridPower)) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatPower } from '@/utils/formatters';

const props = defineProps({
  gridPower: { type: Number, default: 0 },
  solarPower: { type: Number, default: 0 },
  batteryPower: { type: Number, default: 0 },
  batterySoc: { type: Number, default: 0 },
  loadPower: { type: Number, default: 0 },
  loadFromSolar: { type: Number, default: 0 },
  loadFromBattery: { type: Number, default: 0 },
  loadFromGrid: { type: Number, default: 0 },
  showDetails: { type: Boolean, default: true },
  showSummary: { type: Boolean, default: true }
});

const gridStatus = computed(() => {
  if (props.gridPower > 0) return 'Importing';
  if (props.gridPower < 0) return 'Exporting';
  return 'Idle';
});

const gridStatusClass = computed(() => {
  if (props.gridPower > 0) return 'grid-import';
  if (props.gridPower < 0) return 'grid-export';
  return 'grid-idle';
});

const backupStatus = computed(() => {
  return Math.abs(props.gridPower) > 0 ? 'active' : 'backup';
});

const batteryStatus = computed(() => {
  if (props.batteryPower > 0) return 'Charging';
  if (props.batteryPower < 0) return 'Discharging';
  return 'Idle';
});

const batteryStatusClass = computed(() => {
  if (props.batteryPower > 0) return 'battery-charging';
  if (props.batteryPower < 0) return 'battery-discharging';
  return 'battery-idle';
});

const solarEfficiency = computed(() => {
  const maxOutput = 3000;
  return Math.min(100, Math.round((props.solarPower / maxOutput) * 100));
});
</script>

<style scoped>
.system-power-flow-horizontal {
  padding: 2rem;
  background: white;
  border-radius: 16px;
}

.flow-container {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 1rem;
}

.flow-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.step-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: #f3f4f6;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
}

.component-box,
.component-group {
  min-width: 200px;
  background: #f9fafb;
  border-radius: 12px;
  padding: 1.25rem;
  border: 2px solid #e5e7eb;
  transition: all 0.3s ease;
}

.component-box:hover,
.component-group:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.grid-box { border-color: #f97316; }
.backup-box { border-color: #8b5cf6; }
.solar-group { border-color: #fbbf24; }
.home-box { border-color: #3b82f6; }
.battery-group { border-color: #10b981; }

.component-header,
.group-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.component-icon,
.group-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.component-icon-text {
  font-size: 1.5rem;
  color: #8b5cf6;
}

.component-title,
.group-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #111827;
  margin: 0;
  text-align: center;
}

.location-badge {
  font-size: 0.65rem;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.location-badge.external {
  background: #fef3c7;
  color: #92400e;
}

.location-badge.in-home {
  background: #dbeafe;
  color: #1e40af;
}

.component-data {
  text-align: center;
}

.data-value {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.data-label,
.data-sublabel {
  font-size: 0.875rem;
  color: #6b7280;
}

.status-indicator {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: 0.5rem;
}

.status-indicator.active {
  background: #dcfce7;
  color: #166534;
}

.status-indicator.backup {
  background: #fef3c7;
  color: #92400e;
}

/* Sub-components */
.sub-components {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sub-component {
  background: white;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  position: relative;
}

.sub-step {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  font-size: 0.65rem;
  font-weight: 600;
  color: #9ca3af;
  background: #f3f4f6;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.sub-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.sub-header i {
  color: #6b7280;
  font-size: 0.875rem;
}

.sub-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
}

.sub-specs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.spec {
  font-size: 0.75rem;
  color: #6b7280;
  background: #f3f4f6;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.spec-total {
  font-size: 0.75rem;
  color: #059669;
  font-weight: 600;
}

.sub-value {
  font-size: 1.125rem;
  font-weight: 700;
  margin-top: 0.5rem;
}

.sub-status {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

/* Efficiency Bar */
.efficiency-bar {
  position: relative;
  height: 20px;
  background: #f3f4f6;
  border-radius: 10px;
  overflow: hidden;
  margin-top: 0.5rem;
}

.efficiency-fill {
  height: 100%;
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
  transition: width 0.5s ease;
}

.efficiency-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.7rem;
  font-weight: 600;
  color: #111827;
}

/* Battery SOC */
.battery-soc {
  margin-top: 0.5rem;
}

.soc-bar {
  position: relative;
  height: 20px;
  background: #f3f4f6;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}

.soc-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #059669);
  transition: width 0.5s ease;
}

.soc-text {
  font-size: 0.875rem;
  font-weight: 600;
  color: #059669;
}

/* Flow Arrows */
.flow-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #f3f4f6;
  color: #9ca3af;
  font-size: 1.25rem;
  opacity: 0.5;
  transition: all 0.3s ease;
}

.flow-arrow.active {
  background: #dbeafe;
  color: #3b82f6;
  opacity: 1;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Load Breakdown */
.load-breakdown {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #f3f4f6;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.breakdown-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.breakdown-dot.solar { background: #fbbf24; }
.breakdown-dot.battery { background: #10b981; }
.breakdown-dot.grid { background: #f97316; }

.breakdown-value {
  font-weight: 600;
  color: #111827;
}

/* Flow Summary */
.flow-summary {
  margin-top: 2rem;
  padding: 1.5rem;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.summary-icon {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.summary-icon.solar { background: #fbbf24; }
.summary-icon.home { background: #3b82f6; }
.summary-icon.battery { background: #10b981; }
.summary-icon.grid { background: #f97316; }

.summary-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.summary-value {
  font-size: 0.95rem;
  font-weight: 700;
  margin-left: auto;
}

/* Color Classes */
.solar-color { color: #f59e0b; }
.battery-charging { color: #10b981; }
.battery-discharging { color: #f59e0b; }
.battery-idle { color: #6b7280; }
.load-color { color: #3b82f6; }
.grid-import { color: #ef4444; }
.grid-export { color: #10b981; }
.grid-idle { color: #6b7280; }

/* Responsive */
@media (max-width: 1024px) {
  .flow-container {
    flex-direction: column;
    align-items: stretch;
  }
  
  .flow-arrow {
    transform: rotate(90deg);
  }
  
  .summary-row {
    grid-template-columns: 1fr;
  }
}
</style>