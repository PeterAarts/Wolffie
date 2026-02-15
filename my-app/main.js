// src/main.js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { registerSW } from 'virtual:pwa-register'
import './assets/styles/main.css';
registerSW({ immediate: true })
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

import { useAuthStore } from './stores/auth';
const authStore = useAuthStore();

authStore.initialize().then(() => {
  app.use(router);
  app.mount('#app');
});