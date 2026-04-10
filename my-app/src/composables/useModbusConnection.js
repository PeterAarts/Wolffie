// src/composables/useModbusConnection.js
import { ref, computed } from 'vue';

export function useModbusConnection() {
  const connectionStatus = ref({
    connected: false,
    checking: true,
    errorMessage: null,
    lastCheck: null
  });

  const isConnected = computed(() => connectionStatus.value.connected);
  const isDisconnected = computed(() => !connectionStatus.value.connected && !connectionStatus.value.checking);
  const isChecking = computed(() => connectionStatus.value.checking);

  /**
   * Check ModBus connection status
   */
  async function checkConnection() {
    connectionStatus.value.checking = true;
    
    try {
      const response = await fetch('http://localhost:3000/api/alphaess/collector-status');
      const data = await response.json();
      
      connectionStatus.value = {
        connected: data.connected || false,
        checking: false,
        errorMessage: data.connected ? null : 'ModBus not connected',
        lastCheck: new Date()
      };
      
      return data.connected;
    } catch (error) {
      connectionStatus.value = {
        connected: false,
        checking: false,
        errorMessage: error.message,
        lastCheck: new Date()
      };
      
      return false;
    }
  }

  /**
   * Handle API response and update connection status
   */
  function handleApiResponse(response, error) {
    if (error) {
      // Check if it's a ModBus connection error
      if (error.response?.status === 503 || error.message?.includes('ModBus')) {
        connectionStatus.value = {
          connected: false,
          checking: false,
          errorMessage: error.response?.data?.message || error.message,
          lastCheck: new Date()
        };
        return false;
      }
    }
    
    // Success - assume connected
    if (response) {
      connectionStatus.value.connected = true;
      connectionStatus.value.errorMessage = null;
      return true;
    }
    
    return false;
  }

  /**
   * Make API call with connection error handling
   */
  async function apiCall(url, options = {}) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 503) {
        const data = await response.json();
        connectionStatus.value = {
          connected: false,
          checking: false,
          errorMessage: data.message || 'ModBus connection not available',
          lastCheck: new Date()
        };
        
        throw new Error(data.message || 'ModBus connection not available');
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Update connection status on success
      connectionStatus.value.connected = true;
      connectionStatus.value.errorMessage = null;
      
      return data;
    } catch (error) {
      handleApiResponse(null, error);
      throw error;
    }
  }

  return {
    connectionStatus,
    isConnected,
    isDisconnected,
    isChecking,
    checkConnection,
    handleApiResponse,
    apiCall
  };
}