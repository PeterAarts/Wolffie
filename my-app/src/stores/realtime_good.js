// src/stores/realtime.js - FINAL CORRECTED VERSION
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';
import websocketService from '@/services/websocket';

export const useRealtimeStore = defineStore('realtime', () => {
  // ============================================
  // STATE
  // ============================================
  
  const connectionSource = ref('disconnected');
  const isConnected = computed(() => connectionSource.value !== 'disconnected');
  const isLoading = ref(false);
  const hasInitialized = ref(false);
  const lastUpdate = ref(null);
  const error = ref(null);
  
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

  // Summary data (daily/total energy values)
  const summaryData = ref({
    today_pv_gen: 0,
    today_load: 0,
    today_grid_export: 0,
    today_grid_import: 0,
    today_battery_charge: 0,
    today_battery_discharge: 0,
    total_trees: 0,
    total_co2: 0
  });

  // Real-time power data
  const realtimeData = ref({
    batterySOC: 0,
    components: {
      battery_1: {
        currentIn: 0,
        currentOut: 0,
        dailyIn: 0,
        dailyOut: 0
      },
      grid: {
        currentIn: 0,
        currentOut: 0,
        dailyIn: 0,
        dailyOut: 0
      },
      solar_1: {
        currentOut: 0,
        dailyOut: 0
      },
      solar_2: {
        currentOut: 0,
        dailyOut: 0
      },
      solar_3: {
        currentOut: 0,
        dailyOut: 0
      },
      home_usage: {
        currentIn: 0,
        dailyIn: 0
      },
      backup_unit: {
        currentIn: 0,
        currentOut: 0,
        dailyIn: 0,
        dailyOut: 0
      }
    },
    flows: {}
  });

  // ============================================
  // COMPUTED VALUES
  // ============================================
  
  const batterySOC = computed(() => realtimeData.value.batterySOC || 0);
  
  const batteryPower = computed(() => {
    const batteryIn = realtimeData.value.components.battery_1?.currentIn || 0;
    const batteryOut = realtimeData.value.components.battery_1?.currentOut || 0;
    // Positive = charging, Negative = discharging
    return batteryIn - batteryOut;
  });
  
  const solarPower = computed(() => {
    const solar1 = realtimeData.value.components.solar_1?.currentOut || 0;
    const solar2 = realtimeData.value.components.solar_2?.currentOut || 0;
    const solar3 = realtimeData.value.components.solar_3?.currentOut || 0;
    return solar1 + solar2 + solar3;
  });
  
  const gridPower = computed(() => {
    const gridIn = realtimeData.value.components.grid?.currentIn || 0;
    const gridOut = realtimeData.value.components.grid?.currentOut || 0;
    // Positive = importing, Negative = exporting
    return gridIn - gridOut;
  });
  
  const loadPower = computed(() => {
    return realtimeData.value.components.home_usage?.currentIn || 0;
  });

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  /**
   * Transform backend WebSocket data to store format
   * 
   * Backend sends:
   * {
   *   battery: { soc: 77.2, power: -1849 },
   *   grid: { power: -4 },
   *   pv: { power: 2204, string1: 0, string2: 0, string3: 0 },
   *   load: { power: 351, inverterPower: 351 }
   * }
   */
  function transformBackendData(backendData) {
    console.log('🔄 Transforming backend data:', {
      batterySoc: backendData.battery?.soc,
      batteryPower: backendData.battery?.power,
      pvPower: backendData.pv?.power,
      gridPower: backendData.grid?.power,
      loadPower: backendData.load?.power
    });
    
    return {
      batterySOC: backendData.battery?.soc || 0,
      components: {
        battery_1: {
          // Battery power: positive = charging, negative = discharging
          currentIn: backendData.battery?.power > 0 ? backendData.battery.power : 0,
          currentOut: backendData.battery?.power < 0 ? Math.abs(backendData.battery.power) : 0,
          dailyIn: 0,
          dailyOut: 0
        },
        grid: {
          // Grid power: positive = importing, negative = exporting
          currentIn: backendData.grid?.power > 0 ? backendData.grid.power : 0,
          currentOut: backendData.grid?.power < 0 ? Math.abs(backendData.grid.power) : 0,
          dailyIn: 0,
          dailyOut: 0
        },
        solar_1: {
          // Use TOTAL pv.power (your strings are all 0)
          currentOut: backendData.pv?.power || 0,
          dailyOut: 0
        },
        home_usage: {
          currentIn: Math.abs(backendData.load?.power) || 0,
          dailyIn: 0
        },
        backup_unit: {
          // Use inverter power from load
          currentIn: backendData.load?.inverterPower || 0,
          currentOut: backendData.load?.inverterPower || 0,
          dailyIn: 0,
          dailyOut: 0
        }
      },
      flows: {}
    };
  }

  /**
   * Update realtime data from WebSocket
   */
  function updateRealtimeData(wsData) {
    if (!wsData) return;
    
    console.log('📝 Updating realtime data, batterySOC:', wsData.batterySOC);
    
    // Update battery SOC
    if (wsData.batterySOC !== undefined) {
      realtimeData.value.batterySOC = wsData.batterySOC;
    }
    
    // Update components
    if (wsData.components) {
      Object.keys(wsData.components).forEach(key => {
        if (realtimeData.value.components[key]) {
          realtimeData.value.components[key] = {
            ...realtimeData.value.components[key],
            ...wsData.components[key]
          };
        }
      });
    }
    
    // Update flows
    if (wsData.flows) {
      realtimeData.value.flows = wsData.flows;
    }
    
    lastUpdate.value = new Date();
    
    console.log('✅ Updated realtimeData:', {
      batterySOC: realtimeData.value.batterySOC,
      batteryPower: batteryPower.value,
      solarPower: solarPower.value,
      gridPower: gridPower.value,
      loadPower: loadPower.value
    });
  }

  // ============================================
  // API CALLS
  // ============================================

  /**
   * Fetch summary data from /api/system/summary
   */
  async function fetchSummary() {
    try {
      console.log('📊 Fetching summary data from /api/system/summary...');
      const res = await axios.get(`${API_BASE_URL}/system/summary`);
      
      if (res.data) {
        summaryData.value = {
          today_pv_gen: parseFloat(res.data.today_pv_gen) || 0,
          today_load: parseFloat(res.data.today_load) || 0,
          today_grid_export: parseFloat(res.data.today_grid_export) || 0,
          today_grid_import: parseFloat(res.data.today_grid_import) || 0,
          today_battery_charge: parseFloat(res.data.today_battery_charge) || 0,
          today_battery_discharge: parseFloat(res.data.today_battery_discharge) || 0,
          total_trees: parseFloat(res.data.total_trees) || 0,
          total_co2: parseFloat(res.data.total_co2) || 0
        };
        console.log('✅ Summary data loaded:', summaryData.value);
      }
    } catch (err) {
      console.error('❌ Failed to fetch summary data:', err);
    }
  }

  /**
   * Fetch initial real-time data (one-time on startup)
   */
  async function fetchInitialData() {
    try {
      console.log('📊 Fetching initial real-time data...');
      const res = await axios.get(`${API_BASE_URL}/alphaess/complete-status`, {
        timeout: 5000
      });
      
      if (res.status === 503) {
        console.warn('⚠️ ModBus not connected (503)');
        return false;
      }

      const transformedData = transformBackendData(res.data);
      updateRealtimeData(transformedData);
      
      console.log('✅ Initial data loaded');
      return true;
    } catch (err) {
      console.error('❌ Failed to fetch initial data:', err);
      return false;
    }
  }

  /**
   * Check collector status and determine connection source
   */
  async function checkCollectorStatus() {
    try {
      console.log('🔍 Checking collector status...');
      const res = await axios.get(`${API_BASE_URL}/alphaess/collector-status`, {
        timeout: 3000
      });
      
      if (res.data) {
        const status = res.data;
        
        if (status.modbus && status.modbus.enabled && status.modbus.connected) {
          connectionSource.value = 'modbus';
          console.log('✅ Connected via ModBus');
          return true;
        } else if (status.cloud && status.cloud.enabled && status.cloud.available) {
          connectionSource.value = 'cloud';
          console.log('✅ Connected via Cloud API');
          return true;
        } else {
          connectionSource.value = 'disconnected';
          console.log('⚠️ No active connection');
          error.value = 'No active connection';
          return false;
        }
      }
      
      return false;
    } catch (err) {
      console.error('❌ Failed to check collector status:', err);
      connectionSource.value = 'disconnected';
      error.value = err.message;
      return false;
    }
  }

  // ============================================
  // WEBSOCKET INTEGRATION
  // ============================================

  /**
   * Start WebSocket listener for continuous updates
   */
  function startWebSocketListener() {
    console.log('🔌 Setting up WebSocket listeners...');
    
    // Listen to ALL WebSocket messages
    websocketService.on('message', (message) => {
      console.log('📨 WebSocket message type:', message.type);
      
      // Handle power_update type
      if (message.type === 'power_update' && message.data) {
        console.log('⚡ Power update received - battery SOC:', message.data.battery?.soc);
        const transformedData = transformBackendData(message.data);
        updateRealtimeData(transformedData);
      }
      // Handle summary_update type
      else if (message.type === 'summary_update' && message.data) {
        console.log('📊 Summary update from WebSocket');
        summaryData.value = { ...summaryData.value, ...message.data };
      }
      // Handle connection_status type
      else if (message.type === 'connection_status') {
        console.log('🔌 Connection status:', message.connected);
        if (message.connected) {
          connectionSource.value = message.connectionStatus?.currentSource || 'cloud';
          error.value = null;
        }
      }
      // Handle modbus_connected type
      else if (message.type === 'modbus_connected') {
        console.log('✅ ModBus connected');
        connectionSource.value = 'modbus';
        error.value = null;
      }
      // Handle modbus_disconnected type
      else if (message.type === 'modbus_disconnected') {
        console.log('⚠️ ModBus disconnected');
      }
      // Legacy: direct power data (no type field)
      else if (!message.type && message.batterySOC !== undefined) {
        console.log('⚡ Direct power data (legacy format)');
        updateRealtimeData(message);
      }
    });
    
    websocketService.connect();
    console.log('✅ WebSocket listeners configured');
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Initialize realtime store
   * 
   * Steps:
   * 1. Check collector status (connection source)
   * 2. Fetch summary data (daily totals)
   * 3. Fetch initial real-time data (one-time)
   * 4. Start WebSocket listener (continuous updates)
   */
  async function initialize() {
    if (hasInitialized.value) {
      console.log('✓ Store already initialized');
      return isConnected.value;
    }

    console.log('🚀 Initializing realtime store...');
    isLoading.value = true;
    error.value = null;

    try {
      // Step 1: Check collector status
      const isConnectedNow = await checkCollectorStatus();
      
      // Step 2: Fetch summary data
      await fetchSummary();
      
      // Step 3: Fetch initial real-time data (if connected)
      if (isConnectedNow) {
        await fetchInitialData();
      } else {
        console.log('⚠️ Starting in disconnected mode');
      }
      
      // Step 4: Start WebSocket listener
      startWebSocketListener();
      
      hasInitialized.value = true;
      console.log('✅ Realtime store initialized');
      
      return isConnected.value;

    } catch (err) {
      console.error('❌ Error initializing realtime store:', err);
      error.value = err.message;
      hasInitialized.value = true;
      
      // Still start WebSocket to listen for connection restoration
      startWebSocketListener();
      
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Manual refresh - for retry button
   */
  async function manualRefresh() {
    console.log('🔄 Manual refresh requested');
    hasInitialized.value = false;
    await initialize();
  }

  /**
   * Refresh summary data only
   */
  async function refreshSummary() {
    await fetchSummary();
  }

  /**
   * Handle connection restored (called by WebSocket)
   */
  function handleConnectionRestored(source) {
    console.log('🔄 Connection restored:', source);
    connectionSource.value = source || 'cloud';
    error.value = null;
    fetchInitialData();
    fetchSummary();
  }

  /**
   * Handle connection lost (called by WebSocket)
   */
  function handleConnectionLost() {
    console.log('⚠️ Connection lost');
    connectionSource.value = 'disconnected';
  }

  /**
   * Cleanup WebSocket listeners
   */
  function cleanup() {
    console.log('🧹 Cleaning up WebSocket listeners');
    websocketService.off('message');
    websocketService.disconnect();
  }

  // ============================================
  // COMPUTED INFO
  // ============================================

  /**
   * Connection info for display
   */
  const connectionInfo = computed(() => {
    return {
      source: connectionSource.value,
      isConnected: isConnected.value,
      statusText: connectionSource.value === 'cloud' 
        ? 'Connected (Cloud API)'
        : connectionSource.value === 'modbus'
        ? 'Connected (ModBus)'
        : 'Disconnected',
      statusColor: isConnected.value ? 'success' : 'warning',
      lastUpdate: lastUpdate.value
    };
  });

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return { 
    // State
    connectionSource, 
    isConnected, 
    isLoading,
    hasInitialized,
    lastUpdate,
    error,
    summaryData,
    realtimeData,
    
    // Computed values (easy access)
    batterySOC,
    batteryPower,
    solarPower,
    gridPower,
    loadPower,
    connectionInfo,
    
    // Actions
    initialize,
    manualRefresh,
    refreshSummary,
    handleConnectionRestored,
    handleConnectionLost,
    updateRealtimeData,
    cleanup
  };
});