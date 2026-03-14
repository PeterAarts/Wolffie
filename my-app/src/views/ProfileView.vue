<template>
  <div class="page-view">
    <header class="page-header">
      <h1 class="page-title">{{ t('profile.title') }}</h1>
      <p class="page-subtitle">{{ t('profile.subtitle') }}</p>
    </header>

    <div class="profile-card">
      <!-- Read-only account info -->
      <div class="drawer-meta-section">
        <div class="meta-grid">
          <div class="meta-card">
            <label>{{ t('settings.users.name') }}</label>
            <div class="meta-value">{{ authStore.user?.username }}</div>
          </div>
          <div class="meta-card">
            <label>{{ t('settings.users.role') }}</label>
            <div class="meta-value">{{ authStore.user?.role }}</div>
          </div>
          <div class="meta-card">
            <label>{{ t('settings.users.email') }}</label>
            <div class="meta-value">{{ authStore.user?.email || '—' }}</div>
          </div>
        </div>
      </div>

      <div class="drawer-divider" />

      <div class="drawer-section">
        <div class="drawer-section__title mt-4">{{ t('profile.changePassword') }}</div>

        <div class="form-field">
          <label class="form-label">{{ t('profile.currentPassword') }} <span class="req">*</span></label>
          <input v-model="form.oldPassword" type="password" class="input" autocomplete="current-password" />
        </div>

        <div class="form-field">
          <label class="form-label">{{ t('profile.newPassword') }} <span class="req">*</span></label>
          <input v-model="form.newPassword" type="password" class="input" autocomplete="new-password" />
        </div>

        <div class="form-field">
          <label class="form-label">{{ t('profile.confirmPassword') }} <span class="req">*</span></label>
          <input v-model="form.confirmPassword" type="password" class="input" autocomplete="new-password" />
          <span v-if="mismatch" class="field-error">{{ t('profile.passwordMismatch') }}</span>
        </div>

        <div class="form-actions">
          <button class="btn btn--primary" :class="{ 'btn--busy': saving }" :disabled="saving || mismatch" @click="save">
            {{ t('profile.savePassword') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const { t } = useI18n();
const authStore = useAuthStore();
const toast = useToastStore();

const saving = ref(false);
const form = ref({ oldPassword: '', newPassword: '', confirmPassword: '' });

const mismatch = computed(() =>
  form.value.confirmPassword.length > 0 &&
  form.value.newPassword !== form.value.confirmPassword
);

async function save() {
  if (mismatch.value || !form.value.oldPassword || !form.value.newPassword) return;
  saving.value = true;
  try {
    const ok = await authStore.changePassword(form.value.oldPassword, form.value.newPassword);
    if (ok) {
      toast.add({ severity: 'success', summary: t('common.success'), detail: t('profile.passwordChanged') });
      // authStore.changePassword already calls logout() — user will be redirected to login
    } else {
      toast.add({ severity: 'error', summary: t('common.error'), detail: authStore.error });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.profile-card   { max-width: 560px; }
.form-actions   { margin-top: 1.25rem; }
.field-error    { font-size: 0.72rem; color: #ef4444; margin-top: 0.25rem; display: block; }
.req            { color: #ef4444; margin-left: 2px; }
</style>