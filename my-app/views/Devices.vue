<template>
  <div class="devices-view">
    <!-- Header with Controls -->
    <div class="devices-header">
      <div class="header-info">
        <h2>Devices</h2>
        <p class="device-count">{{ deviceStore.deviceCount }} devices found</p>
      </div>

      <div class="header-controls">
        <!-- Refresh Controls -->
        <div class="refresh-control">
          <InputSwitch 
            v-model="deviceStore.autoRefreshEnabled"
            @update:modelValue="handleAutoRefreshToggle"
          />
          <span class="control-label">Auto-refresh</span>
        </div>

        <!-- Refresh Interval -->
        <div class="interval-control">
          <InputNumber
            v-model="intervalSeconds"
            :min="1"
            :max="300"
            suffix=" seconds"
            :disabled="!deviceStore.autoRefreshEnabled"
            @update:modelValue="handleIntervalChange"
            showButtons
            buttonLayout="horizontal"
            decrementButtonClass="p-button-secondary"
            incrementButtonClass="p-button-secondary"
            incrementButtonIcon="pi pi-plus"
            decrementButtonIcon="pi pi-minus"
          />
        </div>

        <!-- Manual Refresh Button -->
        <Button
          icon="pi pi-refresh"
          label="Refresh Now"
          @click="handleManualRefresh"
          :loading="deviceStore.loading"
        />
      </div>
    </div>

    <!-- Status Bar -->
    <div class="status-bar" v-if="deviceStore.lastUpdate">
      <div class="status-item">
        <i class="pi pi-clock"></i>
        <span>Last update: {{ formatLastUpdate }}</span>
      </div>
      <div class="status-item">
        <i class="pi pi-bolt"></i>
        <span>Total Power: {{ deviceStore.totalPower.toFixed(1) }}W</span>
      </div>
      <div class="status-item">
        <i :class="deviceStore.autoRefreshEnabled ? 'pi pi-check-circle' : 'pi pi-times-circle'"></i>
        <span>Auto-refresh: {{ deviceStore.autoRefreshEnabled ? 'On' : 'Off' }}</span>
      </div>
    </div>

    <!-- Error Message -->
    <Message v-if="deviceStore.error" severity="error" :closable="false">
      {{ deviceStore.error }}
    </Message>

    <!-- Loading State -->
    <div v-if="deviceStore.loading && deviceStore.devices.length === 0" class="loading-container">
      <ProgressSpinner />
      <p>Loading devices...</p>
    </div>

    <!-- Devices Grid -->
    <div v-else class="devices-grid">
      <Card v-for="device in deviceStore.devices" :key="device.device_id" class="device-card">
        <template #header>
          <div class="device-card-header">
            <div class="device-icon">
              <i class="pi pi-bolt"></i>
            </div>
            <div class="device-title">
              <h3>{{ device.device_name }}</h3>
              <span class="device-id">{{ device.device_id }}</span>
            </div>
          </div>
        </template>

        <template #content>
          <div class="device-metrics">
            <!-- Power -->
            <div class="metric">
              <span class="metric-label">Power</span>
              <span class="metric-value" :class="{ 'active': device.power > 0 }">
                {{ device.power.toFixed(1) }}W
              </span>
            </div>

            <!-- Energy Total -->
            <div class="metric">
              <span class="metric-label">Total Energy</span>
              <span class="metric-value">{{ device.energy_total.toFixed(2) }} kWh</span>
            </div>

            <!-- WiFi Signal -->
            <div v-if="device.wifi_strength" class="metric">
              <span class="metric-label">WiFi</span>
              <span class="metric-value">
                <i :class="getWifiIcon(device.wifi_strength)"></i>
                {{ device.wifi_strength }}%
              </span>
            </div>
          </div>

          <!-- Timestamp -->
          <div class="device-timestamp">
            <i class="pi pi-clock"></i>
            <span>{{ formatTimestamp(device.timestamp) }}</span>
          </div>
        </template>

        <template #footer>
          <div class="device-actions">
            <Button 
              label="Details" 
              icon="pi pi-info-circle" 
              text 
              size="small"
              @click="showDeviceDetails(device)"
            />
          </div>
        </template>
      </Card>
    </div>

    <!-- Empty State -->
    <div v-if="!deviceStore.loading && deviceStore.devices.length === 0" class="empty-state">
      <i class="pi pi-inbox" style="font-size: 3rem; color: #9ca3af;"></i>
      <h3>No devices found</h3>
      <p>No device measurements available yet.</p>
      <Button label="Refresh" icon="pi pi-refresh" @click="handleManualRefresh" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useDevicesStore } from '@/stores/devices';
import { useToast } from 'primevue/usetoast';
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputSwitch from 'primevue/inputswitch';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';

const deviceStore = useDevicesStore();
const toast = useToast();

// Local state for interval input (in seconds)
const intervalSeconds = ref(Math.floor(deviceStore.refreshInterval / 1000));

// Computed
const formatLastUpdate = computed(() => {
  if (!deviceStore.lastUpdate) return 'Never';
  
  const seconds = deviceStore.timeSinceUpdate;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return deviceStore.lastUpdate.toLocaleTimeString();
});

// Methods
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function getWifiIcon(strength) {
  if (strength >= 75) return 'pi pi-wifi text-green-600';
  if (strength >= 50) return 'pi pi-wifi text-yellow-600';
  if (strength >= 25) return 'pi pi-wifi text-orange-600';
  return 'pi pi-wifi text-red-600';
}

async function handleManualRefresh() {
  try {
    await deviceStore.fetchDevices();
    toast.add({
      severity: 'success',
      summary: 'Refreshed',
      detail: `Loaded ${deviceStore.deviceCount} devices`,
      life: 2000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to refresh devices',
      life: 3000
    });
  }
}

function handleAutoRefreshToggle(enabled) {
  if (enabled) {
    deviceStore.startAutoRefresh();
    toast.add({
      severity: 'info',
      summary: 'Auto-refresh enabled',
      detail: `Refreshing every ${intervalSeconds.value}s`,
      life: 2000
    });
  } else {
    deviceStore.stopAutoRefresh();
    toast.add({
      severity: 'info',
      summary: 'Auto-refresh disabled',
      life: 2000
    });
  }
}

async function handleIntervalChange(newValue) {
  if (!newValue || newValue < 1) return;
  
  const milliseconds = newValue * 1000;
  
  try {
    await deviceStore.updateRefreshInterval(milliseconds);
    toast.add({
      severity: 'success',
      summary: 'Interval Updated',
      detail: `Refresh interval set to ${newValue} seconds`,
      life: 2000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update refresh interval',
      life: 3000
    });
    // Revert to previous value
    intervalSeconds.value = Math.floor(deviceStore.refreshInterval / 1000);
  }
}

function showDeviceDetails(device) {
  // Navigate to device details or show dialog
  console.log('Show details for device:', device);
}

// Lifecycle
onMounted(async () => {
  console.log('🔌 Devices View: Mounted');
  await deviceStore.initialize();
});

onUnmounted(() => {
  console.log('🔌 Devices View: Unmounted');
  deviceStore.cleanup();
});
</script>

<style scoped>
.devices-view {
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Header */
.devices-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #e5e7eb;
}

.header-info h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
  color: #111827;
}

.device-count {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.refresh-control,
.interval-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.control-label {
  font-size: 0.9rem;
  color: #6b7280;
  white-space: nowrap;
}

/* Status Bar */
.status-bar {
  display: flex;
  gap: 2rem;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #6b7280;
  font-size: 0.9rem;
}

.status-item i {
  color: #9ca3af;
}

/* Loading Container */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  color: #6b7280;
}

/* Devices Grid */
.devices-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

/* Device Card */
.device-card {
  transition: transform 0.2s, box-shadow 0.2s;
}

.device-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.device-card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.device-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
}

.device-icon i {
  font-size: 1.5rem;
}

.device-title h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.device-id {
  font-size: 0.85rem;
  opacity: 0.9;
  font-family: 'Courier New', monospace;
}

/* Device Metrics */
.device-metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.metric-label {
  font-size: 0.85rem;
  color: #6b7280;
  font-weight: 500;
}

.metric-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: #111827;
}

.metric-value.active {
  color: #10b981;
}

/* Device Timestamp */
.device-timestamp {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
  color: #6b7280;
  font-size: 0.85rem;
}

/* Device Actions */
.device-actions {
  display: flex;
  justify-content: flex-end;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  gap: 1rem;
  color: #6b7280;
}

.empty-state h3 {
  margin: 0.5rem 0;
  color: #374151;
}

.empty-state p {
  margin: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .devices-header {
    flex-direction: column;
    gap: 1rem;
  }

  .header-controls {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }

  .status-bar {
    flex-direction: column;
    gap: 0.75rem;
  }

  .devices-grid {
    grid-template-columns: 1fr;
  }
}
</style>