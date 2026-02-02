<!-- src/components/dashboard/EnergyFlowDiagram.vue -->
<template>
  <div class="energy-flow-diagram">
    <div class="energy-flow-container">
      <!-- Solar Source -->
      <div class="energy-column">
        <div class="energy-box solar-box">
          <img src="@/assets/dashboard/stat-green.png" alt="Solar" class="energy-icon" />
          <div class="energy-label">Solar</div>
          <div class="energy-value">{{ formatEnergy(solarEnergy) }}</div>
        </div>
      </div>

      <!-- Flow Lines with SVG -->
      <div class="flow-lines">
        <svg width="100%" height="300" style="overflow: visible">
          <!-- Solar to Battery -->
          <path 
            d="M 0 50 Q 50 50, 100 100" 
            :stroke="flowColors.solarToBattery" 
            :stroke-width="getFlowWidth(solarToBattery)"
            fill="none" 
          />
          <text x="50" y="70" font-size="12" fill="#64748b">
            {{ formatEnergy(solarToBattery) }}
          </text>
          
          <!-- Solar to Load -->
          <path 
            d="M 0 50 Q 50 50, 100 150" 
            :stroke="flowColors.solarToLoad" 
            :stroke-width="getFlowWidth(solarToLoad)"
            fill="none" 
          />
          <text x="50" y="100" font-size="12" fill="#64748b">
            {{ formatEnergy(solarToLoad) }}
          </text>
          
          <!-- Solar to Grid -->
          <path 
            d="M 0 50 Q 50 50, 100 200" 
            :stroke="flowColors.solarToGrid" 
            :stroke-width="getFlowWidth(solarToGrid)"
            fill="none" 
          />
          <text x="50" y="130" font-size="12" fill="#64748b">
            {{ formatEnergy(solarToGrid) }}
          </text>

          <!-- Battery to Load (if discharging) -->
          <path 
            v-if="batteryToLoad > 0"
            d="M 100 100 Q 100 125, 100 150" 
            :stroke="flowColors.batteryToLoad" 
            :stroke-width="getFlowWidth(batteryToLoad)"
            fill="none" 
            stroke-dasharray="5,5"
          />
        </svg>
      </div>

      <!-- Destinations -->
      <div class="energy-column">
        <div class="energy-box battery-box">
          <img src="@/assets/dashboard/stat-battery.png" alt="Battery" class="energy-icon" />
          <div class="energy-label">Battery</div>
          <div class="energy-value">{{ batterySoc }}%</div>
          <div class="energy-sublabel">{{ formatEnergy(batteryCharged) }} charged</div>
        </div>
        
        <div class="energy-box load-box">
          <img src="@/assets/dashboard/stat-home.png" alt="Load" class="energy-icon" />
          <div class="energy-label">Load</div>
          <div class="energy-value">{{ formatEnergy(totalLoad) }}</div>
        </div>
        
        <div class="energy-box grid-box">
          <img src="@/assets/dashboard/stat-grid.png" alt="Grid" class="energy-icon" />
          <div class="energy-label">{{ gridFeedIn > 0 ? 'Feed-in' : 'Import' }}</div>
          <div class="energy-value">{{ formatEnergy(Math.abs(gridFeedIn)) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatEnergy } from '@/utils/formatters';

const props = defineProps({
  solarEnergy: {
    type: Number,
    default: 0
  },
  solarToBattery: {
    type: Number,
    default: 0
  },
  solarToLoad: {
    type: Number,
    default: 0
  },
  solarToGrid: {
    type: Number,
    default: 0
  },
  batteryToLoad: {
    type: Number,
    default: 0
  },
  batteryCharged: {
    type: Number,
    default: 0
  },
  batterySoc: {
    type: Number,
    default: 0
  },
  totalLoad: {
    type: Number,
    default: 0
  },
  gridFeedIn: {
    type: Number,
    default: 0
  }
});

const flowColors = {
  solarToBattery: '#a7f3d0',
  solarToLoad: '#bfdbfe',
  solarToGrid: '#fbcfe8',
  batteryToLoad: '#10b981'
};

const getFlowWidth = (value) => {
  // Scale stroke width based on energy flow (min 2, max 8)
  const maxEnergy = Math.max(
    props.solarToBattery, 
    props.solarToLoad, 
    props.solarToGrid,
    props.batteryToLoad
  );
  
  if (maxEnergy === 0 || value === 0) return 2;
  
  const width = 2 + ((value / maxEnergy) * 6);
  return Math.max(2, Math.min(8, width));
};
</script>

<style scoped>
.energy-flow-diagram {
  width: 100%;
}

.energy-flow-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2rem;
  min-height: 350px;
  position: relative;
}

.energy-column {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  flex-shrink: 0;
  width: 140px;
}

.flow-lines {
  flex: 1;
  min-width: 200px;
  position: relative;
}

.energy-box {
  padding: 1.5rem;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
}

.energy-box:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.solar-box { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); }
.battery-box { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); }
.load-box { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); }
.grid-box { background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%); }

.energy-icon {
  width: 40px;
  height: 40px;
  object-fit: contain;
  margin: 0 auto 0.5rem;
}

.energy-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0.5rem 0;
  font-weight: 500;
}

.energy-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #111827;
}

.energy-sublabel {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

@media (max-width: 768px) {
  .energy-flow-container {
    flex-direction: column;
    gap: 2rem;
  }
  
  .energy-column {
    width: 100%;
    flex-direction: row;
    justify-content: space-around;
  }
  
  .energy-box {
    flex: 1;
    min-width: 100px;
  }
  
  .flow-lines {
    display: none;
  }
}
</style>