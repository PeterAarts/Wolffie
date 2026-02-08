// src/stores/system.js - Updated for /api/system endpoints
import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../services/api';

export const useSystemStore = defineStore('system', () => {
  // State
  const isLoading = ref(false);
  const isConnected = ref(false);
  const autoRefreshEnabled = ref(false);
  const error = ref(null);
  const hasInitialized = ref(false);
  
  // Status data with safe defaults
  const status = ref({
    battery: {
      soc: 0,
      power: 0,
      voltage: 0,
      temperature: 0,
      dailyCharge: 0,
      dailyDischarge: 0
    },
    grid: {
      power: 0,
      dailyImport: 0,
      dailyExport: 0
    },
    pv: {
      power: 0,
      pv1Power: 0,
      pv2Power: 0,
      pv3Power: 0,
      dailyEnergy: 0
    },
    load: {
      power: 0,
      dailyEnergy: 0
    }
  });

  /**
   * Fetch current system status
   * Uses new /api/system/realtime endpoint
   */
  async function fetchStatus() {
    // Don't fetch if we know we're disconnected
    if (!isConnected.value) {
      console.log('⏸️ Skipping fetchStatus - not connected');
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      console.log('📊 Fetching system status...');
      
      // Use new system/realtime endpoint
      const response = await apiClient.get('/system/realtime');
      
      // Update status from new response format
      const data = response.data;
      status.value = {
        battery: {
          soc: data.battery?.soc ?? 0,
          power: data.battery?.power ?? 0,
          voltage: 0, // Not available in realtime endpoint
          temperature: 0, // Not available in realtime endpoint
          dailyCharge: 0, // Get from summary if needed
          dailyDischarge: 0 // Get from summary if needed
        },
        grid: {
          power: data.grid?.power ?? 0,
          dailyImport: 0, // Get from summary if needed
          dailyExport: 0 // Get from summary if needed
        },
        pv: {
          power: data.solar?.total ?? 0,
          pv1Power: data.solar?.pv1 ?? 0,
          pv2Power: data.solar?.pv2 ?? 0,
          pv3Power: data.solar?.pv3 ?? 0,
          dailyEnergy: 0 // Get from summary if needed
        },
        load: {
          power: data.home?.power ?? 0,
          dailyEnergy: 0 // Get from summary if needed
        }
      };

      isConnected.value = true;
      console.log('✅ Status fetched successfully');

    } catch (err) {
      console.error('❌ Error fetching status:', err);
      
      if (err.response?.status === 503) {
        isConnected.value = false;
        autoRefreshEnabled.value = false;
        error.value = 'Data not available';
      } else {
        error.value = err.message || 'Failed to fetch status';
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Initialize store - check collector status
   */
  async function initialize() {
    // Only initialize once
    if (hasInitialized.value) {
      console.log('✔ Store already initialized');
      return isConnected.value;
    }

    console.log('🚀 Initializing system store...');
    isLoading.value = true;
    error.value = null;

    try {
      // Check collector-status (lightweight check)
      const response = await apiClient.get('/system/collector-status', {
        timeout: 3000
      });
      
      if (response.data && response.data.connected) {
        console.log('✅ Collector is connected (data age: ' + response.data.ageSeconds + 's)');
        isConnected.value = true;
        autoRefreshEnabled.value = true;
      } else {
        console.log('⚠️ Collector is not connected');
        isConnected.value = false;
        autoRefreshEnabled.value = false;
        error.value = response.data?.message || 'Collector not connected';
      }

      hasInitialized.value = true;
      return isConnected.value;

    } catch (err) {
      console.error('❌ Error initializing store:', err);
      console.log('⚠️ Cannot reach collector status');
      
      error.value = err.message || 'Cannot reach API server';
      isConnected.value = false;
      autoRefreshEnabled.value = false;
      hasInitialized.value = true;
      
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Handle connection restored (called by WebSocket)
   */
  function handleConnectionRestored() {
    console.log('🔄 Connection restored by WebSocket');
    isConnected.value = true;
    autoRefreshEnabled.value = true;
    error.value = null;
  }

  /**
   * Handle connection lost (called by WebSocket)
   */
  function handleConnectionLost() {
    console.log('⚠️ Connection lost (WebSocket notification)');
    isConnected.value = false;
    autoRefreshEnabled.value = false;
  }

  /**
   * Start auto-refresh (called by WebSocket when connection restored)
   */
  function startAutoRefresh() {
    console.log('▶️ Starting auto-refresh');
    autoRefreshEnabled.value = true;
  }

  /**
   * Stop auto-refresh (called by WebSocket when connection lost)
   */
  function stopAutoRefresh() {
    console.log('⏸️ Stopping auto-refresh');
    autoRefreshEnabled.value = false;
  }

  /**
   * Manual refresh - for retry button
   */
  async function manualRefresh() {
    console.log('🔄 Manual refresh requested');
    
    // Reset initialization to allow retry
    hasInitialized.value = false;
    
    // Try to check connection again
    await initialize();
    
    // If connected, fetch data
    if (isConnected.value) {
      await fetchStatus();
    }
  }

  /**
   * Update status from WebSocket data
   */
  function updateFromWebSocket(wsData) {
    if (!wsData) return;
    
    // Update battery SOC and other values from WebSocket
    if (wsData.batterySOC !== undefined) {
      status.value.battery.soc = wsData.batterySOC;
    }
    
    if (wsData.components) {
      // Update battery power
      if (wsData.components.battery_1) {
        const batteryIn = wsData.components.battery_1.currentIn || 0;
        const batteryOut = wsData.components.battery_1.currentOut || 0;
        status.value.battery.power = batteryIn > 0 ? batteryIn : -batteryOut;
      }
      
      // Update grid power
      if (wsData.components.grid) {
        const gridIn = wsData.components.grid.currentIn || 0;
        const gridOut = wsData.components.grid.currentOut || 0;
        status.value.grid.power = gridIn > 0 ? gridIn : -gridOut;
      }
      
      // Update PV power (sum of all PV strings)
      if (wsData.components.solar_1) {
        status.value.pv.pv1Power = wsData.components.solar_1.currentOut || 0;
      }
      if (wsData.components.solar_2) {
        status.value.pv.pv2Power = wsData.components.solar_2.currentOut || 0;
      }
      if (wsData.components.solar_3) {
        status.value.pv.pv3Power = wsData.components.solar_3.currentOut || 0;
      }
      
      // Calculate total PV power
      status.value.pv.power = status.value.pv.pv1Power + status.value.pv.pv2Power + status.value.pv.pv3Power;
      
      // Update load power
      if (wsData.components.home_usage) {
        status.value.load.power = wsData.components.home_usage.currentIn || 0;
      }
    }
    
    console.log('✅ System store updated from WebSocket, SOC:', status.value.battery.soc);
  }

  return {
    // State
    isLoading,
    isConnected,
    autoRefreshEnabled,
    error,
    status,
    
    // Actions
    initialize,
    fetchStatus,
    handleConnectionRestored,
    handleConnectionLost,
    startAutoRefresh,
    stopAutoRefresh,
    manualRefresh,
    updateFromWebSocket
  };
});