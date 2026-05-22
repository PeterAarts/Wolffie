// src/stores/realtime.js - WITH INITIAL SNAPSHOT SUPPORT
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import apiClient from "../services/api";
import websocketService from '@/services/websocket';
import { useToastStore } from '@/stores/toast';

export const useRealtimeStore = defineStore('realtime', () => {
  // ============================================
  // STATE
  // ============================================
  
  const connectionSource = ref('disconnected');
  const isConnected = computed(() => connectionSource.value !== 'disconnected');
  const systemHealth = ref('offline'); // 'ok' | 'degraded' | 'offline'
  const isLoading = ref(false);
  const hasInitialized = ref(false);
  const wsListenerActive = ref(false);
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
        currentIn:     0,
        currentOut:    0,
        dailyIn:       0,
        dailyOut:      0,
        gridConnected: true,
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

  // ── Dashboard v2 additive blocks ────────────────────────────────────────
  // Populated from /api/system/summary's new top-level keys: peak, dayPlan,
  // forecast, advisory, _meta. Default values match the endpoint's stub
  // shapes so the UI can render before the first poll completes.
  const peakInfo = ref({
    state:        'idle',
    severity:     null,
    window:       null,
    minutesUntil: null,
    reason:       null,
  });
  const dayPlan = ref({
    batteryAtPeakStartPct:        null,
    batteryAtPeakEndPct:          null,
    expectedGridImportKwhTonight: null,
  });
  const forecast = ref([]);
  const advisory = ref({
    id:        'idle-default',
    tone:      'neutral',
    headline:  '',
    body:      '',
    constraint: null,
  });
  const dashboardMeta = ref({
    partialImplementation: [],
  });
  const healthInfo = ref({
    lastCollectorRunAt: null,
    stale:              false,
    degradedSources:    [],
  });

  // Dashboard v3 — 14-day rolling averages for ring reference scales
  const averages = ref({
    avg_solar_14d: null,
    avg_load_14d:  null,
  });

  // Dashboard v3 — latest smart-eco strategy decision
  const strategyDecision = ref(null); // { reason, evaluatedAt } | null

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
    return realtimeData.value.components.solar?.currentOut || 0;
  });
  
  const gridPower = computed(() => {
    const gridIn = realtimeData.value.components.grid?.currentIn || 0;
    const gridOut = realtimeData.value.components.grid?.currentOut || 0;
    return gridIn - gridOut;
  });

  const gridConnected = computed(() =>
    realtimeData.value.components.grid?.gridConnected ?? true
  );
  
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

    const result = { components: {} };

    // Only set batterySOC when the payload actually carries it.
    // Passing undefined means updateRealtimeData() will leave the existing value intact.
    if (backendData.battery?.soc != null) {
      result.batterySOC = backendData.battery.soc;
    }

    // Battery — only when present in payload
    if (backendData.battery != null) {
      const power = backendData.battery.power ?? 0;
      result.components.battery_1 = {
        currentIn:  power > 0 ? power : 0,
        currentOut: power < 0 ? Math.abs(power) : 0,
        dailyIn:  0,
        dailyOut: 0,
      };
    }

    // Grid — only when present in payload
    if (backendData.grid != null) {
      const power = backendData.grid.power ?? 0;
      result.components.grid = {
        currentIn:     power > 0 ? power : 0,
        currentOut:    power < 0 ? Math.abs(power) : 0,
        dailyIn:       0,
        dailyOut:      0,
        gridConnected: backendData.grid.gridConnected ?? true,
      };
    }

    // Home — only when present in payload
    if (backendData.load != null) {
      result.components.home_usage = {
        currentIn: Math.abs(backendData.load.power ?? 0),
        dailyIn: 0,
      };
    }

    // Solar is intentionally excluded here.
    // WebSocket power_update payloads originate from AlphaESS/HomeWizard and
    // carry no solar data. Including solar: { currentOut: 0 } would overwrite
    // the correct value that fetchSummary() loaded from the SolarEdge snapshot.
    // Solar is populated exclusively via the HTTP summary poll.

    return result;
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
      const data = res.data;
      
      if (data) {
        // Update daily totals from new response format
        summaryData.value = {
          today_pv_gen: parseFloat(data.today.pv_generation) || 0,
          today_load: parseFloat(data.today.load_consumption) || 0,
          today_grid_export: parseFloat(data.today.grid_export) || 0,
          today_grid_import: parseFloat(data.today.grid_import) || 0,
          today_battery_charge: parseFloat(data.today.battery_charge) || 0,
          today_battery_discharge: parseFloat(data.today.battery_discharge) || 0,
          total_trees: parseFloat(data.environmental.trees_equivalent) || 0,
          total_co2: parseFloat(data.environmental.co2_saved) || 0
        };
        
        console.log('✅ Summary data loaded:', summaryData.value);
        
        // Update realtime data from snapshot
        if (data.realtime) {
          console.log('📸 Loading realtime data from summary...');
          
          const rt = data.realtime;
          
          // Transform to store format
          updateRealtimeData({
            batterySOC: rt.battery.soc,
            components: {
              battery_1: {
                currentIn: rt.battery.power > 0 ? rt.battery.power : 0,
                currentOut: rt.battery.power < 0 ? Math.abs(rt.battery.power) : 0,
                dailyIn: parseFloat(data.today.battery_charge) || 0,
                dailyOut: parseFloat(data.today.battery_discharge) || 0
              },
              grid: {
                currentIn:     rt.grid.power > 0 ? rt.grid.power : 0,
                currentOut:    rt.grid.power < 0 ? Math.abs(rt.grid.power) : 0,
                dailyIn:       parseFloat(data.today.grid_import) || 0,
                dailyOut:      parseFloat(data.today.grid_export) || 0,
                gridConnected: rt.grid.gridConnected ?? true,
              },
              solar: {
                currentOut: rt.solar.total || 0,
                dailyOut: parseFloat(data.today.pv_generation) || 0
              },
              home_usage: {
                currentIn: rt.home.power || 0,
                dailyIn: parseFloat(data.today.load_consumption) || 0
              }
            }
          });
          
          // Update connection status from collector health (module-agnostic)
          await fetchCollectorHealth();
          
          console.log('✅ Realtime data loaded from summary');
        }

        // ── v2 dashboard additive blocks (peak / dayPlan / forecast / advisory / health / _meta)
        // Each is optional; if the field is missing from the response we leave
        // the existing reactive value untouched (last-known-good).
        if (data.peak)      peakInfo.value      = data.peak;
        if (data.dayPlan)   dayPlan.value       = data.dayPlan;
        if (data.forecast)  forecast.value      = data.forecast;
        if (data.advisory)  advisory.value      = data.advisory;
        if (data.health)    healthInfo.value        = data.health;
        if (data._meta)     dashboardMeta.value     = data._meta;
        if (data.averages)  averages.value          = data.averages;
        if (data.strategyDecision !== undefined) strategyDecision.value = data.strategyDecision;
      }
    } catch (err) {
      console.error('❌ Failed to fetch summary data:', err);
    }
  }


  /**
   * Derive system health from /api/collectors/status.
   * ok       — server reachable, no collector errors
   * degraded — server reachable, ≥1 collector has consecutive errors
   * offline  — server unreachable
   */
  async function fetchCollectorHealth() {
    try {
      const res = await apiClient.get('/collectors/status', { timeout: 4000 });
      const { running, collectors = [] } = res.data;

      if (!running) {
        systemHealth.value = 'offline';
        connectionSource.value = 'disconnected';
        return;
      }

      const anyError = collectors.some(c => c.enabled && c.consecutiveErrors > 0);
      systemHealth.value = anyError ? 'degraded' : 'ok';
      // Keep connectionSource in sync for backward compat
      connectionSource.value = anyError ? 'degraded' : 'modbus';
    } catch {
      systemHealth.value = 'offline';
      connectionSource.value = 'disconnected';
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
    if (wsListenerActive.value) {
      console.log('✓ WebSocket listener already active');
      return;
    }
    console.log('🔌 Setting up WebSocket listeners...');
    wsListenerActive.value = true;
    
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
      // Step 1: Fetch summary — also sets connectionSource from data.collector.connected
      fetchSummary();
      
      // Step 2: Start WebSocket for continuous updates
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
    wsListenerActive.value = false;
    websocketService.off('message');
    await initialize();
  }

  async function refreshSummary() {
    await fetchSummary();
  }

  function handleConnectionRestored(source) {
    console.log('🔄 Connection restored:', source);
    connectionSource.value = source || 'cloud';
    error.value = null;
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
    wsListenerActive.value = false;
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

  // ── Grid restored toast ──────────────────────────────────────────────────
  // Fires once on false → true transition. Skips the initial value (immediate: false)
  // so a page load while grid is online doesn't trigger a spurious toast.

  watch(gridConnected, (isConnected, wasConnected) => {
    if (!wasConnected && isConnected) {
      const toastStore = useToastStore();
      toastStore.add({
        severity: 'success',
        summary:  'Grid restored',
        detail:   'Power supply returned to normal.',
        life:     8000,
      });
    }
  });

  // ============================================
  // RETURN PUBLIC API
  // ============================================

  return {
    connectionSource, 
    isConnected,
    systemHealth,
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
    gridConnected,
    loadPower,
    connectionInfo,
    
    // Dashboard v2 additive blocks
    peakInfo,
    dayPlan,
    forecast,
    advisory,
    healthInfo,
    dashboardMeta,
    averages,
    strategyDecision,
    
    initialize,
    manualRefresh,
    refreshSummary,
    handleConnectionRestored,
    handleConnectionLost,
    updateRealtimeData,
    cleanup
  };
});