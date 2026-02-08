// src/main.js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';

// Importeer de componenten die ontbraken
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputSwitch from 'primevue/inputswitch';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import Slider from 'primevue/slider';
import InputNumber from 'primevue/inputnumber';
import Divider from 'primevue/divider';
import Tooltip from 'primevue/tooltip';

import App from './App.vue';
import router from './router';

import 'primeicons/primeicons.css';
import './assets/styles/main.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: 'system',
      cssLayer: false
    }
  }
});

app.use(ToastService);
app.use(ConfirmationService);

// Registreer de componenten globaal
app.component('Card', Card);
app.component('Button', Button);
app.component('InputSwitch', InputSwitch);
app.component('Tag', Tag);
app.component('Message', Message);
app.component('Slider', Slider);
app.component('InputNumber', InputNumber);
app.component('Divider', Divider);

// Registreer de Tooltip directive
app.directive('tooltip', Tooltip);

app.mount('#app');