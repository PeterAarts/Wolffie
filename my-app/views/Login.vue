<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <img src="@/assets/woffie.svg" alt="Wolffie Logo" class="logo" />
        <div class="header-text">
          <h1>Wolffie</h1>
          <p>Smart Home Energy Management System</p>
        </div>
      </div>

      <Message v-if="authStore.error" severity="error" :closable="false">
        {{ authStore.error }}
      </Message>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-field">
          <label for="username">Username</label>
          <InputText 
            id="username" 
            v-model="username" 
            placeholder="Enter your username"
            autocomplete="username"
            :disabled="authStore.loading"
          />
        </div>

        <div class="form-field">
          <label for="password">Password</label>
          <Password 
            id="password" 
            v-model="password" 
            placeholder="Enter your password"
            :feedback="false"
            toggleMask
            autocomplete="current-password"
            :disabled="authStore.loading"
          />
        </div>

        <Button 
          type="submit" 
          label="Sign In" 
          icon="pi pi-sign-in"
          :loading="authStore.loading"
          class="login-button"
        />
      </form>

      <div class="login-footer">
        <small>Secure access to your energy dashboard</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Message from 'primevue/message';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');

const handleLogin = async () => {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    router.push('/');
  }
};
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Changed from gradient to light gray */
  background-color: #f8fafc; 
  padding: 1rem;
}

.login-card {
  background: white;
  border-radius: 12px;
  /* Softened shadow for a cleaner look */
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  border: 1px solid #e2e8f0;
  padding: 3rem;
  width: 100%;
  max-width: 420px;
}

.login-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.login-header .logo {
  width: 70px;
  height: auto;
  filter: grayscale(100%); /* Force logo to monochrome */
  opacity: 0.8;
}

.login-header h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.025em;
}

.login-header p {
  margin: 0;
  color: #64748b;
  font-size: 0.875rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field label {
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: #475569;
}

/* Monochrome Input Styles */
:deep(.p-inputtext) {
  border-color: #cbd5e1;
}

:deep(.p-inputtext:enabled:focus) {
  border-color: #0f172a;
  box-shadow: 0 0 0 1px #0f172a;
}

/* Monochrome Button */
.login-button {
  margin-top: 0.5rem;
  width: 100%;
  padding: 0.75rem;
  background: #0f172a !important; /* Solid dark/black */
  border: 1px solid #0f172a !important;
  color: white !important;
  transition: background-color 0.2s;
}

.login-button:enabled:hover {
  background: #334155 !important;
  border-color: #334155 !important;
}

/* Ensure Password component spans full width */
.form-field :deep(.p-password),
.form-field :deep(.p-password input) {
  width: 100%;
}

.login-footer {
  margin-top: 2rem;
  text-align: center;
  color: #94a3b8;
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .login-card {
    padding: 2rem 1.5rem;
    border: none;
    box-shadow: none;
    background: transparent;
  }
  .login-container {
    background-color: #ffffff;
  }
}
</style>