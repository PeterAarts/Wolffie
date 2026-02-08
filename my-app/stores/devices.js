// src/stores/devices.js - Pinia Store for Device Data Management
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '@/services/api';

export const useDevicesStore = defineStore('devices', () => {
  // State
  const devices = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const lastUpdate = ref(null);
  const refreshInterval = ref(15000); // Default 15 seconds
  const autoRefreshEnabled = ref(true);
  
  // Internal state
  let refreshTimer = null;

  // Computed
  const deviceCount = computed(() => devices.value.length);
  
  const activeDevices = computed(() => 
    devices.value.filter(device => {
      // Device is active if it has been updated in the last 5 minutes
      if (!device.timestamp) return false;
      const deviceTime = new Date(device.timestamp);
      const ageMs = Date.now() - deviceTime.getTime();
      return ageMs < 300000; // 5 minutes
    })
  );

  const devicesBySource = computed(() => {
    const grouped = {};
    devices.value.forEach(device => {
      const source = device.source || 'unknown';
      if (!grouped[source]) {
        grouped[source] = [];
      }
      grouped[source].push(device);
    });
    return grouped;
  });

  const totalPower = computed(() => {
    return devices.value.reduce((sum, device) => {
      return sum + (parseFloat(device.power) || 0);
    }, 0);
  });

  // Actions

  /**
   * Fetch all devices from API
   */
  async function fetchDevices() {
    loading.value = true;
    error.value = null;

    try {
      const { data } = await apiClient.get('/system/devices');
      
      devices.value = data.devices || [];
      lastUpdate.value = new Date();
      
      console.log(`✔ Devices store: Loaded ${devices.value.length} devices`);
      
      return devices.value;
    } catch (err) {
      error.value = err.response?.data?.error || err.message || 'Failed to fetch devices';
      console.error('✗ Devices store: Error fetching devices:', err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch single device by ID
   */
  async function fetchDevice(deviceId) {
    try {
      const { data } = await apiClient.get(`/system/devices/${deviceId}`);
      
      // Update the device in the store
      const index = devices.value.findIndex(d => d.device_id === deviceId);
      if (index !== -1) {
        devices.value[index] = data;
      } else {
        devices.value.push(data);
      }
      
      return data;
    } catch (err) {
      console.error(`✗ Devices store: Error fetching device ${deviceId}:`, err);
      throw err;
    }
  }

  /**
   * Get device by device_id (from store, no API call)
   */
  function getDevice(deviceId) {
    return devices.value.find(d => d.device_id === deviceId);
  }

  /**
   * Get devices by source (from store, no API call)
   */
  function getDevicesBySource(source) {
    return devices.value.filter(d => d.source === source);
  }

  /**
   * Load refresh interval from system settings
   */
  async function loadRefreshInterval() {
    try {
      const { data } = await apiClient.get('/settings/core/value/device_refresh_interval');
      
      const interval = parseInt(data.value);
      if (!isNaN(interval) && interval > 0) {
        refreshInterval.value = interval;
        console.log(`✔ Devices store: Refresh interval set to ${interval}ms`);
      }
    } catch (err) {
      console.warn('⚠ Devices store: Could not load refresh interval, using default:', err.message);
      // Keep default value
    }
  }

  /**
   * Start auto-refresh
   */
  function startAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    autoRefreshEnabled.value = true;

    // Initial fetch
    fetchDevices();

    // Set up interval
    refreshTimer = setInterval(() => {
      if (autoRefreshEnabled.value) {
        fetchDevices();
      }
    }, refreshInterval.value);

    console.log(`✔ Devices store: Auto-refresh started (${refreshInterval.value}ms)`);
  }

  /**
   * Stop auto-refresh
   */
  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    autoRefreshEnabled.value = false;
    console.log('✔ Devices store: Auto-refresh stopped');
  }

  /**
   * Restart auto-refresh with new interval
   */
  async function restartAutoRefresh() {
    stopAutoRefresh();
    await loadRefreshInterval();
    startAutoRefresh();
  }

  /**
   * Initialize the store
   * Call this when the app starts or when navigating to pages that need device data
   */
  async function initialize() {
    console.log('🔄 Devices store: Initializing...');
    
    try {
      // Load refresh interval from settings
      await loadRefreshInterval();
      
      // Start auto-refresh
      startAutoRefresh();
      
      console.log('✔ Devices store: Initialized successfully');
    } catch (err) {
      console.error('✗ Devices store: Initialization error:', err);
      // Still start auto-refresh with default settings
      startAutoRefresh();
    }
  }

  /**
   * Cleanup - call when unmounting or navigating away
   */
  function cleanup() {
    stopAutoRefresh();
    console.log('✔ Devices store: Cleaned up');
  }

  /**
   * Update refresh interval and restart auto-refresh
   */
  async function updateRefreshInterval(newInterval) {
    if (isNaN(newInterval) || newInterval < 1000) {
      throw new Error('Refresh interval must be at least 1000ms (1 second)');
    }

    try {
      // Update in database
      await apiClient.put('/api/settings/core', {
        device_refresh_interval: newInterval.toString()
      });

      // Update local state
      refreshInterval.value = newInterval;

      // Restart with new interval
      if (autoRefreshEnabled.value) {
        restartAutoRefresh();
      }

      console.log(`✔ Devices store: Refresh interval updated to ${newInterval}ms`);
    } catch (err) {
      console.error('✗ Devices store: Error updating refresh interval:', err);
      throw err;
    }
  }

  /**
   * Get time since last update
   */
  const timeSinceUpdate = computed(() => {
    if (!lastUpdate.value) return null;
    const seconds = Math.floor((Date.now() - lastUpdate.value.getTime()) / 1000);
    return seconds;
  });

  return {
    // State
    devices,
    loading,
    error,
    lastUpdate,
    refreshInterval,
    autoRefreshEnabled,

    // Computed
    deviceCount,
    activeDevices,
    devicesBySource,
    totalPower,
    timeSinceUpdate,

    // Actions
    fetchDevices,
    fetchDevice,
    getDevice,
    getDevicesBySource,
    loadRefreshInterval,
    startAutoRefresh,
    stopAutoRefresh,
    restartAutoRefresh,
    initialize,
    cleanup,
    updateRefreshInterval
  };
});