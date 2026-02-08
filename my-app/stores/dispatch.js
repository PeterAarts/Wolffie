// src/stores/dispatch.js
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { alphaESSService } from '../services/alphaess';
import { DISPATCH_MODES, DISPATCH_MODE_LABELS } from '../utils/constants';

export const useDispatchStore = defineStore('dispatch', () => {
  // State
  const currentMode = ref(DISPATCH_MODES.NORMAL);
  const targetSOC = ref(100);
  const power = ref(0);
  const schedules = ref([]);
  const isLoading = ref(false);
  const error = ref(null);

  // Computed
  const modeLabel = computed(() => DISPATCH_MODE_LABELS[currentMode.value]);
  
  const isCharging = computed(() => 
    currentMode.value === DISPATCH_MODES.FORCE_CHARGE
  );
  
  const isDischarging = computed(() => 
    currentMode.value === DISPATCH_MODES.FORCE_DISCHARGE
  );
  
  const isNormal = computed(() => 
    currentMode.value === DISPATCH_MODES.NORMAL
  );
  
  const isStopped = computed(() => 
    currentMode.value === DISPATCH_MODES.STOP
  );

  // Actions
  const fetchDispatchConfig = async (sysSn) => {
    isLoading.value = true;
    error.value = null;
    
    try {
      const response = await alphaESSService.getChargeConfigInfo(sysSn);
      
      if (response.data && response.code === 200) {
        const data = response.data;
        currentMode.value = data.batHighCap ? DISPATCH_MODES.FORCE_CHARGE : DISPATCH_MODES.NORMAL;
        targetSOC.value = data.batHighCap || 100;
        
        // Parse schedules if available
        if (data.timeChaf1 && data.timeChae1) {
          schedules.value = parseSchedules(data);
        }
      }
    } catch (err) {
      error.value = err.message || 'Failed to fetch dispatch configuration';
      console.error('Error fetching dispatch config:', err);
    } finally {
      isLoading.value = false;
    }
  };

  const updateDispatchMode = async (sysSn, mode, params = {}) => {
    isLoading.value = true;
    error.value = null;
    
    try {
      const payload = {
        sysSn,
        ...params
      };
      
      // Set mode-specific parameters
      switch (mode) {
        case DISPATCH_MODES.FORCE_CHARGE:
          payload.batHighCap = params.targetSOC || targetSOC.value;
          payload.gridCharge = 1;
          break;
          
        case DISPATCH_MODES.FORCE_DISCHARGE:
          payload.ctrDis = 1;
          break;
          
        case DISPATCH_MODES.PREVENT_DISCHARGE:
          payload.ctrDis = 0;
          break;
          
        case DISPATCH_MODES.STOP:
          payload.batHighCap = 0;
          payload.gridCharge = 0;
          payload.ctrDis = 0;
          break;
          
        case DISPATCH_MODES.NORMAL:
        default:
          payload.batHighCap = 100;
          payload.gridCharge = 0;
          payload.ctrDis = 0;
          break;
      }
      
      const response = await alphaESSService.updateChargeConfigInfo(payload);
      
      if (response.code === 200) {
        currentMode.value = mode;
        if (params.targetSOC) {
          targetSOC.value = params.targetSOC;
        }
        return true;
      }
      
      throw new Error(response.msg || 'Failed to update dispatch mode');
    } catch (err) {
      error.value = err.message || 'Failed to update dispatch mode';
      console.error('Error updating dispatch mode:', err);
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const addSchedule = async (sysSn, schedule) => {
    isLoading.value = true;
    error.value = null;
    
    try {
      // Add schedule logic here
      // This would involve calling the API to set time-based charging/discharging
      schedules.value.push(schedule);
      
      // Update the charge config with schedule
      const payload = buildSchedulePayload(sysSn, schedules.value);
      const response = await alphaESSService.updateChargeConfigInfo(payload);
      
      if (response.code === 200) {
        return true;
      }
      
      throw new Error(response.msg || 'Failed to add schedule');
    } catch (err) {
      error.value = err.message || 'Failed to add schedule';
      console.error('Error adding schedule:', err);
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const removeSchedule = async (sysSn, scheduleId) => {
    isLoading.value = true;
    error.value = null;
    
    try {
      schedules.value = schedules.value.filter(s => s.id !== scheduleId);
      
      const payload = buildSchedulePayload(sysSn, schedules.value);
      const response = await alphaESSService.updateChargeConfigInfo(payload);
      
      if (response.code === 200) {
        return true;
      }
      
      throw new Error(response.msg || 'Failed to remove schedule');
    } catch (err) {
      error.value = err.message || 'Failed to remove schedule';
      console.error('Error removing schedule:', err);
      return false;
    } finally {
      isLoading.value = false;
    }
  };

  const stopDispatch = async (sysSn) => {
    return await updateDispatchMode(sysSn, DISPATCH_MODES.STOP);
  };

  const setNormalMode = async (sysSn) => {
    return await updateDispatchMode(sysSn, DISPATCH_MODES.NORMAL);
  };

  const forceCharge = async (sysSn, targetSOC = 100) => {
    return await updateDispatchMode(sysSn, DISPATCH_MODES.FORCE_CHARGE, { targetSOC });
  };

  const forceDischarge = async (sysSn) => {
    return await updateDispatchMode(sysSn, DISPATCH_MODES.FORCE_DISCHARGE);
  };

  const preventDischarge = async (sysSn) => {
    return await updateDispatchMode(sysSn, DISPATCH_MODES.PREVENT_DISCHARGE);
  };

  // Helper functions
  const parseSchedules = (data) => {
    const schedules = [];
    
    for (let i = 1; i <= 4; i++) {
      const startKey = `timeChaf${i}`;
      const endKey = `timeChae${i}`;
      
      if (data[startKey] && data[endKey]) {
        schedules.push({
          id: i,
          startTime: data[startKey],
          endTime: data[endKey],
          enabled: true
        });
      }
    }
    
    return schedules;
  };

  const buildSchedulePayload = (sysSn, schedules) => {
    const payload = { sysSn };
    
    schedules.forEach((schedule, index) => {
      const num = index + 1;
      payload[`timeChaf${num}`] = schedule.startTime;
      payload[`timeChae${num}`] = schedule.endTime;
    });
    
    return payload;
  };

  return {
    // State
    currentMode,
    targetSOC,
    power,
    schedules,
    isLoading,
    error,
    
    // Computed
    modeLabel,
    isCharging,
    isDischarging,
    isNormal,
    isStopped,
    
    // Actions
    fetchDispatchConfig,
    updateDispatchMode,
    addSchedule,
    removeSchedule,
    stopDispatch,
    setNormalMode,
    forceCharge,
    forceDischarge,
    preventDischarge
  };
});