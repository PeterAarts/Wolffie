<template>
  <div class="collector-status mt-4">

    <!-- Header -->
    <div class="status-header">
      <div class="header-left">
        <h2>Module Data Collectors</h2>
        <span class="manager-badge" :class="managerRunning ? 'badge--ok' : 'badge--err'">
          {{ managerRunning ? 'Running' : 'Stopped' }}
        </span>
      </div>
      <div class="header-right">
        <span class="last-refresh">Updated {{ lastRefreshLabel }}</span>
        <button class="btn-icon" :class="{ spinning: loading }" @click="load" title="Refresh">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="error-banner">
      <i class="fa-solid fa-triangle-exclamation"></i> {{ error }}
    </div>

    <!-- Skeleton while loading for the first time -->
    <template v-if="loading && collectors.length === 0">
      <div v-for="n in 3" :key="n" class="collector-row skeleton">
        <div class="skel-block skel-name"></div>
        <div class="skel-block skel-meta"></div>
      </div>
    </template>

    <!-- Collector rows -->
    <template v-else>
      <div
        v-for="c in collectors"
        :key="c.id"
        class="collector-row"
        :class="rowClass(c)"
      >
        <!-- Status dot + name -->
        <div class="col-identity">
          <span class="status-dot" :class="dotClass(c)" :title="dotLabel(c)"></span>
          <div class="identity-text">
            <span class="collector-name">{{ c.name }}</span>
            <span class="collector-id">{{ c.id }}</span>
          </div>
        </div>

        <!-- Last collected -->
        <div class="col-last">
          <span class="meta-label">Last collected</span>
          <span class="meta-value" :class="{ stale: isStale(c) }">
            {{ formatLastRun(c) }}
          </span>
        </div>

        <!-- Next run -->
        <div class="col-next">
          <span class="meta-label">Next run</span>
          <span class="meta-value">{{ formatNextRun(c) }}</span>
        </div>

        <!-- Interval -->
        <div class="col-interval">
          <span class="meta-label">Interval</span>
          <span class="meta-value">{{ formatInterval(c.intervalMs) }}</span>
        </div>

        <!-- Errors -->
        <div class="col-errors">
          <span v-if="c.consecutiveErrors > 0" class="error-count" :title="c.lastError ?? ''">
            <i class="fa-solid fa-circle-exclamation"></i>
            {{ c.consecutiveErrors }} error{{ c.consecutiveErrors > 1 ? 's' : '' }}
          </span>
          <span v-else class="no-errors">—</span>
        </div>

        <!-- Actions -->
        <div class="col-actions">
          <button
            v-if="c.paused || !isEnabled(c)"
            class="btn-restart"
            :disabled="restarting === c.id"
            @click="restart(c.id)"
            title="Restart collector"
          >
            <i class="fa-solid fa-play"></i>
            {{ restarting === c.id ? 'Starting…' : 'Restart' }}
          </button>
          <span v-else class="status-ok">
            <i class="fa-solid fa-check"></i>
          </span>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="collectors.length === 0" class="empty-state">
        No collectors registered
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import apiClient from '@/services/api.js';

// ── Config ──────────────────────────────────────────────────────────────────

const POLL_MS = 15_000; // auto-refresh every 15 s

// ── State ────────────────────────────────────────────────────────────────────

const collectors    = ref([]);
const managerRunning = ref(false);
const loading       = ref(false);
const error         = ref(null);
const lastRefresh   = ref(null);
const restarting    = ref(null);
let   pollTimer     = null;

// ── Data loading ──────────────────────────────────────────────────────────────

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const response = await apiClient.get('/collectors/status');
    // Handle both unwrapped and wrapped responses
    const data = response.collectors ? response : response.data;
    collectors.value     = data.collectors ?? [];
    managerRunning.value = data.running    ?? false;
    lastRefresh.value    = new Date();
  } catch (e) {
    error.value = e?.response?.data?.error ?? e.message ?? 'Failed to load collector status';
  } finally {
    loading.value = false;
  }
}

async function restart(id) {
  restarting.value = id;
  try {
    await apiClient.post(`/collectors/${id}/restart`);
    await load();
  } catch (e) {
    error.value = `Restart failed: ${e?.response?.data?.error ?? e.message}`;
  } finally {
    restarting.value = null;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await load();
  pollTimer = setInterval(load, POLL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

// ── Computed helpers ──────────────────────────────────────────────────────────

const lastRefreshLabel = computed(() => {
  if (!lastRefresh.value) return '—';
  return lastRefresh.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
});

// ── Formatting ────────────────────────────────────────────────────────────────

function isEnabled(c) {
  return c.enabled === true || c.enabled === 'true' || c.enabled === 1 || c.enabled === '1';
}

function formatLastRun(c) {
  const ts = c.lastRun;
  if (!ts) return 'Never';
  const d = new Date(ts);
  const ago = Math.round((Date.now() - d) / 1000);
  if (ago < 60)  return `${ago}s ago`;
  if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(c) {
  if (!isEnabled(c) || c.paused) return '—';
  if (!c.nextRun) return '—';
  const d = new Date(c.nextRun);
  const ms = d - Date.now();
  if (ms <= 0) return 'now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function formatInterval(ms) {
  if (!ms) return '—';
  if (ms < 60_000) return `${ms / 1000}s`;
  return `${ms / 60_000}m`;
}

// ── Status logic ──────────────────────────────────────────────────────────────

function isStale(c) {
  const ts = c.lastRun;
  if (!ts || !c.intervalMs) return false;
  // Stale = no update in > 3× the expected interval
  return (Date.now() - new Date(ts)) > c.intervalMs * 3;
}

function dotClass(c) {
  if (!isEnabled(c))        return 'dot--disabled';
  if (c.paused)             return 'dot--paused';
  if (c.consecutiveErrors)  return 'dot--error';
  if (isStale(c))           return 'dot--stale';
  return 'dot--ok';
}

function dotLabel(c) {
  if (!isEnabled(c))  return 'Disabled';
  if (c.paused)    return `Paused after ${c.consecutiveErrors} errors`;
  if (c.consecutiveErrors) return `${c.consecutiveErrors} consecutive error(s)`;
  if (isStale(c))  return 'No recent data';
  return 'Healthy';
}

function rowClass(c) {
  if (c.paused)                return 'row--paused';
  if (c.consecutiveErrors > 0) return 'row--error';
  if (!isEnabled(c))           return 'row--disabled';
  return '';
}
</script>

<style scoped>
/* ── Container ──────────────────────────────────────────────────────────────── */
.collector-status {
  background: #fff;
  overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────────────────  */
.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-header h2 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #1e293b;
}

.manager-badge {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.2rem 0.55rem;
  border-radius: 20px;
}

.badge--ok  { background: #f0fdf4; color: #16a34a; }
.badge--err { background: #fef2f2; color: #dc2626; }

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.last-refresh {
  font-size: 0.75rem;
  color: #94a3b8;
}

.btn-icon {
  border: none;
  background: none;
  color: #64748b;
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem;
  border-radius: 4px;
  transition: color 0.15s;
}
.btn-icon:hover { color: #1e293b; }
.btn-icon.spinning i {
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error banner ────────────────────────────────────────────────────────────  */
.error-banner {
  padding: 0.75rem 1.25rem;
  font-size: 0.8125rem;
  color: #b91c1c;
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
}

/* ── Collector row ───────────────────────────────────────────────────────────  */
.collector-row {
  display: grid;
  grid-template-columns: 2fr 1.5fr 1fr 0.75fr 1fr 0.75fr;
  align-items: center;
  gap: 0;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.1s;
}
.collector-row:last-child { border-bottom: none; }
.collector-row:hover { background: #dbdcdd; }

.row--paused   { background: #fffbeb; }
.row--error    { background: #fff7f7; }
.row--disabled { opacity: 0.5; }

/* ── Identity column ─────────────────────────────────────────────────────────  */
.col-identity {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot--ok       { background: #22c55e; }
.dot--error    { background: #ef4444; }
.dot--paused   { background: #f59e0b; }
.dot--stale    { background: #94a3b8; }
.dot--disabled { background: #cbd5e1; }

.identity-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.collector-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1e293b;
  line-height: 1.2;
}

.collector-id {
  font-size: 0.6875rem;
  color: #94a3b8;
  font-family: 'Courier New', monospace;
}

/* ── Meta columns ────────────────────────────────────────────────────────────  */
.col-last,
.col-next,
.col-interval,
.col-errors,
.col-actions {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.meta-label {
  font-size: 0.6875rem;
  color: #94a3b8;
  text-transform: lowercase;
  letter-spacing: 0.04em;
}

.meta-value {
  font-size: 0.8125rem;
  color: #334155;
  font-weight: 500;
}

.meta-value.stale { color: #94a3b8; }

/* ── Error count ─────────────────────────────────────────────────────────────  */
.error-count {
  font-size: 0.75rem;
  color: #ef4444;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: default;
}

.no-errors { color: #cbd5e1; font-size: 0.75rem; }

/* ── Action column ───────────────────────────────────────────────────────────  */
.btn-restart {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: #1e293b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  width: fit-content;
}
.btn-restart:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #cbd5e1;
}
.btn-restart:disabled { opacity: 0.5; cursor: default; }

.status-ok {
  color: #22c55e;
  font-size: 0.8125rem;
}

/* ── Skeleton ────────────────────────────────────────────────────────────────  */
.skeleton {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
}

.skel-block {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

.skel-name { width: 140px; }
.skel-meta { width: 200px; }

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Empty state ─────────────────────────────────────────────────────────────  */
.empty-state {
  padding: 2rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.875rem;
}

/* ── Responsive ──────────────────────────────────────────────────────────────  */
@media (max-width: 768px) {
  .collector-row {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 0.5rem;
  }
  .col-next, .col-interval { display: none; }
}
</style>