// src/stores/settings.js - User Settings/Preferences Store
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSettingsStore = defineStore('settings', () => {
  // Tariff Settings
  const tariffSettings = ref({
    type: localStorage.getItem('tariffType') || 'flat',
    flatRate: parseFloat(localStorage.getItem('flatRate')) || 0.15,
    peakRate: parseFloat(localStorage.getItem('peakRate')) || 0.25,
    offPeakRate: parseFloat(localStorage.getItem('offPeakRate')) || 0.10,
    peakHours: JSON.parse(localStorage.getItem('peakHours') || '{"start": "17:00", "end": "21:00"}'),
    currency: localStorage.getItem('currency') || 'EUR',
    currencySymbol: localStorage.getItem('currencySymbol') || '€',
  });

  // Notification Settings
  const notificationSettings = ref({
    emailNotifications: JSON.parse(localStorage.getItem('emailNotifications') || 'true'),
    pushNotifications: JSON.parse(localStorage.getItem('pushNotifications') || 'true'),
    lowBatteryAlert: JSON.parse(localStorage.getItem('lowBatteryAlert') || 'true'),
    lowBatteryThreshold: parseInt(localStorage.getItem('lowBatteryThreshold') || '20'),
    systemFaultAlert: JSON.parse(localStorage.getItem('systemFaultAlert') || 'true'),
    dailyReport: JSON.parse(localStorage.getItem('dailyReport') || 'false'),
    weeklyReport: JSON.parse(localStorage.getItem('weeklyReport') || 'true'),
  });

  // Display Settings
  const displaySettings = ref({
    theme: localStorage.getItem('theme') || 'light',
    language: localStorage.getItem('language') || 'en',
    temperatureUnit: localStorage.getItem('temperatureUnit') || 'celsius',
    dateFormat: localStorage.getItem('dateFormat') || 'yyyy-MM-dd',
    timeFormat: localStorage.getItem('timeFormat') || '24h',
  });

  // Update Tariff Settings
  const updateTariffSettings = (settings) => {
    tariffSettings.value = { ...tariffSettings.value, ...settings };
    
    // Persist to localStorage
    Object.keys(settings).forEach(key => {
      const value = settings[key];
      if (typeof value === 'object') {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, value);
      }
    });
  };

  // Update Notification Settings
  const updateNotificationSettings = (settings) => {
    notificationSettings.value = { ...notificationSettings.value, ...settings };
    
    // Persist to localStorage
    Object.keys(settings).forEach(key => {
      const value = settings[key];
      if (typeof value === 'boolean') {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, value);
      }
    });
  };

  // Update Display Settings
  const updateDisplaySettings = (settings) => {
    displaySettings.value = { ...displaySettings.value, ...settings };
    
    // Persist to localStorage
    Object.keys(settings).forEach(key => {
      localStorage.setItem(key, settings[key]);
    });
    
    // Apply theme
    if (settings.theme) {
      applyTheme(settings.theme);
    }
  };

  // Apply theme to document
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Get current electricity rate based on time and tariff type
  const getCurrentRate = () => {
    if (tariffSettings.value.type === 'flat') {
      return tariffSettings.value.flatRate;
    }
    
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    const { start, end } = tariffSettings.value.peakHours;
    
    // Simple time comparison (doesn't handle midnight crossing)
    if (currentTime >= start && currentTime <= end) {
      return tariffSettings.value.peakRate;
    }
    
    return tariffSettings.value.offPeakRate;
  };

  // Calculate cost based on energy and time
  const calculateCost = (energyKWh, timestamp = null) => {
    let rate;
    
    if (tariffSettings.value.type === 'flat') {
      rate = tariffSettings.value.flatRate;
    } else {
      // If timestamp provided, calculate rate for that time
      if (timestamp) {
        const time = new Date(timestamp);
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
        const { start, end } = tariffSettings.value.peakHours;
        
        rate = (timeStr >= start && timeStr <= end) 
          ? tariffSettings.value.peakRate 
          : tariffSettings.value.offPeakRate;
      } else {
        rate = getCurrentRate();
      }
    }
    
    return energyKWh * rate;
  };

  // Reset all settings to defaults
  const resetAllSettings = () => {
    // Clear localStorage (but not config!)
    const configKeys = ['selected_model_id', 'modbus_ip', 'cloud_api_id'];
    Object.keys(localStorage).forEach(key => {
      if (!configKeys.includes(key)) {
        localStorage.removeItem(key);
      }
    });
    
    // Reset to defaults
    tariffSettings.value = {
      type: 'flat',
      flatRate: 0.15,
      peakRate: 0.25,
      offPeakRate: 0.10,
      peakHours: { start: '17:00', end: '21:00' },
      currency: 'EUR',
      currencySymbol: '€',
    };
    
    notificationSettings.value = {
      emailNotifications: true,
      pushNotifications: true,
      lowBatteryAlert: true,
      lowBatteryThreshold: 20,
      systemFaultAlert: true,
      dailyReport: false,
      weeklyReport: true,
    };
    
    displaySettings.value = {
      theme: 'light',
      language: 'en',
      temperatureUnit: 'celsius',
      dateFormat: 'yyyy-MM-dd',
      timeFormat: '24h',
    };
  };

  // Initialize theme on store creation
  applyTheme(displaySettings.value.theme);

  return {
    // State
    tariffSettings,
    notificationSettings,
    displaySettings,
    
    // Actions
    updateTariffSettings,
    updateNotificationSettings,
    updateDisplaySettings,
    getCurrentRate,
    calculateCost,
    resetAllSettings,
  };
});