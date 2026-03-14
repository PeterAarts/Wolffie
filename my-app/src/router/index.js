// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

import MainLayout  from '../layouts/MainLayout.vue';
import Dashboard   from '../views/Dashboard.vue';
import Analytics   from '../views/Analytics.vue';
import History     from '../views/History.vue';
import Control     from '../views/Control.vue';
import Settings    from '../views/Settings.vue';
import Events      from '../views/Events.vue';
import SetupWizard from '../views/SetupWizard.vue';
import Login       from '../views/Login.vue';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresAuth: false, hideForAuth: true }
  },
  {
    path: '/setupwizard',
    name: 'SetupWizard',
    component: SetupWizard,
    meta: { requiresAuth: true }
  },
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      { path: '',          name: 'Dashboard', component: Dashboard },
      { path: 'analytics', name: 'Analytics', component: Analytics },
      { path: 'history',   name: 'History',   component: History   },
      { path: 'control',   name: 'Control',   component: Control   },
      { path: 'settings',  name: 'Settings',  component: Settings,  meta: { requiresAdmin: true } },
      { path: 'events',    name: 'Events',    component: Events    }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();

  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    next({ name: 'Dashboard' });
    return;
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'Login' });
    return;
  }

  // Settings (and any future admin-only routes) redirect non-admins to dashboard
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next({ name: 'Dashboard' });
    return;
  }

  next();
});

export default router;