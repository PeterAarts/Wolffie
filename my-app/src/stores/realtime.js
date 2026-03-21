// src/stores/realtime.js - WITH INITIAL SNAPSHOT SUPPORT
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from "../services/api";
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
      solar: {
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
    return batteryIn - batteryOut;
  });
  
  const solarPower = computed(() => {
    const solar = realtimeData.value.components.total?.currentOut || 0;
    return solar;
  });
  
  const gridPower = computed(() => {
    const gridIn = realtimeData.value.components.grid?.currentIn || 0;
    const gridOut = realtimeData.value.components.grid?.currentOut || 0;
    return gridIn - gridOut;
  });
  
  const loadPower = computed(() => {
    return realtimeData.value.components.home_usage?.currentIn || 0;
  });

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  /**
   * Transform backend data format to store format
   */
  function transformBackendData(backendData) {
    console.log('🔄 Transforming backend data');
    
    return {
      batterySOC: backendData.battery?.soc || 0,
      components: {
        battery_1: {
          currentIn: backendData.battery?.power > 0 ? backendData.battery.power : 0,
          currentOut: backendData.battery?.power < 0 ? Math.abs(backendData.battery.power) : 0,
          dailyIn: 0,
          dailyOut: 0
        },
        grid: {
          currentIn: backendData.grid?.power > 0 ? backendData.grid.power : 0,
          currentOut: backendData.grid?.power < 0 ? Math.abs(backendData.grid.power) : 0,
          dailyIn: 0,
          dailyOut: 0
        },
        solar: {
          currentOut: 0,
          dailyOut: 0
        },
        home_usage: {
          currentIn: Math.abs(backendData.load?.power) || 0,
          dailyIn: 0
        },
        backup_unit: {
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
   * Update realtime data from WebSocket or snapshot
   */
  function updateRealtimeData(wsData) {
    if (!wsData) return;
    
    console.log('📝 Updating realtime data, batterySOC:', wsData.batterySOC);
    
    if (wsData.batterySOC !== undefined) {
      realtimeData.value.batterySOC = wsData.batterySOC;
    }
    
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
    
    if (wsData.flows) {
      realtimeData.value.flows = wsData.flows;
    }
    
    lastUpdate.value = new Date();
    
    console.log('✅ Updated realtimeData - Computed values:', {
      batterySOC: batterySOC.value,
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
   * Fetch summary data + latest snapshot
   * NEW: Now also populates realtime data from latest_snapshot
   */
async function fetchSummary() {
    try {
      console.log('📊 Fetching summary data from /api/system/summary...');
      const res = await apiClient.get('/system/summary');
      
      if (res) {
        // Update daily totals from new response format
        summaryData.value = {
          today_pv_gen: parseFloat(res.today.pv_generation) || 0,
          today_load: parseFloat(res.today.load_consumption) || 0,
          today_grid_export: parseFloat(res.today.grid_export) || 0,
          today_grid_import: parseFloat(res.today.grid_import) || 0,
          today_battery_charge: parseFloat(res.today.battery_charge) || 0,
          today_battery_discharge: parseFloat(res.today.battery_discharge) || 0,
          total_trees: parseFloat(res.environmental.trees_equivalent) || 0,
          total_co2: parseFloat(res.environmental.co2_saved) || 0
        };
        
        console.log('✅ Summary data loaded:', summaryData.value);
        
        // Update realtime data from snapshot
        if (res.realtime) {
          console.log('📸 Loading realtime data from summary...');
          
          const rt = res.realtime;
          
          // Transform to store format
          updateRealtimeData({
            batterySOC: rt.battery.soc,
            components: {
              battery_1: {
                currentIn: rt.battery.power > 0 ? rt.battery.power : 0,
                currentOut: rt.battery.power < 0 ? Math.abs(rt.battery.power) : 0,
                dailyIn: parseFloat(res.today.battery_charge) || 0,
                dailyOut: parseFloat(res.today.battery_discharge) || 0
              },
              grid: {
                currentIn: rt.grid.power > 0 ? rt.grid.power : 0,
                currentOut: rt.grid.power < 0 ? Math.abs(rt.grid.power) : 0,
                dailyIn: parseFloat(res.today.grid_import) || 0,
                dailyOut: parseFloat(res.today.grid_export) || 0
              },
              solar: {
                currentOut: rt.solar.total || 0,
                dailyOut: parseFloat(res.today.pv_generation) || 0
              },
              home_usage: {
                currentIn: rt.home.power || 0,
                dailyIn: parseFloat(res.today.load_consumption) || 0
              }
            }
          });
          
          // Update connection status from collector info
          if (res.collector) {
            connectionSource.value = res.collector.connected ? 'modbus' : 'disconnected';
          }
          
          console.log('✅ Realtime data loaded from summary');
        }
      }
    } catch (err) {
      console.error('❌ Failed to fetch summary data:', err);
    }
  }


  /**
   * Check collector status
   */
  async function checkCollectorStatus() {
    try {
      console.log('🔍 Checking collector status...');
      const res = await apiClient.get('/system/collector-status', {
        timeout: 3000
      });
      
      if (res && res.connected) {
        connectionSource.value = 'modbus';
        console.log('✅ Connected (data age: ' + res.ageSeconds + 's)');
        return true;
      } else {
        connectionSource.value = 'disconnected';
        console.log('⚠️ No active connection');
        error.value = 'No active connection';
        return false;
      }
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
   * Start WebSocket listener
   */
  function startWebSocketListener() {
    console.log('🔌 Setting up WebSocket listeners...');
    
    websocketService.on('message', (message) => {
      console.log('📨 WebSocket message type:', message.type);
      
      if (message.type === 'power_update' && message.data) {
        console.log('⚡ Power update received');
        const transformedData = transformBackendData(message.data);
        updateRealtimeData(transformedData);
      }
      else if (message.type === 'summary_update' && message.data) {
        console.log('📊 Summary update from WebSocket');
        summaryData.value = { ...summaryData.value, ...message.data };
      }
      else if (message.type === 'connection_status') {
        console.log('🔌 Connection status:', message.connected);
        if (message.connected) {
          connectionSource.value = message.connectionStatus?.currentSource || 'cloud';
          error.value = null;
        }
      }
      else if (message.type === 'modbus_connected') {
        console.log('✅ ModBus connected');
        connectionSource.value = 'modbus';
        error.value = null;
      }
      else if (message.type === 'modbus_disconnected') {
        console.log('⚠️ ModBus disconnected');
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
   * 1. Check collector status
   * 2. Fetch summary + latest snapshot (instant data!)
   * 3. Try to fetch fresh data if connected
   * 4. Start WebSocket for continuous updates
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
      
      // Step 2: Fetch summary + snapshot (this populates both summaryData AND realtimeData)
      await fetchSummary();
      
      // Step 3: Try to fetch fresh data if connected (optional, snapshot already loaded)
      if (isConnectedNow) {
        console.log('🔄 Attempting to fetch fresh data...');
        await fetchInitialData().catch(() => {
          console.log('⚠️ Fresh data fetch failed, using snapshot data');
        });
      } else {
        console.log('ℹ️ Starting with snapshot data (no live connection)');
      }
      
      // Step 4: Start WebSocket for continuous updates
      startWebSocketListener();
      
      hasInitialized.value = true;
      console.log('✅ Realtime store initialized');
      
      return isConnected.value;

    } catch (err) {
      console.error('❌ Error initializing realtime store:', err);
      error.value = err.message;
      hasInitialized.value = true;
      
      startWebSocketListener();
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // ============================================
  // ACTIONS
  // ============================================

  async function manualRefresh() {
    console.log('🔄 Manual refresh requested');
    hasInitialized.value = false;
    await initialize();
  }

  async function refreshSummary() {
    await fetchSummary();
  }

  function handleConnectionRestored(source) {
    console.log('🔄 Connection restored:', source);
    connectionSource.value = source || 'cloud';
    error.value = null;
    fetchInitialData();
    fetchSummary();
  }

  function handleConnectionLost() {
    console.log('⚠️ Connection lost');
    connectionSource.value = 'disconnected';
  }

  function cleanup() {
    console.log('🧹 Cleaning up WebSocket listeners');
    websocketService.off('message');
    websocketService.disconnect();
  }

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
    connectionSource, 
    isConnected, 
    isLoading,
    hasInitialized,
    lastUpdate,
    error,
    summaryData,
    realtimeData,
    
    batterySOC,
    batteryPower,
    solarPower,
    gridPower,
    loadPower,
    connectionInfo,
    
    initialize,
    manualRefresh,
    refreshSummary,
    handleConnectionRestored,
    handleConnectionLost,
    updateRealtimeData,
    cleanup
  };
});