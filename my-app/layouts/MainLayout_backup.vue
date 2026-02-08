<template>
  <div class="main-layout">
    <header class="app-header">
      <div class="header-left">
        <Button icon="pi pi-bars" @click="toggleSidebar" text rounded class="menu-toggle" />
        <div class="app-logo">
          <span class="app-title">WattsOn</span>
        </div>
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

      <div class="header-center">
        <div 
          class="global-status-badge" 
          :class="realtimeStore.isConnected ? 'status-live' : 'status-historical'"
        >
          <span class="status-dot"></span>
          <span class="status-text">
            {{ realtimeStore.isConnected ? 'Live Data' : 'Historical Data Only' }}
          </span>
          
          <div v-if="realtimeStore.isConnected" class="source-indicators">
            <i v-if="realtimeStore.connectionSource === 'cloud'" class="pi pi-cloud" title="Cloud API"></i>
            <i v-if="realtimeStore.connectionSource === 'modbus'" class="pi pi-server" title="Local ModBus"></i>
          </div>
        </div>
      </div>

      <div class="header-right">
        <Button icon="pi pi-refresh" @click="handleRefresh" text rounded v-tooltip.bottom="'Refresh Data'" />
        <Button icon="pi pi-cog" @click="navigateTo('/settings')" text rounded v-tooltip.bottom="'Settings'" />
        <Button icon="pi pi-user" @click="toggleUserMenu" text rounded />
      </div>
    </header>

    <div class="layout-content">
      <aside class="app-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <nav class="sidebar-nav">
          <router-link 
            v-for="item in menuItems" 
            :key="item.path"
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
          >
            <i :class="item.icon"></i>
            <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
          </router-link>
        </nav>
      </aside>

      <main class="app-main">
        <router-view />
      </main>
    </div>

    <OverlayPanel ref="userMenuRef">
      <div class="user-menu">
        <div class="menu-items">
          <a @click="navigateTo('/settings')" class="menu-item"><i class="pi pi-cog"></i> <span>Settings</span></a>
          <a @click="openSetupWizard" class="menu-item"><i class="pi pi-wrench"></i> <span>Setup Wizard</span></a>
          <Divider />
          <a @click="handleLogout" class="menu-item"><i class="pi pi-sign-out"></i> <span>Logout</span></a>
        </div>
      </div>
    </OverlayPanel>
    <Toast />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useRealtimeStore } from '../stores/realtime';
import { useSystemStore } from '../stores/system';
import Button from 'primevue/button';
import OverlayPanel from 'primevue/overlaypanel';
import Divider from 'primevue/divider';
import Toast from 'primevue/toast';

const router = useRouter();
const route = useRoute();
const realtimeStore = useRealtimeStore();
const systemStore = useSystemStore();

const sidebarCollapsed = ref(false);
const userMenuRef = ref();

// Re-established Menu Items
const menuItems = ref([
  { path: '/', label: 'Dashboard', icon: 'pi pi-home' },
  { path: '/history', label: 'History', icon: 'pi pi-calendar' },
  { path: '/control', label: 'Control', icon: 'pi pi-sliders-h' },
  { path: '/analytics', label: 'Analytics', icon: 'pi pi-chart-bar' },
  { path: '/settings', label: 'Settings', icon: 'pi pi-cog' },
]);

const toggleSidebar = () => sidebarCollapsed.value = !sidebarCollapsed.value;
const toggleUserMenu = (event) => userMenuRef.value?.toggle(event);
const isActive = (path) => path === '/' ? route.path === '/' : route.path.startsWith(path);
const navigateTo = (path) => { router.push(path); userMenuRef.value?.hide(); };
const openSetupWizard = () => { router.push('/setupWizard'); userMenuRef.value?.hide(); };

const handleRefresh = async () => {
  await realtimeStore.initialize();
  if (realtimeStore.isConnected) {
    await systemStore.fetchStatus();
  }
};

onMounted(async () => {
  await realtimeStore.initialize();
});
</script>

<style scoped>
.main-layout            { display: flex; flex-direction: column; min-height: 100vh; }
.app-header             { display: flex; align-items: center; justify-content: space-between; height: 64px; background: white; border-bottom: 1px solid #e2e8f0; padding: 0 1rem; z-index: 100; }
.layout-content         { display: flex; flex: 1; overflow: hidden; }

/* Sidebar Styles */
.app-sidebar            { width: 240px; background: white; border-right: 1px solid #e2e8f0; transition: width 0.3s; }
.app-sidebar.collapsed  { width: 64px; }
.sidebar-nav            { padding: 1rem 0; }
.nav-item               { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; color: #64748b; text-decoration: none; border-left: 3px solid transparent; }
.nav-item.active        { background: #f0f4ff; color: #6366f1; border-left-color: #6366f1; }

/* Main Area Fix */
.app-main               { flex: 1; overflow-y: auto; background: #f8fafc; padding: 1rem;height: 100vh; box-sizing: border-box; }

/* Status Badge */
.global-status-badge    { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 1rem; border-radius: 20px; font-size: 0.875rem; font-weight: 700; border: 1px solid transparent; }
.status-live            { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
.status-live .status-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
.status-historical      { background: #fff1f2; color: #991b1b; border-color: #fecaca; }
.status-historical .status-dot { width: 8px; height: 8px; background: #ef4444; border-radius: 50%; }
.source-indicators      { display: flex; gap: 0.4rem; margin-left: 0.5rem; padding-left: 0.5rem; border-left: 1px solid rgba(0,0,0,0.1); }

@keyframes pulse        { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.6; } }
</style>