<!-- src/components/control/StrategyPanel.vue -->
<template>
  <div class="strategy-panel">

    <!-- Strategy option grid -->
    <div class="strategy-grid">
      <button
        v-for="s in strategies"
        :key="s.id"
        class="strategy-card bg-gray-50"
        :class="{ 'strategy-card--active': activeId === s.id }"
        :disabled="saving"
        @click="select(s.id)"
      >
        <div class="strategy-card__top-bar" />
        <div class="strategy-card__name">{{ s.name }}</div>
        <div class="strategy-card__desc">{{ s.desc }}</div>
        <span v-if="activeId === s.id" class="strategy-card__badge">{{ t('control.active') }}</span>
      </button>
    </div>

    <!-- Quick dispatch actions row -->
    <div class="quick-actions">
      <span class="quick-actions__label">{{ t('control.quickActions') }}</span>
      <div class="quick-actions__row">
        <button
          class="btn btn--sm"
          :class="{ 'btn--busy': acting === 'normal' }"
          :disabled="!!acting"
          @click="act('normal')"
        >
          {{ t('control.normal') }}
        </button>
        <button
          class="btn btn--sm"
          :class="{ 'btn--busy': acting === 'prevent' }"
          :disabled="!!acting"
          @click="act('prevent')"
        >
          {{ t('control.preventDischarge') }}
        </button>
        <button
          class="btn btn--sm btn--destructive"
          :class="{ 'btn--busy': acting === 'stop' }"
          :disabled="!!acting"
          @click="act('stop')"
        >
          {{ t('control.stopDispatch') }}
        </button>
      </div>
    </div>

    <!-- ── Today's day-ahead prices + solar forecast chart ──────────────────── -->
    <DayAheadChart />

    <!-- Strategy-specific settings form (shown when a strategy needs config) -->
    <div v-if="selectedStrategy" class="strategy-settings-form">
      <h3>{{ selectedStrategy.label }} Settings</h3>

      <div v-for="field in selectedStrategy.fields" :key="field.key">
        <UniversalField
          v-model="tempSettings[field.key]"
          :label="field.label"
          :type="field.type"
        />
      </div>

      <div class="form-actions">
        <button @click="cancel">Cancel</button>
        <button class="primary" @click="saveSettings">Save Strategy</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import { useLocale } from '@/composables/useLocale';
import DayAheadChart from '@/components/control/DayAheadChart.vue';

const toast = useToastStore();
const { t } = useLocale();

const saving   = ref(false);
const acting   = ref('');
const activeId = ref('smart_eco');

const strategies = [
  { id: 'smart_eco',       name: t('control.strategy.smartEco.name'),       desc: t('control.strategy.smartEco.desc') },
  { id: 'self_sufficient', name: t('control.strategy.selfSufficient.name'),  desc: t('control.strategy.selfSufficient.desc') },
  { id: 'peak_shaving',    name: t('control.strategy.peakShaving.name'),     desc: t('control.strategy.peakShaving.desc') },
  { id: 'manual',          name: t('control.strategy.manual.name'),          desc: t('control.strategy.manual.desc') },
];

async function select(id) {
  if (id === activeId.value || saving.value) return;
  saving.value = true;
  try {
    // await apiClient.post('/system/strategy', { strategy: id });
    activeId.value = id;
    toast.add({ severity: 'success', summary: t('control.strategyUpdated'), detail: strategies.find(s => s.id === id)?.name });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
  } finally {
    saving.value = false;
  }
}

async function act(action) {
  const map = {
    normal  : { url: '/alphaess/normal',            msg: t('control.normalRestored') },
    prevent : { url: '/alphaess/prevent-discharge', msg: t('control.dischargeBlocked') },
    stop    : { url: '/alphaess/stop',              msg: t('control.dispatchStopped') },
  };
  acting.value = action;
  try {
    await apiClient.post(map[action].url);
    toast.add({ severity: 'success', summary: t('common.done'), detail: map[action].msg });
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
  } finally {
    acting.value = '';
  }
}
</script>

<style scoped>
.strategy-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* ── Strategy grid ───────────────────────────────────────────────────────── */
.strategy-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

@media (min-width: 900px) {
  .strategy-grid { grid-template-columns: repeat(4, 1fr); }
}

.strategy-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.375rem;
  padding: 1rem;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
  overflow: hidden;
}

.strategy-card:hover:not(:disabled) {
  border-color: #9ca3af;
  background: #f3f4f6;
}

.strategy-card--active { border-color: #828283; }

.strategy-card:disabled { opacity: 0.5; cursor: not-allowed; }

.strategy-card__top-bar {
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 4px;
  background: transparent;
  transition: background 0.15s;
}
.strategy-card--active .strategy-card__top-bar { background: #6c6c6d; }

.strategy-card__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
}

.strategy-card__desc {
  font-size: 0.775rem;
  color: #6b7280;
  line-height: 1.4;
}

.strategy-card__badge {
  margin-top: 0.25rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #374151;
  background: #e5e7eb;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
}

/* ── Quick actions ────────────────────────────────────────────────────────── */
.quick-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-top: 0.875rem;
  border-top: 1px solid #f3f4f6;
}

.quick-actions__label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #9ca3af;
  white-space: nowrap;
}

.quick-actions__row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* ── Buttons ──────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4375rem 0.875rem;
  background: #fff;
  border: 1px solid var(--color-gray-200);
  border-radius: 0px;
  color: #374151;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover:not(:disabled) { background: #f9fafb; border-color: #9ca3af; }
.btn:disabled              { opacity: 0.5; cursor: not-allowed; }

.btn--sm { padding: 0.3125rem 0.625rem; font-size: 0.78125rem; }

.btn--destructive {
  color: #991b1b;
  border-color: #fca5a5;
  background: #fef2f2;
}
.btn--destructive:hover:not(:disabled) {
  background: #fee2e2;
  border-color: #f87171;
}

.btn--busy { opacity: 0.6; pointer-events: none; }
</style>