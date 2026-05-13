// src/stores/alerts.js
//
// Generic app-wide alert store.
// Polls GET /api/alerts (all sources) on a slow interval.
// Supports per-user dismissal — does not affect other users.
//
// Usage:
//   const alertStore = useAlertStore();
//   alertStore.startPolling();          // call from MainLayout onMounted
//   alertStore.alerts                   // reactive array
//   alertStore.dismissAlert(id)         // per-user dismiss

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '@/services/api';

export const useAlertStore = defineStore('alerts', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  const alerts    = ref([]);   // all active, non-dismissed alerts
  const loading   = ref(false);
  const lastFetch = ref(null);

  let _pollTimer = null;

  // ── Computed ───────────────────────────────────────────────────────────────

  // Alerts by source for targeted rendering
  const strategyAlerts = computed(() =>
    alerts.value.filter(a => a.source === 'strategy')
  );

  const curtailmentAlerts = computed(() =>
    alerts.value.filter(a => a.type?.startsWith('solar_curtailment_risk'))
  );

  const hasAlerts = computed(() => alerts.value.length > 0);

  const alertsBySeverity = computed(() => ({
    error:   alerts.value.filter(a => a.severity === 'error'),
    warning: alerts.value.filter(a => a.severity === 'warning'),
    info:    alerts.value.filter(a => a.severity === 'info'),
  }));

  // ── Actions ────────────────────────────────────────────────────────────────

  async function fetchAlerts() {
    try {
      loading.value = true;
      const res     = await apiClient.get('/alerts');
      alerts.value  = res.data?.alerts ?? [];
      lastFetch.value = new Date();
    } catch (e) {
      console.error('alertStore.fetchAlerts failed:', e.message);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Dismiss an alert for the current user only.
   * Optimistically removes from local state immediately.
   */
  async function dismissAlert(alertId) {
    // Optimistic remove — don't wait for server round-trip
    alerts.value = alerts.value.filter(a => a.id !== alertId);
    try {
      await apiClient.post(`/alerts/${alertId}/dismiss`);
    } catch (e) {
      console.error('alertStore.dismissAlert failed:', e.message);
      // Re-fetch to restore correct state if dismiss failed
      await fetchAlerts();
    }
  }

  /**
   * Globally resolve an alert (admin action — clears for all users).
   */
  async function resolveAlert(alertId) {
    alerts.value = alerts.value.filter(a => a.id !== alertId);
    try {
      await apiClient.post(`/alerts/${alertId}/resolve`);
    } catch (e) {
      console.error('alertStore.resolveAlert failed:', e.message);
      await fetchAlerts();
    }
  }

  function startPolling(intervalMs = 30 * 1000) {
    stopPolling();
    fetchAlerts();
    _pollTimer = setInterval(fetchAlerts, intervalMs);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  return {
    // state
    alerts, loading, lastFetch,
    // computed
    strategyAlerts, curtailmentAlerts, hasAlerts, alertsBySeverity,
    // actions
    fetchAlerts, dismissAlert, resolveAlert, startPolling, stopPolling,
  };
});