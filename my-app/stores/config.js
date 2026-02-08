// src/stores/config.js - WITH AUTHENTICATION via apiClient
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../services/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export const useConfigStore = defineStore('config', () => {
  // Loading states
  const isMinimalLoaded = ref(false);
  const isDetailedLoaded = ref(false);
  const isLoading = ref(false);
  const error = ref(null);
  
  // Configuration data
  const selectedModel = ref(null);
  const setupCompleted = ref(false);
  
  // Detailed config (lazy loaded)
  const modbusConfig = ref({
    ip: '',
    port: 502,
    slaveId: 85,
    enabled: false
  });
  const cloudApiConfig = ref({
    appId: '',
    systemSn: '',
    endpointUrl: 'https://openapi.alphaess.com/api',
    enabled: false
  });

  /**
   * PHASE 1: Load MINIMAL configuration (App Startup)
   * Only loads: setup status + selected model
   * 
   * Called by: App.vue/MainLayout.vue on mount
   */
  async function loadMinimalConfig() {
    if (isMinimalLoaded.value) {
      console.log('✅ Minimal config already loaded');
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      console.log('🚀 Loading minimal startup configuration...');

      // Use apiClient (adds auth token automatically)
      const setupResponse = await apiClient.get('/setup/status');
      
      setupCompleted.value = setupResponse.data.setupCompleted || false;
      selectedModel.value = setupResponse.data.selectedModel || null;

      console.log('✅ Setup status:', setupCompleted.value ? 'Complete' : 'Incomplete');
      if (selectedModel.value) {
        console.log('✅ Selected model:', selectedModel.value.manufacturer, selectedModel.value.modelName);
      }

      isMinimalLoaded.value = true;
      console.log('✅ Minimal configuration loaded (1 API call)');

    } catch (err) {
      console.error('❌ Error loading minimal config:', err);
      error.value = err.message;
      
      // Fallback defaults
      setupCompleted.value = false;
      selectedModel.value = null;
      
      // Still mark as loaded to prevent loops
      isMinimalLoaded.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * PHASE 2: Load DETAILED configuration (Settings View Only)
   * Loads: ModBus + Cloud API settings
   * 
   * Called by: Settings.vue on mount (lazy loading)
   */
  async function loadDetailedConfig() {
    if (isDetailedLoaded.value) {
      console.log('✅ Detailed config already loaded');
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      console.log('🔥 Loading detailed configuration for Settings view...');

      // Load ModBus configuration
      try {
        const modbusResponse = await apiClient.get('/settings/category/modbus');
        if (modbusResponse.data) {
          modbusConfig.value = {
            ip: modbusResponse.data.ip_address || '',
            port: modbusResponse.data.port || 502,
            slaveId: modbusResponse.data.slave_id || 85,
            enabled: modbusResponse.data.enabled !== false
          };
          console.log('✅ ModBus config loaded:', modbusConfig.value.ip || 'Not configured');
        }
      } catch (err) {
        console.log('ℹ️  No ModBus configuration found');
      }

      // Load Cloud API configuration
      try {
        const cloudResponse = await apiClient.get('/settings/category/cloud_api');
        if (cloudResponse.data) {
          cloudApiConfig.value = {
            appId: cloudResponse.data.app_id || '',
            systemSn: cloudResponse.data.system_sn || '',
            endpointUrl: cloudResponse.data.endpoint_url || 'https://openapi.alphaess.com/api',
            enabled: cloudResponse.data.enabled !== false
          };
          console.log('✅ Cloud API config loaded:', cloudApiConfig.value.enabled ? 'Enabled' : 'Disabled');
        }
      } catch (err) {
        console.log('ℹ️  No Cloud API configuration found');
      }

      isDetailedLoaded.value = true;
      console.log('✅ Detailed configuration loaded (2 API calls)');

    } catch (err) {
      console.error('❌ Error loading detailed config:', err);
      error.value = err.message;
      
      // Still mark as loaded
      isDetailedLoaded.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Reload EVERYTHING (after settings changes)
   */
  async function reloadConfiguration() {
    isMinimalLoaded.value = false;
    isDetailedLoaded.value = false;
    
    await loadMinimalConfig();
    await loadDetailedConfig();
  }

  /**
   * Update selected model
   */
  async function updateSelectedModel(modelId) {
    try {
      await apiClient.post('/setup/select-model', { modelId });
      
      // Reload minimal config to get updated model
      isMinimalLoaded.value = false;
      await loadMinimalConfig();
      
      return true;
    } catch (err) {
      console.error('Error updating selected model:', err);
      return false;
    }
  }

  /**
   * Update ModBus configuration
   */
  async function updateModbusConfig(config) {
    try {
      await apiClient.post('/settings/modbus', config);
      
      // Update local state
      modbusConfig.value = { ...modbusConfig.value, ...config };
      
      return true;
    } catch (err) {
      console.error('Error updating ModBus config:', err);
      return false;
    }
  }

  /**
   * Update Cloud API configuration
   */
  async function updateCloudApiConfig(config) {
    try {
      await apiClient.post('/settings/cloud-api', config);
      
      // Update local state
      cloudApiConfig.value = { ...cloudApiConfig.value, ...config };
      
      return true;
    } catch (err) {
      console.error('Error updating Cloud API config:', err);
      return false;
    }
  }

  /**
   * Mark setup as completed
   */
  async function completeSetup() {
    try {
      await apiClient.post('/setup/complete');
      setupCompleted.value = true;
      return true;
    } catch (err) {
      console.error('Error completing setup:', err);
      return false;
    }
  }

  /**
   * Get configuration summary for display
   */
  const summary = computed(() => {
    return {
      setupCompleted: setupCompleted.value,
      hasModel: selectedModel.value !== null,
      hasModbus: modbusConfig.value.ip !== '',
      hasCloudApi: cloudApiConfig.value.appId !== '',
      model: selectedModel.value ? {
        name: `${selectedModel.value.manufacturer} ${selectedModel.value.modelName}`,
        battery: selectedModel.value.batteryCapacity,
        mppt: selectedModel.value.mpptInputs
      } : null,
      modbus: modbusConfig.value.enabled ? {
        ip: modbusConfig.value.ip,
        status: 'Enabled'
      } : { status: 'Disabled' },
      cloudApi: cloudApiConfig.value.enabled ? {
        appId: cloudApiConfig.value.appId,
        status: 'Enabled'
      } : { status: 'Disabled' }
    };
  });

  /**
   * Check if detailed config is needed and not yet loaded
   */
  const needsDetailedConfig = computed(() => {
    return !isDetailedLoaded.value;
  });

  return {
    // State
    isMinimalLoaded,
    isDetailedLoaded,
    isLoading,
    error,
    selectedModel,
    modbusConfig,
    cloudApiConfig,
    setupCompleted,
    summary,
    needsDetailedConfig,
    
    // Actions
    loadMinimalConfig,
    loadDetailedConfig,
    reloadConfiguration,
    updateSelectedModel,
    updateModbusConfig,
    updateCloudApiConfig,
    completeSetup
  };
});