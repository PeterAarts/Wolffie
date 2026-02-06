<template>
  <div class="login-container">
    <div class="login-card">
      <!-- Logo/Brand -->
      <div class="login-header">
        <img src="@/assets/woffie.svg" alt="Wolffie Logo" class="logo" />
        <div class="header-text">
          <h1>Wolffie</h1>
          <p>Smart Home Energy Management System for Online & Offline Power Control</p>
        </div>
      </div>

      <!-- Error Message -->
      <Message v-if="authStore.error" severity="error" :closable="false">
        {{ authStore.error }}
      </Message>

      <!-- Login Form -->
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

      <!-- Footer -->
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
    // Redirect to dashboard
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
  background: linear-gradient(15deg, #eeeef0 0%, #504f50 100%);
  padding: 1rem;
}

.login-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
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
  width: 80px;
  height: auto;
  flex-shrink: 0;
}

.login-header .header-text {
  flex: 1;
  text-align: left;
}

.login-header h1 {
  margin: 0 0 0.25rem 0;
  font-size: 2rem;
  font-weight: 700;
  color: #1e293b;
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
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
}

/* Ensure Password component spans full width */
.form-field :deep(.p-password) {
  width: 100%;
}

.form-field :deep(.p-password input) {
  width: 100%;
}

/* Ensure InputText spans full width */
.form-field :deep(.p-inputtext) {
  width: 100%;
}

.login-button {
  margin-top: 0.5rem;
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
}

.login-footer {
  margin-top: 2rem;
  text-align: center;
  color: #94a3b8;
  font-size: 0.8125rem;
}

/* Responsive */
@media (max-width: 480px) {
  .login-card {
    padding: 2rem 1.5rem;
  }
  
  .login-header {
    flex-direction: column;
    text-align: center;
  }

  .login-header .header-text {
    text-align: center;
  }
  
  .login-header h1 {
    font-size: 1.5rem;
  }

  .login-header .logo {
    width: 60px;
  }
}
</style>