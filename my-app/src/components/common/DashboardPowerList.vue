<template>
  <div class="flex flex-col h-full px-4">
    <div class="flex-1 overflow-y-auto">
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
        mode="out-in"
      >
        <div v-if="!showSocketsList" key="power-cards" class="flex flex-col divide-y divide-secondary-200">

          <!-- Battery -->
          <div class="power-card hover:bg-secondary-100 transition-colors">
            <div class="flex flex-col items-center gap-1 w-12 shrink-0">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary">
                <i class="ph-light ph-battery-charging"></i>
              </div>
              <div v-if="batteryStatusKey !== 'idle'" class="flow-track" :class="batteryStatusKey">
                <div class="flow-dot"></div>
              </div>
              <div v-else class="flow-track-placeholder"></div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">{{ t('control.battery') }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.batteryCharge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_charge || 0).toFixed(2) }} kWh</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500">{{ t('energy.batteryDischarge') }}: {{ parseFloat(realtimeStore.summaryData.today_battery_discharge || 0).toFixed(2) }} kWh</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-3xl font-bold leading-none text-primary">{{ currentBatteryPower }} W</div>
              <div class="text-xs lowercase tracking-wider mt-1" :class="batteryStatusClass">{{ batteryStatus }}</div>
            </div>
          </div>

          <!-- Solar -->
          <div class="power-card hover:bg-secondary-100 transition-colors">
            <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
              <i class="ph-light ph-solar-roof"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">{{ t('control.solar') }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.pvGeneration') }}: {{ parseFloat(realtimeStore.summaryData.today_pv_gen || 0).toFixed(2) }} kWh</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(currentSolarPower) }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('control.live') }}</div>
            </div>
          </div>

          <!-- Grid -->
          <div class="power-card hover:bg-secondary-100 transition-colors">
            <div class="flex flex-col items-center gap-1 w-12 shrink-0">
              <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary">
                <i class="ph-light ph-circuitry"></i>
              </div>
              <div v-if="gridStatusKey !== 'idle'" class="flow-track" :class="gridStatusKey">
                <div class="flow-dot"></div>
              </div>
              <div v-else class="flow-track-placeholder"></div>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">{{ t('control.grid') }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.gridExport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_export || 0).toFixed(2) }} kWh</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500">{{ t('energy.gridImport') }}: {{ parseFloat(realtimeStore.summaryData.today_grid_import || 0).toFixed(2) }} kWh</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(Math.abs(currentGridPower)) }}</div>
              <div class="text-xs lowercase tracking-wider mt-1" :class="gridStatusClass">{{ gridDirection }}</div>
            </div>
          </div>

          <!-- Home / devices -->
          <div @click="toggleSocketsList" class="power-card hover:bg-secondary-100 transition-colors cursor-pointer group relative">
            <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
              <i class="ph-light ph-house"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">{{ t('dashboard.home') }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">{{ t('energy.loadConsumption') }}: {{ parseFloat(realtimeStore.summaryData.today_load || 0).toFixed(2) }} kWh</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-3xl font-bold leading-none text-primary">{{ formatPowerValue(currentHomePower) }}</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-1">{{ t('control.live') }}</div>
            </div>
            <div class="absolute bottom-2 right-4 flex items-center gap-1.5 text-[10px] font-bold text-secondary-500 opacity-0 group-hover:opacity-100 transition-opacity">
              <i class="ph-duotone ph-circle-info"></i>
              <span>{{ t('dashboard.clickForDetails') }}</span>
            </div>
          </div>

          <!-- Strategy -->
          <div class="power-card hover:bg-secondary-100 transition-colors cursor-pointer" @click="router.push('/control')">
            <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
              <i class="ph-light ph-strategy"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">Strategy</div>
              <div class="text-xs lowercase tracking-wider text-secondary-500 mt-0.5">
                <template v-if="strategyStore.activeStrategy">
                  {{ strategyStore.activeStrategy.name }}
                  <template v-if="strategyNextAction"> · {{ strategyNextAction }}</template>
                </template>
                <template v-else>not configured</template>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-xs lowercase tracking-wider mt-1" :class="strategyModeClass">
                {{ strategyCurrentMode }}
              </div>
            </div>
          </div>

        </div>
        <div v-else key="devices-list" class="flex flex-col h-full">
          <div class="flex items-center gap-4 p-4 bg-secondary-100 rounded-lg">
            <div class="w-12 h-12 flex items-center justify-center text-2xl text-primary shrink-0">
              <i class="ph-light ph-house"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-base font-bold text-primary">{{ t('dashboard.home') }}</div>
            </div>
            <button @click="toggleSocketsList" class="w-8 h-8 flex items-center justify-center rounded-md text-secondary-500 hover:bg-secondary-200 transition-colors">
              <i class="ph-light ph-x text-lg"></i>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto">
            <SmartDeviceList @socket-selected="onSocketSelected" />
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useRealtimeStore } from '@/stores/realtime';
import { useStrategyStore } from '@/stores/strategy';
import { useLocale } from '@/composables/useLocale';
import SmartDeviceList from '@/components/SmartDeviceList.vue';

const router        = useRouter();
const realtimeStore = useRealtimeStore();
const strategyStore = useStrategyStore();
const { t }         = useLocale();

// ── Socket list toggle ─────────────────────────────────────────────────────
const showSocketsList = ref(false);
const toggleSocketsList = () => { showSocketsList.value = !showSocketsList.value; };
const onSocketSelected  = (socket) => { console.log('Socket selected:', socket); };

// ── Power values ───────────────────────────────────────────────────────────
const currentBatteryPower = computed(() => {
  const components = realtimeStore.realtimeData?.components;
  if (components?.battery_1) {
    return (components.battery_1.currentIn || 0) - (components.battery_1.currentOut || 0);
  }
  return 0;
});

const currentSolarPower = computed(() => realtimeStore.realtimeData?.components?.solar?.currentOut || 0);

const currentGridPower = computed(() => {
  const grid = realtimeStore.realtimeData?.components?.grid;
  return grid ? (grid.currentIn || 0) - (grid.currentOut || 0) : 0;
});

const currentHomePower = computed(() => realtimeStore.realtimeData?.components?.home_usage?.currentIn || 0);

// ── Battery status ─────────────────────────────────────────────────────────
const batteryStatus = computed(() => {
  const power = currentBatteryPower.value;
  if (power > 50)  return t('status.discharging');
  if (power < -50) return t('status.charging');
  return t('status.idle');
});

const batteryStatusKey = computed(() => {
  const power = currentBatteryPower.value;
  if (power < -50) return 'charging';
  if (power > 50)  return 'discharging';
  return 'idle';
});

const batteryStatusClass = computed(() => {
  switch (batteryStatusKey.value) {
    case 'charging':    return 'text-green-600';
    case 'discharging': return 'text-orange-500';
    default:            return 'text-secondary-500';
  }
});

// ── Grid status ────────────────────────────────────────────────────────────
const gridDirection = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return t('status.importing');
  if (power < -50) return t('status.exporting');
  return t('status.idle');
});

const gridStatusKey = computed(() => {
  const power = currentGridPower.value;
  if (power > 50)  return 'importing';
  if (power < -50) return 'exporting';
  return 'idle';
});

const gridStatusClass = computed(() => {
  switch (gridStatusKey.value) {
    case 'importing': return 'text-orange-500';
    case 'exporting': return 'text-green-600';
    default:          return 'text-secondary-500';
  }
});

// ── Strategy ───────────────────────────────────────────────────────────────
const strategyCurrentMode = computed(() => strategyStore.decision?.action ?? '—');

const strategyNextAction = computed(() => {
  const now  = new Date();
  const plan = Array.isArray(strategyStore.dayPlan) ? strategyStore.dayPlan : [];
  const next = plan.find(slot => new Date(slot.start) > now);
  if (!next?.action) return null;
  const key      = `control.strategy.${next.action}.name`;
  const resolved = t(key);
  return resolved !== key ? resolved : next.action;
});

const strategyModeClass = computed(() => {
  switch (strategyStore.decision?.action) {
    case 'charge':    return 'text-green-600';
    case 'discharge': return 'text-orange-500';
    default:          return 'text-secondary-500';
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
const formatPowerValue = (watts) => {
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${Math.round(watts)} W`;
};
</script>

<style scoped>
.power-card             { display: flex; align-items: center; gap: 1rem; padding: 1.25rem; position: relative; border-radius: var(--radius-md); border: var(--border-width) solid var(--color-secondary-200); margin-bottom: 1rem; }

.flow-track             { position: relative; width: 2rem; height: 5px; background: transparent; border-radius: 999px; overflow: hidden; top: -1rem; }
.flow-track-placeholder { width: 2rem; height: 5px; }
.flow-dot               { position: absolute; top: 0; width: .5rem; height: 5px; border-radius: 999px; }

.flow-track.charging   .flow-dot,
.flow-track.exporting  .flow-dot  { background: #22c55e; animation: dot-ltr 1.4s ease-in-out infinite; }
.flow-track.discharging .flow-dot,
.flow-track.importing  .flow-dot  { background: #f97316; animation: dot-rtl 1.4s ease-in-out infinite; }

@keyframes dot-ltr {
  0%   { left: -8px;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: 100%;  opacity: 0; }
}
@keyframes dot-rtl {
  0%   { left: 100%;  opacity: 0; }
  15%  {               opacity: 1; }
  85%  {               opacity: 1; }
  100% { left: -8px;  opacity: 0; }
}
</style>