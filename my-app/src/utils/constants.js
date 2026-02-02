// src/utils/constants.js

export const REFRESH_INTERVALS = {
  REAL_TIME: 10000, // 10 seconds
  FAST: 30000, // 30 seconds
  NORMAL: 60000, // 1 minute
  SLOW: 300000, // 5 minutes
};

export const CHART_COLORS = {
  SOLAR: '#f59e0b',
  BATTERY: '#10b981',
  GRID: '#f97316',
  LOAD: '#3b82f6',
  CONSUMPTION: '#6366f1',
};

export const BATTERY_STATES = {
  CHARGING: 'charging',
  DISCHARGING: 'discharging',
  IDLE: 'idle',
  FAULT: 'fault',
};

export const DISPATCH_MODES = {
  STOP: 0,
  PREVENT_DISCHARGE: 1,
  NORMAL: 2,
  FORCE_CHARGE: 3,
  FORCE_DISCHARGE: 4,
};

export const DISPATCH_MODE_LABELS = {
  [DISPATCH_MODES.STOP]: 'Stop',
  [DISPATCH_MODES.PREVENT_DISCHARGE]: 'Prevent Discharge',
  [DISPATCH_MODES.NORMAL]: 'Normal',
  [DISPATCH_MODES.FORCE_CHARGE]: 'Force Charge',
  [DISPATCH_MODES.FORCE_DISCHARGE]: 'Force Discharge',
};

export const ENERGY_UNITS = {
  WATT: 'W',
  KILOWATT: 'kW',
  WATT_HOUR: 'Wh',
  KILOWATT_HOUR: 'kWh',
  MEGAWATT_HOUR: 'MWh',
};

export const DATE_FORMATS = {
  SHORT_DATE: 'yyyy-MM-dd',
  LONG_DATE: 'MMMM dd, yyyy',
  TIME: 'HH:mm:ss',
  DATETIME: 'yyyy-MM-dd HH:mm:ss',
  MONTH_YEAR: 'MMMM yyyy',
};

export const API_ENDPOINTS = {
  STATUS: '/getLastPowerData',
  HISTORY: '/getOneDateEnergyBySn',
  ONE_DATE_ENERGY: '/getOneDateEnergyBySn',
  CHARGE_CONFIG: '/getChargeConfigInfo',
  UPDATE_CHARGE_CONFIG: '/updateChargeConfigInfo',
};

export const TARIFF_TYPES = {
  FLAT: 'flat',
  TIME_OF_USE: 'time_of_use',
};

export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
};