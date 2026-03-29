<template>
  <div class="energy-sockets-list">

    <!-- Loading State -->
    <div v-if="deviceStore.loading && deviceStore.devices.length === 0" class="loading-state">
      <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
    </div>

    <!-- Empty State -->
    <div v-else-if="deviceStore.devices.length === 0" class="empty-state">
      <i class="pi pi-inbox"></i>
      <p>{{ $t('devices.noDevices', 'Geen devices') }}</p>
    </div>

    <!-- Sockets List -->
    <div v-else class="sockets-scroll space-y-2 mt-2">
      <div
        v-for="socket in sortedSockets"
        :key="socket.id"
        :class="['socket-item', {
          'selected': selectedSocket === socket.id,
          'offline': !socket.online
        }]"
      >
        <!-- Main row -->
        <div class="socket-row" @click="selectSocket(socket)">
          <div class="socket-name">
            <i class="fa-light fa-bolt"></i>
            <span class="device-name">{{ socket.device_name }}</span>
          </div>
          <div class="socket-meta">
            <!-- energy_today from the devices list payload; zero → – -->
            <span class="today-kwh" :class="{ 'today-kwh--empty': !socket.energy_today }">
              {{ socket.energy_today ? socket.energy_today.toFixed(2) + ' kWh' : '–' }}
            </span>

            <!-- Current power -->
            <div class="socket-power">
              <i v-if="socket.power > 0" class="fa fa-arrow-down power-import"></i>
              <span :class="socket.power > 0 ? 'power-import' : ''">
                {{ Math.abs(socket.power).toFixed(0) }} W
              </span>
            </div>

            <!-- Chevron -->
            <i class="fa-light chevron"
              :class="selectedSocket === socket.id ? 'fa-chevron-up' : 'fa-chevron-down'"
            ></i>
          </div>
        </div>

        <!-- Sparkline panel -->
        <Transition name="expand">
          <div v-if="selectedSocket === socket.id" class="sparkline-panel">
            <div class="sparkline-header">
              <span class="sparkline-label">{{ $t('control.devices.usage24h', 'USAGE TODAY') }}</span>
            </div>

            <div v-if="sparklineLoading[socket.id]" class="sparkline-state">
              <ProgressSpinner style="width: 18px; height: 18px" strokeWidth="4" />
            </div>
            <div v-else-if="sparklineError[socket.id]" class="sparkline-state sparkline-state--error">
              <i class="fa-light fa-triangle-exclamation"></i>
              <span>{{ $t('common.error', 'Could not load data') }}</span>
            </div>
            <div v-else-if="!sparklineData[socket.id]?.length" class="sparkline-state">
              <span>{{ $t('devices.sparkline.noData', 'No data available') }}</span>
            </div>
            <div v-else class="sparkline-chart">
              <DeviceUsageSparkline :data="sparklineData[socket.id]" />
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useDevicesStore } from '@/stores/devices';
import apiClient from '@/services/api.js';
import DeviceUsageSparkline from '@/components/charts/DeviceUsageSparkline.vue';

const emit = defineEmits(['socket-selected']);

const deviceStore = useDevicesStore();

// ── Local state ───────────────────────────────────────────────────────────────
const selectedSocket   = ref(null);
const sparklineData    = ref({});  // { id: Array<{timestamp, power}> }
const sparklineLoading = ref({});  // { id: bool }
const sparklineError   = ref({});  // { id: bool }

// ── Computed ──────────────────────────────────────────────────────────────────
const sortedSockets = computed(() => {
  return deviceStore.devices
    .filter(d => d.source === 'homewizard' && d.device_type === 'HWE-SKT')
    .map(socket => ({
      ...socket,
      online: (Date.now() - new Date(socket.timestamp).getTime()) < 300_000
    }))
    .sort((a, b) => a.device_name.localeCompare(b.device_name));
});

// ── Sparkline fetch ───────────────────────────────────────────────────────────
// Mirrors openEdit() in devicesPanel exactly:
//   GET /{source}/devices/{id}   e.g. GET /homewizard/devices/20
//   uses socket.id (integer PK: 20, 21, 22…) — NOT socket.device_id (MAC string)
//   response.data.data  →  history array
async function fetchSparklineData(socket) {
  const id = socket.id;
  sparklineLoading.value = { ...sparklineLoading.value, [id]: true };
  sparklineError.value   = { ...sparklineError.value,   [id]: false };

  try {
    const response = await apiClient.get(`/${socket.source}/devices/${id}`);
    // Same extraction as devicesPanel: response.data.data
    const raw = response?.data?.data || [];

    sparklineData.value = {
      ...sparklineData.value,
      [id]: Array.isArray(raw)
        ? raw.filter(d => d?.timestamp && d?.power != null)
             .map(d => ({ timestamp: d.timestamp, power: parseFloat(d.power) || 0 }))
        : []
    };
  } catch {
    sparklineError.value = { ...sparklineError.value, [id]: true };
    sparklineData.value  = { ...sparklineData.value,  [id]: [] };
  } finally {
    sparklineLoading.value = { ...sparklineLoading.value, [id]: false };
  }
}

// ── Interaction ───────────────────────────────────────────────────────────────
function selectSocket(socket) {
  const id = socket.id;

  if (selectedSocket.value === id) {
    selectedSocket.value = null;
    return;
  }

  selectedSocket.value = id;
  emit('socket-selected', socket);

  // Lazy-fetch sparkline once per open; cached for the session
  if (!sparklineData.value[id]) {
    fetchSparklineData(socket);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => deviceStore.initialize());
onUnmounted(() => deviceStore.cleanup());
</script>

<style scoped>
.energy-sockets-list        { display: flex;flex-direction: column;height: 100%;}
/* Loading / Empty */
.loading-state,
.empty-state                { display: flex;flex-direction: column;align-items: center;justify-content: center;padding: 2rem 1rem;color: var(--color-text-secondary, #64748b);}
.empty-state i              { font-size: 2rem; opacity: 0.5; margin-bottom: 0.5rem; }
.empty-state p              { margin: 0; font-size: 0.875rem; }

/* Scroll container */
.sockets-scroll             { flex: 1;overflow-y: auto;}
.sockets-scroll::-webkit-scrollbar       
                            { width: 6px; }
.sockets-scroll::-webkit-scrollbar-track 
                            { background: var(--color-secondary-100); }
.sockets-scroll::-webkit-scrollbar-thumb 
                            { background: var(--color-secondary-200); border-radius: 3px; }
.sockets-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-text-secondary, #94a3b8); }

/* Socket item wrapper */
.socket-item                { }
.socket-item:hover          { background: var(--color-secondary-100);border-radius:var(--radius-md); }
.socket-item.offline        { opacity: 0.5; }
.socket-item.selected       { background: var(--color-secondary-100);border-radius:var(--radius-md);}
/* Main row */
.socket-row                 { display: flex;border-radius:var(--radius-sm);justify-content: space-between;align-items: center;padding: 0.75rem 1.25rem;cursor: pointer;transition: background 0.15s ease;user-select: none;}

/* Left: icon + name */
.socket-name                { display: flex;align-items: center;gap: 0.5rem;font-size: 0.875rem;font-weight: 500;color: var(--color-text-primary, #1e293b);flex: 1;min-width: 0;}
.socket-name i              { color: var(--color-text-secondary, #94a3b8); font-size: 0.875rem; flex-shrink: 0; }
.device-name                { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Right: kWh + power + chevron */
.socket-meta                { display: flex;align-items: center;gap: 0.75rem;flex-shrink: 0;}
.today-kwh                  { font-size: 0.75rem;font-weight: 500;color: var(--color-text-secondary, #64748b);white-space: nowrap;min-width: 3.5rem;text-align: right;}
.today-kwh--empty           { opacity: 0.35; }
.socket-power               {display: flex;align-items: center;gap: 0.25rem;font-size: 0.875rem;font-weight: 500;color: var(--color-text-primary, #1e293b);white-space: nowrap;min-width: 3rem;text-align: right;}
.socket-power i             { font-size: 0.75rem; }
.power-import               { color: #dc2626; }

.chevron                    { font-size: 0.9rem;color: var(--color-secondary-600);transition: color 0.15s ease;}
.socket-row:hover .chevron  { color: var(--color-text-primary, #1e293b); }

/* Sparkline panel */
.sparkline-panel            { padding: 0.75rem 1.25rem 1rem;overflow: hidden;}
.sparkline-header           { margin-bottom: 4px; }
.sparkline-label            { font-size: 0.65rem;font-weight: 600;text-transform: uppercase;color:var(--color-secondary-500);}
.sparkline-chart            { height: 90px; }
.sparkline-state            { height: 80px;display: flex;align-items: center;justify-content: center;gap: 0.4rem;font-size: 0.8125rem;color: var(--color-secondary-200);}
.sparkline-state--error i   { color: #f59e0b; }
/* Expand transition */
.expand-enter-active,
.expand-leave-active        { transition: max-height 0.25s ease, opacity 0.2s ease;max-height: 180px;overflow: hidden;}
.expand-enter-from,
.expand-leave-to            { max-height: 0;opacity: 0;}
</style>