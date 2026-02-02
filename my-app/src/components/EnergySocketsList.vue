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
      <span class="header-title">Current Power</span>
    </div>

    <!-- Loading State -->
    <div v-if="loading && sockets.length === 0" class="loading-state">
      <ProgressSpinner style="width: 30px; height: 30px" strokeWidth="4" />
    </div>

    <!-- Empty State -->
    <div v-else-if="sockets.length === 0" class="empty-state">
      <i class="pi pi-inbox"></i>
      <p>Geen devices</p>
    </div>

    <!-- Sockets List -->
    <div v-else class="sockets-scroll">
      <div 
        v-for="socket in sortedSockets" 
        :key="socket.id"
        :class="['socket-row', { 
          'selected': selectedSocket === socket.id,
          'offline': !socket.online 
        }]"
        @click="selectSocket(socket)"
      >
        <div class="socket-name">
          <i class="pi pi-bolt"></i>
          {{ socket.name }}
        </div>
        <div class="socket-power">
          <i v-if="socket.power > 0" class="pi pi-arrow-down power-import"></i>
          <span :class="socket.power > 0 ? 'power-import' : ''">
            {{ socket.power > 0 ? '↓ ' : '— ' }}{{ Math.abs(socket.power).toFixed(0) }} W
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import ProgressSpinner from 'primevue/progressspinner';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const emit = defineEmits(['socket-selected']);

// State
const sockets = ref([]);
const loading = ref(false);
const selectedSocket = ref(null);
const sortAsc = ref(true);
let refreshInterval = null;

// Computed
const sortedSockets = computed(() => {
  const sorted = [...sockets.value];
  
  if (sortAsc.value) {
    // Sort by name A-Z
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Sort by power (highest first)
    sorted.sort((a, b) => b.power - a.power);
  }
  
  return sorted;
});

// Load data on mount
onMounted(() => {
  loadData();
  startAutoRefresh();
});

// Cleanup
onUnmounted(() => {
  stopAutoRefresh();
});

// Load data
async function loadData() {
  loading.value = true;
  try {
    // Get all HomeWizard settings
    const settingsResponse = await axios.get(`${API_BASE}/homewizard/settings`);
    const allDevices = settingsResponse.data.data || [];

    // Get current data
    const dataResponse = await axios.get(`${API_BASE}/homewizard/data`);
    const deviceData = dataResponse.data.data || [];

    // Create data map
    const dataMap = {};
    deviceData.forEach(item => {
      dataMap[item.meterId] = item;
    });

    // Collect all enabled devices (sockets + P1 meters)
    const socketsTemp = [];

    allDevices.forEach(device => {
      if (!device.enabled) return;

      const data = dataMap[device.id];
      const online = data?.success || false;
      const realtimeData = data?.data?.realtime || {};

      socketsTemp.push({
        id: device.id,
        name: device.name || device.serial || device.ip_address,
        online: online,
        power: realtimeData.grid?.power || 0,
        type: device.product_type
      });
    });

    sockets.value = socketsTemp;

  } catch (error) {
    console.error('Failed to load socket data:', error);
  } finally {
    loading.value = false;
  }
}

// Toggle sort
function toggleSort() {
  sortAsc.value = !sortAsc.value;
}

// Select socket
function selectSocket(socket) {
  selectedSocket.value = socket.id;
  emit('socket-selected', socket);
}

// Auto-refresh
function startAutoRefresh() {
  if (refreshInterval) return;
  refreshInterval = setInterval(loadData, 10000); // Every 10 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
</script>

<style scoped>
.energy-sockets-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary, #ffffff);
}

/* Header */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  background: var(--color-bg-primary, #ffffff);
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
  background: var(--color-bg-primary, #ffffff);
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