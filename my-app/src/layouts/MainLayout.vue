<template>
  <div class="main-layout">
    <!-- Top Header - Mobile First -->
    <header class="app-header">
      <div class="header-left">
       <img src="@/assets/woffie.svg" alt="WattsOn Logo" class="logo-icon" />
        <span class="app-title">Wolffie</span>
        <div 
          class="" 
          :class="realtimeStore.isConnected ? 'status-live' : 'status-historical'"
        >
          <span class="status-dot"></span>          
          <div v-if="realtimeStore.isConnected" class="source-indicators">
            <i v-if="realtimeStore.connectionSource === 'cloud'" class="pi pi-cloud" title="Cloud API"></i>
            <i v-if="realtimeStore.connectionSource === 'modbus'" class="pi pi-server" title="Local ModBus"></i>
          </div>
        </div>
      </div>

      <div class="header-right">
        <!-- User Menu -->
        <div class="user-menu">
          <Button 
            :label="authStore.user?.username" 
            icon="pi pi-user" 
            @click="toggleUserMenu" 
            text 
            rounded
            class="user-button"
          />
          <div v-if="userMenuOpen" class="user-dropdown">
            <div class="user-info">
              <div class="user-name">{{ authStore.user?.username }}</div>
              <div class="user-role">{{ authStore.user?.role }}</div>
            </div>
            <div class="user-menu-divider"></div>
            <button @click="handleChangePassword" class="user-menu-item">
              <span>Change Password</span>
            </button>
            <button v-if="authStore.isAdmin" @click="handleManageUsers" class="user-menu-item">
              <span>Manage Users</span>
            </button>
            <div class="user-menu-divider"></div>
            <button @click="handleLogout" class="user-menu-item logout">
              <i class="pi pi-sign-out"></i>
              <span>Logout</span>
            </button>
          </div>
        </div>

        <Button icon="pi pi-refresh" @click="handleRefresh" text rounded v-tooltip.bottom="'Refresh Data'" />
        <Button icon="pi pi-cog" @click="navigateTo('/settings')" text rounded v-tooltip.bottom="'Settings'" />
        <!-- Hamburger Menu Button -->
        <Button icon="pi pi-bars" @click="toggleSidebar" text rounded class="hamburger-btn" />
      </div>
    </header>

    <div class="layout-content">
      <!-- Sidebar - hidden on mobile, overlay on tablet, fixed on desktop -->
      <aside class="app-sidebar" :class="{ open: sidebarOpen }">
        <div class="sidebar-header">
          <span class="sidebar-title">Menu</span>
          <Button icon="pi pi-times" @click="closeSidebar" text rounded class="close-btn" />
        </div>
        <nav class="sidebar-nav">
          <router-link 
            v-for="item in menuItems" 
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
            @click="closeSidebar"
          >
            <i :class="item.icon"></i>
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </nav>
      </aside>

      <!-- Overlay for mobile menu -->
      <div v-if="sidebarOpen" class="sidebar-overlay" @click="closeSidebar"></div>

      <!-- Main Content Area -->
      <main class="app-main">
        <router-view />
      </main>
    </div>

    <!-- Change Password Dialog -->
    <Dialog v-model:visible="showPasswordDialog" header="Change Password" :modal="true" :style="{ width: '400px' }">
      <div class="password-form">
        <div class="form-field">
          <label for="current-password">Current Password</label>
          <Password 
            id="current-password"
            v-model="passwordForm.current" 
            :feedback="false"
            toggleMask
            placeholder="Enter current password"
          />
        </div>
        <div class="form-field">
          <label for="new-password">New Password</label>
          <Password 
            id="new-password"
            v-model="passwordForm.new" 
            toggleMask
            placeholder="Enter new password"
          />
        </div>
        <div class="form-field">
          <label for="confirm-password">Confirm New Password</label>
          <Password 
            id="confirm-password"
            v-model="passwordForm.confirm" 
            :feedback="false"
            toggleMask
            placeholder="Confirm new password"
          />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" @click="showPasswordDialog = false" text />
        <Button label="Change Password" @click="submitPasswordChange" :loading="authStore.loading" />
      </template>
    </Dialog>

    <Toast />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useRealtimeStore } from '../stores/realtime';
import { useSystemStore } from '../stores/system';
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Password from 'primevue/password';
import Toast from 'primevue/toast';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();
const systemStore = useSystemStore();
const toast = useToast();

const sidebarOpen = ref(false);
const userMenuOpen = ref(false);
const showPasswordDialog = ref(false);

const passwordForm = ref({
  current: '',
  new: '',
  confirm: ''
});

const menuItems = ref([
  { path: '/', label: 'Dashboard', icon: 'pi pi-home' },
  { path: '/history', label: 'History', icon: 'pi pi-calendar' },
  { path: '/control', label: 'Control', icon: 'pi pi-sliders-h' },
  { path: '/analytics', label: 'Analytics', icon: 'pi pi-chart-bar' },
  { path: '/settings', label: 'Settings', icon: 'pi pi-cog' },
  { path: '/collector-flow', label: 'Collector Flow', icon: 'pi pi-sitemap' },
]);

const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value;
};

const closeSidebar = () => {
  sidebarOpen.value = false;
};

const toggleUserMenu = () => {
  userMenuOpen.value = !userMenuOpen.value;
};

const isActive = (path) => {
  return path === '/' ? route.path === '/' : route.path.startsWith(path);
};

const navigateTo = (path) => {
  router.push(path);
  closeSidebar();
};

const handleRefresh = async () => {
  await realtimeStore.initialize();
  if (realtimeStore.isConnected) {
    await systemStore.fetchStatus();
  }
};

const handleLogout = async () => {
  await authStore.logout();
  router.push('/login');
  userMenuOpen.value = false;
};

const handleChangePassword = () => {
  showPasswordDialog.value = true;
  userMenuOpen.value = false;
  passwordForm.value = {
    current: '',
    new: '',
    confirm: ''
  };
};

const handleManageUsers = () => {
  router.push('/settings?tab=users');
  userMenuOpen.value = false;
};

const submitPasswordChange = async () => {
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'New passwords do not match',
      life: 3000
    });
    return;
  }

  if (passwordForm.value.new.length < 8) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Password must be at least 8 characters',
      life: 3000
    });
    return;
  }

  const success = await authStore.changePassword(
    passwordForm.value.current,
    passwordForm.value.new
  );

  if (success) {
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Password changed successfully',
      life: 3000
    });
    showPasswordDialog.value = false;
  } else {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: authStore.error || 'Failed to change password',
      life: 3000
    });
  }
};

// Close user menu when clicking outside
const handleClickOutside = (event) => {
  if (userMenuOpen.value && !event.target.closest('.user-menu')) {
    userMenuOpen.value = false;
  }
};

onMounted(async () => {
  await realtimeStore.initialize();
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<style scoped>
/* Layout */
.main-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-bg-primary);
  overflow-y: hidden;
  padding:1rem;
}

/* Header - Minimal */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  padding: 0 var(--gap-lg);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
}

.app-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}

.header-center {
  display: none; /* Hidden on mobile */
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

.hamburger-btn {
  display: flex !important; /* Always show on mobile */
}

/* User Menu */
.user-menu {
  position: relative;
}

.user-button {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.user-info {
  padding: var(--gap-md);
}

.user-name {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
}

.user-role {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-transform: capitalize;
  margin-top: 2px;
}

.user-menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--gap-xs) 0;
}

.user-menu-item {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  width: 100%;
  padding: var(--gap-sm) var(--gap-md);
  border: none;
  background: none;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.2s ease;
  text-align: left;
}

.user-menu-item:hover {
  background: var(--color-bg-primary);
}

.user-menu-item.logout {
  color: #ef4444;
}

.user-menu-item.logout:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* Password Form */
.password-form {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-md) 0;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.form-field label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

/* Layout Content */
.layout-content {
  display: flex;
  flex: 1;
  position: relative;
  max-height: calc(100vh - 6rem);
  overflow: hidden;
}

/* Sidebar - Mobile: Slide-in overlay */
.app-sidebar {
  position: fixed;
  top: 0;
  left: -280px;
  width: 280px;
  height: 100vh;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  transition: left 0.3s ease;
  z-index: 1000;
  overflow-y: auto;
}

.app-sidebar.open {
  left: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-lg);
  border-bottom: 1px solid var(--color-border);
}

.sidebar-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.close-btn {
  display: flex;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  padding: var(--gap-lg) 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  padding: var(--gap-md) var(--gap-lg);
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.nav-item:hover {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  border-left-color: var(--color-bg-black);
  font-weight: var(--font-weight-semibold);
}

.nav-item i {
  font-size: 1.125rem;
}

.nav-label {
  font-size: var(--font-size-base);
}

/* Sidebar Overlay */
.sidebar-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Main Content */
.app-main {
  flex: 1;
  width: 100%;
  overflow-y: auto;
}

/* Status Badge */
.global-status-badge {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--gap-md);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}

.status-live {
  color: var(--color-accent-dark);
  border-color: var(--color-accent-dark);
  background: rgba(212, 255, 0, 0.1);
}

.status-live .status-dot {
  width: 8px;
  height: 8px;
  background: #D7E5F0;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.status-historical {
  color: var(--color-text-secondary);
}

.status-historical .status-dot {
  width: 8px;
  height: 8px;
  background: var(--color-text-secondary);
  border-radius: 50%;
}

.source-indicators {
  display: flex;
  gap: var(--gap-xs);
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.6;
  }
}

/* Tablet (768px+) */
@media (min-width: 768px) {
  .header-center {
    display: flex;
  }
  
  .hamburger-btn {
    display: flex !important;
  }
}

/* Desktop (1024px+) */
@media (min-width: 1024px) {
  .hamburger-btn {
    display: none !important; /* Hide hamburger on desktop */
  }
  
  .app-sidebar {
    position: relative;
    left: 0;
    width: 240px;
    height: auto;
  }
  
  .sidebar-header {
    display: none; /* Hide close button on desktop */
  }
  
  .sidebar-overlay {
    display: none;
  }
  
  .layout-content {
    flex-direction: row;
  }
}
/* Header buttons styling */
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* NEW: Override PrimeVue button colors to dark gray */
.header-right :deep(.p-button) {
  color: #475569 !important;
}

.header-right :deep(.p-button:hover) {
  color: #1e293b !important;
}

/* Logo styling */
.app-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
}

/* NEW: SVG logo styling */
.logo-icon {
  width: 2rem;
  height: 2rem;
  object-fit: contain;
}
.header-right :deep(.p-button:hover) {
  color: #1e293b !important;
  background: var(--color-bg-primary) !important;
}

</style>