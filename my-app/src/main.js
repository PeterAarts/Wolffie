// src/main.js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useSchemaStore } from '@/stores/schema';
import router from './router';
import { registerSW } from 'virtual:pwa-register'
import './assets/styles/main.css';
import i18n from './i18n';     

registerSW({ immediate: true })
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(i18n);

import { useAuthStore } from './stores/auth';
const authStore = useAuthStore();
const schemaStore = useSchemaStore();

authStore.initialize().then(() => {
  app.use(router);
  schemaStore.initialize();
  app.mount('#app');
});