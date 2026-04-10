<!-- src/components/control/DispatchPanel.vue -->
<template>
  <div class="dispatch-panel">

    <!-- Active dispatch status bar -->
    <div v-if="status.active" class="status-bar">
      <span class="status-bar__dot" />
      <span class="status-bar__text">
        {{ status.charging ? t('control.chargingActive') : t('control.dischargingActive') }}
        &mdash; {{ status.watts }} W
        <span v-if="status.startedAt"> &mdash; {{ status.startedAt }}</span>
        <span v-if="remaining"> &mdash; {{ remaining }}</span>
      </span>
      <button
        class="btn btn--sm btn--destructive"
        :class="{ 'btn--busy': stopping }"
        @click="doStop"
      >
        {{ t('control.stop') }}
      </button>
    </div>

    <!-- Charge / Discharge side-by-side -->
    <div class="dispatch-grid">

      <!-- Charge from Grid -->
      <div class="dcard bg-secondary-100">
        <div class="dcard__header mb-8">
          <div class="dcard__title">{{ t('control.chargeFromGrid') }}</div>
          <div class="dcard__sub">{{ t('control.chargeFromGridDesc') }}</div>
        </div>

        <div class="fields">
          <SliderField
            :label="t('control.power')"
            :display="`${charge.watts} W`"
            v-model="charge.watts"
            :min="500" :max="10000" :step="100"
            hint-min="500 W" hint-max="10000 W"
          />
          <SliderField
            :label="t('control.targetSOC')"
            :display="`${charge.targetSOC}%`"
            v-model="charge.targetSOC"
            :min="20" :max="98" :step="5"
            hint-min="20%" hint-max="98%"
          />
          <SliderField
            :label="t('control.duration')"
            :display="`${charge.durationHours} ${t('control.hours')}`"
            v-model="charge.durationHours"
            :min="0.5" :max="12" :step="0.5"
            :hint-min="`0.5 ${t('control.hours')}`"
            :hint-max="`12 ${t('control.hours')}`"
          />
        </div>

        <div class="dcard__summary mb-6">
          {{ charge.watts }} W → {{ charge.targetSOC }}% &mdash; {{ charge.durationHours }} {{ t('control.hours') }}
        </div>

        <button
          class="btn btn--primary btn--full"
          :class="{ 'btn--busy': charging }"
          @click="doCharge"
        >
          {{ t('control.startCharging') }}
        </button>
      </div>

      <!-- Discharge to Grid -->
      <div class="dcard bg-secondary-100">
        <div class="dcard__header mb-8">
          <div class="dcard__title">{{ t('control.dischargeToGrid') }}</div>
          <div class="dcard__sub">{{ t('control.dischargeToGridDesc') }}</div>
        </div>

        <div class="fields">
          <SliderField
            :label="t('control.power')"
            :display="`${discharge.watts} W`"
            v-model="discharge.watts"
            :min="500" :max="10000" :step="100"
            hint-min="500 W" hint-max="10000 W"
          />
          <SliderField
            :label="t('control.minimumSOC')"
            :display="`${discharge.minimumSOC}%`"
            v-model="discharge.minimumSOC"
            :min="5" :max="95" :step="5"
            hint-min="5%" hint-max="95%"
          />
          <SliderField
            :label="t('control.duration')"
            :display="`${discharge.durationHours} ${t('control.hours')}`"
            v-model="discharge.durationHours"
            :min="0.5" :max="12" :step="0.5"
            :hint-min="`0.5 ${t('control.hours')}`"
            :hint-max="`12 ${t('control.hours')}`"
          />
        </div>

        <div class="dcard__summary mb-6">
          {{ discharge.watts }} W, min {{ discharge.minimumSOC }}% &mdash; {{ discharge.durationHours }} {{ t('control.hours') }}
        </div>

        <button
          class="btn btn--primary btn--full"
          :class="{ 'btn--busy': discharging }"
          @click="doDischarge"
        >
          {{ t('control.startDischarging') }}
        </button>
      </div>

    </div>

    <!-- Confirm modal -->
    <AppModal
      v-model:visible="confirm.visible"
      :message="confirm.message"
      @confirm="runConfirm"
    />

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import apiClient from '@/services/api';
import { useToastStore } from '@/stores/toast';
import { useLocale } from '@/composables/useLocale';

import AppModal    from '@/components/common/AppModal.vue';
import SliderField from '@/components/common/SliderField.vue';

import '@/assets/styles/control.css';

const toast = useToastStore();
const { t } = useLocale();

const charging    = ref(false);
const discharging = ref(false);
const stopping    = ref(false);

// startedAt is persisted in localStorage so it survives logout/login cycles.
// It is keyed to 'wolffie_dispatch_startedAt' and cleared as soon as the
// backend reports no active dispatch.
const STORAGE_KEY  = 'wolffie_dispatch_startedAt';
const startedAt    = ref(localStorage.getItem(STORAGE_KEY) || null);

function setStartedAt() {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  startedAt.value = t;
  localStorage.setItem(STORAGE_KEY, t);
}

function clearStartedAt() {
  startedAt.value = null;
  localStorage.removeItem(STORAGE_KEY);
}

const status = ref({ active: false, charging: false, discharging: false, watts: 0, remainingSeconds: 0, startedAt: null });

const charge    = ref({ watts: 2000, targetSOC: 100,  durationHours: 4 });
const discharge = ref({ watts: 2000, minimumSOC: 20,  durationHours: 2 });

const confirm = ref({ visible: false, message: '', cb: null });

const remaining = computed(() => {
  const s = status.value.remainingSeconds || 0;
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}u ${m}m` : `${m}m`;
});

function ask(message, cb) {
  confirm.value = { visible: true, message, cb };
}

function runConfirm() {
  confirm.value.visible = false;
  confirm.value.cb?.();
}

async function doCharge() {
  const { watts, targetSOC, durationHours } = charge.value;
  ask(t('control.confirmCharge', { watts, targetSOC, durationHours }), async () => {
    charging.value = true;
    try {
      await apiClient.post('/alphaess-modbus-tcp/charge', { watts, targetSOC, durationHours });
      setStartedAt();
      toast.add({ severity: 'success', summary: t('control.chargingStarted'), detail: `${watts} W → ${targetSOC}%` });
      await loadStatus();
    } catch (e) {
      toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
    } finally {
      charging.value = false;
    }
  });
}

async function doDischarge() {
  const { watts, minimumSOC, durationHours } = discharge.value;
  ask(t('control.confirmDischarge', { watts, minimumSOC, durationHours }), async () => {
    discharging.value = true;
    try {
      await apiClient.post('/alphaess-modbus-tcp/discharge', { watts, minimumSOC, durationHours });
      setStartedAt();
      toast.add({ severity: 'success', summary: t('control.dischargingStarted'), detail: `${watts} W, min ${minimumSOC}%` });
      await loadStatus();
    } catch (e) {
      toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
    } finally {
      discharging.value = false;
    }
  });
}

async function doStop() {
  stopping.value = true;
  try {
    await apiClient.post('/alphaess-modbus-tcp/stop');
    clearStartedAt();
    toast.add({ severity: 'success', summary: t('control.dispatchStopped') });
    await loadStatus();
  } catch (e) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: e.response?.data?.error || e.message });
  } finally {
    stopping.value = false;
  }
}

async function loadStatus() {
  try {
    // apiClient interceptor unwraps response.data, so the result is the
    // payload directly — not { data: payload }. Destructuring as { data }
    // would give undefined; receive it directly instead.
    const payload = await apiClient.get('/alphaess-modbus-tcp/dispatch-status');
    const d = payload?.data ?? payload;   // handle both wrapped and unwrapped
    status.value = {
      active:           d.active      || false,
      charging:         d.charging    || false,
      discharging:      d.discharging || false,
      watts:            d.watts       || 0,
      remainingSeconds: d.remainingSeconds || 0,
      startedAt:        (d.active && startedAt.value) ? startedAt.value : null,
    };
    if (!d.active) clearStartedAt();
  } catch { /* not critical */ }
}

// Poll every 30 s so remaining time and startedAt stay current after login
let pollTimer = null;

onMounted(() => {
  loadStatus();
  pollTimer = setInterval(loadStatus, 30_000);
});

onUnmounted(() => {
  clearInterval(pollTimer);
});
</script>

<style scoped>
.dispatch-panel         { display: flex; flex-direction: column; gap: 1rem; }

/* ── Status bar ──────────────────────────────────────────────────────────── */
.status-bar             { display: flex; align-items: center; gap: 0.75rem;padding: 0.625rem 0.875rem; background: #f9fafb; border: 1px solid #e5e7eb;}
.status-bar__dot        { width: 14px; height: 14px;border-radius: 50%;background: var(--color-primary);flex-shrink: 0;animation: pulse 3s infinite;}
.range::-webkit-slider-thumb 
                        { border-radius: 0%!important;background-color: var(--color-primary);}
.range                  { border-radius: var(--radius-md);}                        

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .1; }
}

.status-bar__text       { flex: 1;font-size: 0.8125rem;color: var(--color-secondary-700);font-weight: 500;}

/* ── Two-column card grid ─────────────────────────────────────────────────── */
.dispatch-grid          { display: grid;grid-template-columns: 1fr 1fr 1fr;gap: 0.75rem;}

@media (max-width: 720px) {
  .dispatch-grid { grid-template-columns: 1fr; }
}

/* ── Individual card ──────────────────────────────────────────────────────── */
.dcard                  { display: flex;flex-direction: column;gap: 1rem;padding: 1.25rem;border-radius: var(--radius-lg);}

.dcard__header          { display: flex; flex-direction: column; gap: 0.25rem; }
.dcard__title           { font-size: 0.875rem; font-weight: 600; color: #111827; }
.dcard__sub             { font-size: 0.775rem; color: #6b7280; }

.fields                 { display: flex; flex-direction: column; gap: 0.875rem; }

/* ── Summary line ─────────────────────────────────────────────────────────── */
.dcard__summary         { font-size: 0.775rem;color: #6b7280;background: #fff;padding: 0.5rem 0.75rem;border-radius: 4px;}
</style>