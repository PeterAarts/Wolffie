// src/utils/formatters.js
import { format, parseISO } from 'date-fns';
import { DATE_FORMATS, ENERGY_UNITS } from './constants';

/**
 * Format a number with specified decimal places
 */
export const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.00';
  }
  return Number(value).toFixed(decimals);
};

/**
 * Format power value with appropriate unit (W or kW)
 */
export const formatPower = (watts, decimals = 2) => {
  if (watts === null || watts === undefined || isNaN(watts)) {
    return '0 W';
  }
  
  const absWatts = Math.abs(watts);
  
  if (absWatts >= 1000) {
    return `${formatNumber(watts / 1000, decimals)} ${ENERGY_UNITS.KILOWATT}`;
  }
  
  return `${formatNumber(watts, 0)} ${ENERGY_UNITS.WATT}`;
};

/**
 * Format energy value with appropriate unit (Wh, kWh, or MWh)
 */
export const formatEnergy = (wattHours, decimals = 2) => {
  if (wattHours === null || wattHours === undefined || isNaN(wattHours)) {
    return '0 kWh';
  }
  
  const absWattHours = Math.abs(wattHours);
  
  if (absWattHours >= 1000000) {
    return `${formatNumber(wattHours / 1000000, decimals)} ${ENERGY_UNITS.MEGAWATT_HOUR}`;
  }
  
  if (absWattHours >= 1000) {
    return `${formatNumber(wattHours / 1000, decimals)} ${ENERGY_UNITS.KILOWATT_HOUR}`;
  }
  
  return `${formatNumber(wattHours, 0)} ${ENERGY_UNITS.WATT_HOUR}`;
};

/**
 * Format percentage
 */
export const formatPercentage = (value, decimals = 1) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '0%';
  }
  return `${formatNumber(value, decimals)}%`;
};

/**
 * Format currency
 */
export const formatCurrency = (value, currency = '$', decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return `${currency}0.00`;
  }
  return `${currency}${formatNumber(value, decimals)}`;
};

/**
 * Format date with specified format
 */
export const formatDate = (date, formatString = DATE_FORMATS.SHORT_DATE) => {
  if (!date) return '';
  
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    return format(dateObj, formatString);
  } catch (error) {
    console.error('Error formatting date:', error);
    return '';
  }
};

/**
 * Format time
 */
export const formatTime = (date) => {
  return formatDate(date, DATE_FORMATS.TIME);
};

/**
 * Format datetime
 */
export const formatDateTime = (date) => {
  return formatDate(date, DATE_FORMATS.DATETIME);
};

/**
 * Format duration in seconds to human readable format
 */
export const formatDuration = (seconds) => {
  if (!seconds || seconds < 0) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
};

/**
 * Format large numbers with K, M, B suffixes
 */
export const formatCompactNumber = (value) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '0';
  }
  
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  
  if (absValue >= 1000000000) {
    return `${sign}${(absValue / 1000000000).toFixed(1)}B`;
  }
  if (absValue >= 1000000) {
    return `${sign}${(absValue / 1000000).toFixed(1)}M`;
  }
  if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K`;
  }
  
  return `${sign}${absValue.toFixed(0)}`;
};

/**
 * Format battery state of charge with color coding
 */
export const formatSOC = (soc) => {
  const value = formatPercentage(soc, 0);
  let color = 'text-green-600';
  
  if (soc < 20) {
    color = 'text-red-600';
  } else if (soc < 50) {
    color = 'text-orange-600';
  }
  
  return { value, color };
};