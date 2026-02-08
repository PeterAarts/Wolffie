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
  { path: '/login',name: 'Login',component: Login,meta: { requiresAuth: false,hideForAuth: true }},
  { path: '/collector-flow', name: 'CollectorFlow', component: CollectorFlow },
  { path: '/setupWizard',name: 'SetupWizard',component: SetupWizard,meta: { requiresAuth: true }},
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: Dashboard
      },
      {
        path: 'analytics',
        name: 'Analytics',
        component: Analytics
      },
      {
        path: 'history',
        name: 'History',
        component: History
      },
      {
        path: 'control',
        name: 'Control',
        component: Control
      },
      {
        path: 'settings',
        name: 'Settings',
        component: Settings
      },
      {
        path: 'events',
        name: 'Events',
        component: Events
      }
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

  // Check if route requires authentication
  if (to.meta.requiresAuth) {
    if (!authStore.isAuthenticated) {
      // Not authenticated, redirect to login
      console.log('🔒 Route requires auth, redirecting to login');
      next({ name: 'Login', query: { redirect: to.fullPath } });
      return;
    }
  }

  // If authenticated and trying to access login page
  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    console.log('✅ Already authenticated, redirecting to dashboard');
    next({ name: 'Dashboard' });
    return;
  }

  // Allow navigation
  next();
});

export default router;