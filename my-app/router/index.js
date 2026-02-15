// src/router/index.js - CORRECTED FOR YOUR FOLDER STRUCTURE
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

// Layouts
import MainLayout from '../layouts/MainLayout.vue';

// Pages (YOUR folder uses 'views' not 'pages')
import Dashboard from '../views/Dashboard.vue';
import Analytics from '../views/Analytics.vue';
import History from '../views/History.vue';
import Control from '../views/Control.vue';
import Settings from '../views/Settings.vue';
import Events from '../views/Events.vue';
import SetupWizard from '../views/SetupWizard.vue';
import Login from '../views/Login.vue';  // ← You need to add this file
import CollectorFlow from '../views/CollectorFlow.vue';

const routes = [
  { path: '/login',           name: 'Login',          component: Login,meta: { requiresAuth: false,hideForAuth: true }},
  { path: '/setupwizard',     name: 'SetupWizard',    component: SetupWizard,meta: { requiresAuth: true }},
  { path: '/',component: MainLayout,meta: { requiresAuth: true },
    children: [
      { path: '',         name: 'Dashboard',  component: Dashboard},
      { path: 'analytics',name: 'Analytics',  component: Analytics},
      { path: 'history',  name: 'History',    component: History},
      { path: 'control',  name: 'Control',    component: Control},
      { path: 'settings', name: 'Settings',   component: Settings},
      { path: 'events',   name: 'Events',     component: Events}
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

// Navigation guard for authentication
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth) {
    // Check auth status from backend session
    if (!authStore.isAuthenticated) {
      try {
        // This endpoint checks session cookie (sent automatically!)
        const { data } = await api.get('/auth/status');
        
        if (data.authenticated) {
          // Session valid! Get new JWT
          const refreshData = await api.post('/auth/refresh');
          authStore.setAuth(refreshData.data);
          next();
          return;
        }
      } catch (error) {
        // No valid session
      }
    }
    
    if (!authStore.isAuthenticated) {
      next({ name: 'Login' });
      return;
    }
  }
  
  next();
});

export default router;