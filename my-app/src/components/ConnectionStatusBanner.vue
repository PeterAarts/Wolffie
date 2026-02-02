<template>
  <div class="connection-status-banner" :class="statusClass">
    <div class="status-content">
      <!-- Connection Icon -->
      <div class="status-icon">
        <svg v-if="isConnected" class="icon-connected" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else-if="isChecking" class="icon-checking" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2" opacity="0.3"/>
          <path d="M12 6v6l4 2" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else class="icon-disconnected" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <path d="M15 9l-6 6M9 9l6 6" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>

      <!-- Status Message -->
      <div class="status-message">
        <div class="status-title">
          <span v-if="isConnected">ModBus Connected</span>
          <span v-else-if="isChecking">Checking Connection...</span>
          <span v-else>ModBus Disconnected</span>
        </div>
        <div v-if="!isConnected && errorMessage" class="status-detail">
          {{ errorMessage }}
        </div>
        <div v-if="!isConnected && !isChecking" class="status-detail">
          Real-time data unavailable. Please check inverter connection.
        </div>
        <div v-if="lastCheck" class="status-timestamp">
          Last check: {{ formatTimestamp(lastCheck) }}
        </div>
      </div>

      <!-- Actions -->
      <div class="status-actions">
        <button 
          v-if="!isConnected && !isChecking" 
          @click="retryConnection"
          class="retry-button"
        >
          <svg class="icon-retry" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M1 4v6h6M23 20v-6h-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Retry
        </button>
        <button 
          v-if="!isMinimized"
          @click="minimize"
          class="minimize-button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M5 12h14" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useModbusConnection } from '../composables/useModbusConnection';

const { connectionStatus, isConnected, isDisconnected, isChecking, checkConnection } = useModbusConnection();

const isMinimized = ref(false);

const statusClass = computed(() => ({
  'status-connected': isConnected.value,
  'status-checking': isChecking.value,
  'status-disconnected': isDisconnected.value,
  'status-minimized': isMinimized.value
}));

const errorMessage = computed(() => connectionStatus.value.errorMessage);
const lastCheck = computed(() => connectionStatus.value.lastCheck);

function formatTimestamp(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString();
}

async function retryConnection() {
  await checkConnection();
}

function minimize() {
  isMinimized.value = true;
}
</script>

<style scoped>
.connection-status-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 12px 20px;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.status-connected {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.status-checking {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
}

.status-disconnected {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
}

.status-minimized {
  padding: 6px 20px;
}

.status-minimized .status-detail,
.status-minimized .status-timestamp {
  display: none;
}

.status-content {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1400px;
  margin: 0 auto;
}

.status-icon {
  flex-shrink: 0;
}

.status-icon svg {
  width: 32px;
  height: 32px;
  stroke-width: 2;
}

.icon-checking {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-message {
  flex: 1;
  min-width: 0;
}

.status-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}

.status-detail {
  font-size: 14px;
  opacity: 0.95;
  margin-top: 4px;
}

.status-timestamp {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 4px;
}

.status-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.retry-button,
.minimize-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-button:hover,
.minimize-button:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.retry-button:active,
.minimize-button:active {
  transform: translateY(0);
}

.minimize-button {
  padding: 8px;
}

.retry-button svg,
.minimize-button svg {
  width: 18px;
  height: 18px;
}

.icon-retry {
  animation: none;
}

.retry-button:hover .icon-retry {
  animation: spin 1s ease-in-out;
}

/* Responsive */
@media (max-width: 768px) {
  .connection-status-banner {
    padding: 10px 16px;
  }

  .status-content {
    gap: 12px;
  }

  .status-icon svg {
    width: 24px;
    height: 24px;
  }

  .status-title {
    font-size: 14px;
  }

  .status-detail {
    font-size: 12px;
  }

  .retry-button,
  .minimize-button {
    padding: 6px 12px;
    font-size: 12px;
  }
}
</style>