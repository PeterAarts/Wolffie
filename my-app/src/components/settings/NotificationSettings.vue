<template>
  <div class="notification-settings">

    <div class="notif-section">
      <label class="notif-label">{{ t('settings.notifications.push') }}</label>

      <div v-if="!supported" class="notif-unsupported">
        <i class="ph-light ph-warning"></i>
        {{ t('settings.notifications.unsupported') }}
      </div>

      <div v-else-if="permission === 'denied'" class="notif-denied">
        <i class="ph-light ph-bell-slash"></i>
        {{ t('settings.notifications.denied') }}
      </div>

      <div v-else class="notif-toggle-row">
        <div class="notif-status">
          <i :class="subscribed ? 'ph-light ph-bell-ringing' : 'ph-light ph-bell'"></i>
          <span>{{ subscribed ? t('settings.notifications.enabled') : t('settings.notifications.disabled') }}</span>
        </div>
        <button
          class="btn-toggle"
          :class="{ 'btn-toggle--active': subscribed }"
          :disabled="busy"
          @click="subscribed ? disablePush() : enablePush()"
        >
          <i v-if="busy" class="ph-light ph-circle-notch spin"></i>
          <span v-else>{{ subscribed ? t('settings.notifications.disable') : t('settings.notifications.enable') }}</span>
        </button>
      </div>

      <p class="notif-hint">{{ t('settings.notifications.hint') }}</p>

      <div v-if="errorMsg" class="notif-error">{{ errorMsg }}</div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';

const { t } = useI18n();

const supported  = ref(false);
const permission = ref('default');
const subscribed = ref(false);
const busy        = ref(false);
const errorMsg    = ref('');

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function checkState() {
  supported.value = 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported.value) return;

  permission.value = Notification.permission;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  subscribed.value = !!existing;
}

async function enablePush() {
  errorMsg.value = '';
  busy.value = true;
  try {
    const perm = await Notification.requestPermission();
    permission.value = perm;
    if (perm !== 'granted') return;

    const { data } = await apiClient.get('/push/vapid-public-key');
    const registration = await navigator.serviceWorker.ready;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });

    await apiClient.post('/push/subscribe', {
      subscription: subscription.toJSON(),
      label: navigator.userAgent.slice(0, 100),
    });

    subscribed.value = true;
  } catch (err) {
    errorMsg.value = err.response?.data?.error || err.message;
    console.error('Push subscribe failed', err);
  } finally {
    busy.value = false;
  }
}

async function disablePush() {
  errorMsg.value = '';
  busy.value = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await apiClient.delete('/push/subscribe', { data: { endpoint: subscription.endpoint } });
      await subscription.unsubscribe();
    }
    subscribed.value = false;
  } catch (err) {
    errorMsg.value = err.response?.data?.error || err.message;
    console.error('Push unsubscribe failed', err);
  } finally {
    busy.value = false;
  }
}

onMounted(checkState);
</script>

<style scoped>
.notif-section {
  padding: 1.25rem 0 1rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
}

.notif-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: lowercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin-bottom: 0.75rem;
}

.notif-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.notif-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.btn-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.375rem 0.875rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text-primary);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.btn-toggle:hover     { border-color: var(--color-border-dark); }
.btn-toggle:disabled  { opacity: 0.6; cursor: default; }

.btn-toggle--active {
  color: #dc2626;
  border-color: #fecaca;
}
.btn-toggle--active:hover { background: var(--color-background); border-color: #fca5a5; }

.notif-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.5rem;
}

.notif-unsupported,
.notif-denied {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.notif-error {
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #dc2626;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>