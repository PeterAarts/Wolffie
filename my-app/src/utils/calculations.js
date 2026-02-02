// src/utils/calculations.js

/**
 * Calculate self-consumption percentage
 * Self-consumption = (Solar Production - Grid Feed-in) / Solar Production * 100
 */
export const calculateSelfConsumption = (solarProduction, gridFeedIn) => {
  if (!solarProduction || solarProduction === 0) return 0;
  return ((solarProduction - gridFeedIn) / solarProduction) * 100;
};

/**
 * Calculate self-sufficiency percentage
 * Self-sufficiency = (Solar Production - Grid Feed-in) / Total Consumption * 100
 */
export const calculateSelfSufficiency = (solarProduction, gridFeedIn, totalConsumption) => {
  if (!totalConsumption || totalConsumption === 0) return 0;
  return ((solarProduction - gridFeedIn) / totalConsumption) * 100;
};

/**
 * Calculate CO2 savings
 * Based on average grid emissions (0.5 kg CO2 per kWh)
 */
export const calculateCO2Savings = (solarEnergyUsed, emissionFactor = 0.5) => {
  return solarEnergyUsed * emissionFactor;
};

/**
 * Calculate equivalent trees planted
 * One tree absorbs approximately 21 kg CO2 per year
 */
export const calculateTreesEquivalent = (co2Saved, co2PerTree = 21) => {
  return co2Saved / co2PerTree;
};

/**
 * Calculate cost savings
 */
export const calculateCostSavings = (energySaved, electricityRate) => {
  return energySaved * electricityRate;
};

/**
 * Calculate battery efficiency
 */
export const calculateBatteryEfficiency = (energyCharged, energyDischarged) => {
  if (!energyCharged || energyCharged === 0) return 0;
  return (energyDischarged / energyCharged) * 100;
};

/**
 * Calculate grid independence percentage
 */
export const calculateGridIndependence = (gridConsumption, totalConsumption) => {
  if (!totalConsumption || totalConsumption === 0) return 0;
  return ((totalConsumption - gridConsumption) / totalConsumption) * 100;
};

/**
 * Calculate estimated time remaining for battery charge/discharge
 */
export const calculateBatteryTimeRemaining = (currentSOC, targetSOC, power, capacity) => {
  if (!power || power === 0) return 0;
  
  const energyNeeded = Math.abs((targetSOC - currentSOC) / 100 * capacity);
  const hours = energyNeeded / Math.abs(power);
  
  return hours * 3600; // Convert to seconds
};

/**
 * Calculate average power over a period
 */
export const calculateAveragePower = (dataPoints) => {
  if (!dataPoints || dataPoints.length === 0) return 0;
  
  const sum = dataPoints.reduce((acc, point) => acc + (point.power || 0), 0);
  return sum / dataPoints.length;
};

/**
 * Calculate peak power
 */
export const calculatePeakPower = (dataPoints) => {
  if (!dataPoints || dataPoints.length === 0) return 0;
  
  return Math.max(...dataPoints.map(point => point.power || 0));
};

/**
 * Calculate energy from power over time
 * Power in watts, time in seconds
 */
export const calculateEnergyFromPower = (power, timeInSeconds) => {
  return (power * timeInSeconds) / 3600; // Convert to Wh
};

/**
 * Calculate solar panel efficiency
 * Assumes standard test conditions: 1000 W/m² irradiance
 */
export const calculateSolarEfficiency = (actualOutput, ratedCapacity) => {
  if (!ratedCapacity || ratedCapacity === 0) return 0;
  return (actualOutput / ratedCapacity) * 100;
};

/**
 * Calculate payback period in years
 */
export const calculatePaybackPeriod = (systemCost, annualSavings) => {
  if (!annualSavings || annualSavings === 0) return Infinity;
  return systemCost / annualSavings;
};

/**
 * Calculate return on investment percentage
 */
export const calculateROI = (totalSavings, systemCost) => {
  if (!systemCost || systemCost === 0) return 0;
  return ((totalSavings - systemCost) / systemCost) * 100;
};

/**
 * Interpolate value for smooth animations
 */
export const interpolate = (start, end, progress) => {
  return start + (end - start) * progress;
};

/**
 * Moving average calculation for smoothing data
 */
export const calculateMovingAverage = (data, windowSize = 5) => {
  if (!data || data.length < windowSize) return data;
  
  return data.map((value, index) => {
    if (index < windowSize - 1) return value;
    
    const window = data.slice(index - windowSize + 1, index + 1);
    const sum = window.reduce((acc, val) => acc + val, 0);
    return sum / windowSize;
  });
};

/**
 * Calculate percentage change
 */
export const calculatePercentageChange = (oldValue, newValue) => {
  if (!oldValue || oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
};