<template>
  <div class="energy-sockets-list">
    <!-- Header -->
    <div class="list-header">
      <div class="header-left">
        <span class="header-title">Name</span>
        <button @click="toggleSort" class="sort-button">
          <i :class="sortAsc ? 'pi pi-sort-amount-up' : 'pi pi-sort-amount-down'"></i>
        </button>
      </div>
      <span class="header-title">Current power usage</span>
    </div>

    <!-- Loading State -->
    <div v-if="deviceStore.loading && deviceStore.devices.length === 0" class="loading-state">
      <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
    </div>

    <!-- Empty State -->
    <div v-else-if="deviceStore.devices.length === 0" class="empty-state">
      <i class="pi pi-inbox"></i>
      <p>Geen devices</p>
    </div>

    <!-- Sockets List -->
    <div v-else class="sockets-scroll">
      <div 
        v-for="socket in sortedSockets" 
        :key="socket.device_id"
        :class="['socket-row', { 
          'selected': selectedSocket === socket.device_id,
          'offline': !socket.online 
        }]"
        @click="selectSocket(socket)"
      >
        <div class="socket-name">
          <i class="pi pi-bolt"></i>
          <span class="device-name">{{ socket.device_name }}</span>
        </div>
        <div class="socket-power">
          <i v-if="socket.power > 0" class="pi pi-arrow-down power-import"></i>
          <span :class="socket.power > 0 ? 'power-import' : ''">
            {{ Math.abs(socket.power).toFixed(0) }} W
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useDevicesStore } from '@/stores/devices';


const emit = defineEmits(['socket-selected']);

// Use devices store
const deviceStore = useDevicesStore();

// Local state
const selectedSocket = ref(null);
const sortAsc = ref(true);

// Computed
const sortedSockets = computed(() => {
  // Filter only HomeWizard devices (Energy Sockets)
  const sockets = deviceStore.devices.filter(device => 
    device.source === 'homewizard' && device.device_type === 'HWE-SKT'
  );
  
  // Add online status based on timestamp
  const socketsWithStatus = sockets.map(socket => {
    const socketTime = new Date(socket.timestamp);
    const ageMs = Date.now() - socketTime.getTime();
    const online = ageMs < 300000; // Online if updated in last 5 minutes
    
    return {
      ...socket,
      online
    };
  });

  // Sort
  const sorted = [...socketsWithStatus];
  
  if (sortAsc.value) {
    // Sort by name A-Z
    sorted.sort((a, b) => a.device_name.localeCompare(b.device_name));
  } else {
    // Sort by power (highest first)
    sorted.sort((a, b) => b.power - a.power);
  }
  
  return sorted;
});

// Methods
function toggleSort() {
  sortAsc.value = !sortAsc.value;
}

function selectSocket(socket) {
  selectedSocket.value = socket.device_id;
  emit('socket-selected', socket);
}

// Lifecycle
onMounted(() => {
  // Initialize devices store (starts auto-refresh)
  deviceStore.initialize();
});

onUnmounted(() => {
  // Cleanup when component unmounts
  deviceStore.cleanup();
});
</script>

<style scoped>
.energy-sockets-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Header */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-secondary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.sort-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--color-text-secondary, #64748b);
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
}

.sort-button:hover {
  color: var(--color-text-primary, #1e293b);
}

.sort-button i {
  font-size: 0.875rem;
}

/* Loading/Empty States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: var(--color-text-secondary, #64748b);
}

.empty-state i {
  font-size: 2rem;
  opacity: 0.5;
  margin-bottom: 0.5rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.875rem;
}

/* Sockets Scroll */
.sockets-scroll {
  flex: 1;
  overflow-y: auto;
}

/* Socket Row */
.socket-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  cursor: pointer;
  transition: all 0.2s ease;
}

.socket-row:hover {
  background: var(--color-bg-hover, #f9fafb);
}

.socket-row.selected {
  background: var(--color-bg-selected, #e0f2fe);
  border-left: 3px solid var(--color-accent, #0ea5e9);
}

.socket-row.offline {
  opacity: 0.5;
}

.socket-row.offline .socket-name {
  color: var(--color-text-secondary, #94a3b8);
}

/* Socket Name */
.socket-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary, #1e293b);
  flex: 1;
  min-width: 0;
}

.socket-name i {
  color: var(--color-text-secondary, #94a3b8);
  font-size: 0.875rem;
  flex-shrink: 0;
}

.device-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Socket Power */
.socket-power {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary, #1e293b);
  white-space: nowrap;
}

.socket-power i {
  font-size: 0.75rem;
}

.power-import {
  color: #dc2626;
}

/* Scrollbar Styling */
.sockets-scroll::-webkit-scrollbar {
  width: 6px;
}

.sockets-scroll::-webkit-scrollbar-track {
  background: var(--color-bg-secondary, #f8f9fa);
}

.sockets-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border, #cbd5e1);
  border-radius: 3px;
}

.sockets-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary, #94a3b8);
}
</style>