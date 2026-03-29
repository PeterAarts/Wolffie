// src/stores/strategy.js
// Polls /api/strategies/active every 60 seconds.
// No WebSocket dependency — strategy state changes are low-frequency.

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '@/services/api';

export const useStrategyStore = defineStore('strategy', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  const activeStrategy   = ref(null);   // full strategy meta object
  const decision         = ref(null);   // latest { action, reason, evaluatedAt }
  const dayPlan          = ref([]);     // rolling plan slots
  const windowStart      = ref(null);   // ISO datetime when window begins
  const windowHours      = ref(24);     // planning horizon in hours
  const config           = ref({});     // active strategy config
  const isLoading        = ref(false);
  const lastUpdate       = ref(null);
  const error            = ref(null);

  let _pollTimer = null;

  // ── Computed ───────────────────────────────────────────────────────────────
  const activeId = computed(() => activeStrategy.value?.id ?? null);

  // Used by Dashboard.vue battery card
  const targetBufferSoc = computed(() => {
    if (!config.value?.nightlyProfile) return null;
    const profile = config.value.nightlyProfile;
    if (!profile.morningKwhNeeded) return null;
    const batteryCapacityKwh = config.value.batteryCapacityKwh ?? 11.2;
    return Math.ceil((profile.morningKwhNeeded / batteryCapacityKwh) * 100);
  });

  const formattedTargetBuffer = computed(() => {
    if (targetBufferSoc.value === null) return null;
    const kwh = config.value.nightlyProfile?.morningKwhNeeded;
    return kwh != null
      ? `${targetBufferSoc.value}% (${kwh.toFixed(1)} kWh)`
      : `${targetBufferSoc.value}%`;
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Safely parse a value that may arrive as a JSON string or already be the
   * correct type. Returns `fallback` if parsing fails or the type is wrong.
   *
   * This handles two backend serialisation quirks:
   *  - dayPlan  : stored as JSON TEXT in MySQL, arrives as a string
   *  - config   : double-serialised (JSON.stringify called on an already-string value)
   */
  function _safeParse(value, expectedType, fallback) {
    if (value === null || value === undefined) return fallback;
    // Already the correct type — return as-is
    if (expectedType === 'array'  && Array.isArray(value)) return value;
    if (expectedType === 'object' && typeof value === 'object' && !Array.isArray(value)) return value;
    // String — attempt JSON.parse
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (expectedType === 'array')  return Array.isArray(parsed) ? parsed : fallback;
        if (expectedType === 'object') return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : fallback;
        return parsed;
      } catch {
        console.warn('strategyStore._safeParse: invalid JSON, value starts with:', String(value).slice(0, 60));
        return fallback;
      }
    }
    return fallback;
  }

  async function fetchActive() {
    try {
      isLoading.value = true;
      error.value     = null;

      const res  = await apiClient.get('/strategies/active');
      const data = res.data;

      activeStrategy.value = data.strategy    ?? null;
      decision.value       = data.decision    ?? null;
      windowStart.value    = data.windowStart ?? null;
      windowHours.value    = data.windowHours ?? 24;
      lastUpdate.value     = new Date();

      // dayPlan arrives as a JSON string from MySQL TEXT column — parse to array
      dayPlan.value = _safeParse(data.dayPlan, 'array', []);

      // config may be double-serialised (stored as JSON string, serialised again
      // by Express) — parse until we have a plain object
      const rawConfig = data.strategy?.config ?? {};
      config.value    = _safeParse(rawConfig, 'object', {});

    } catch (e) {
      error.value = e.message;
      console.error('strategyStore.fetchActive failed:', e.message);
    } finally {
      isLoading.value = false;
    }
  }

  async function setStrategy(strategyId) {
    try {
      isLoading.value = true;
      await apiClient.post('/strategies/active', { strategyId });
      await fetchActive();
    } catch (e) {
      error.value = e.message;
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function saveConfig(configPatch) {
    try {
      const res = await apiClient.post('/strategies/config', configPatch);
      config.value = res.data?.config ?? { ...config.value, ...configPatch };
    } catch (e) {
      error.value = e.message;
      throw e;
    }
  }

  function startPolling(intervalMs = 60_000) {
    stopPolling();
    fetchActive();
    _pollTimer = setInterval(fetchActive, intervalMs);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  return {
    // state
    activeStrategy, decision, dayPlan, config,
    windowStart, windowHours,
    isLoading, lastUpdate, error,
    // computed
    activeId, targetBufferSoc, formattedTargetBuffer,
    // actions
    fetchActive, setStrategy, saveConfig, startPolling, stopPolling,
  };
});