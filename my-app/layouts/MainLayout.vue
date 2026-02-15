<template>
  <div class="flex flex-col  bg-white text-gray-900 overflow-hidden font-sans">
    <header class="h-16 bg-white border-b border-gray-200 flex items-center justify-between p-6 z-40 shrink-0 ">
      <div class="flex items-center gap-3">
        <button 
          @click="sidebarOpen = !sidebarOpen" 
          class="lg:hidden w-10 h-10 flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
        >
          <i class="fa-duotone fa-bars text-xl"></i>
        </button>

        <div class="flex items-center gap-3">
          <img src="@/assets/woffie.svg" alt="Wolffie Logo" class="w-8 h-8 drop-shadow-sm" />
          <span class="text-3xl font-black tracking-tight hidden sm:block  uppercase">
            Wolffie
          </span>
          
          <div class="flex items-center ml-2">
            <span class="relative flex h-2.5 w-2.5">
              <span 
                v-if="realtimeStore.isConnected"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
              ></span>
              <span 
                :class="[
                  'relative inline-flex rounded-full h-2.5 w-2.5',
                  realtimeStore.isConnected ? 'bg-green-700' : 'bg-amber-500'
                ]"
              ></span>
            </span>
            <span class="p-2 text-xs lowercase tracking-wider text-gray-400 hidden lg:block">
              {{ realtimeStore.isConnected ? ' Live' : ' Historical' }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3 relative">
        <button 
          @click="toggleUserMenu"
          class="flex items-center gap-2 px-3 py-1.5 transition-all"
        >
          <div class="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-[10px] font-bold text-white uppercase">
            {{ authStore.user?.username?.substring(0,2) || 'US' }}
          </div>
          <span class="text-sm font-bold text-gray-700 hidden sm:block">{{ authStore.user?.username }}</span>
          <i class="fa-solid fa-chevron-down text-[10px] text-gray-400"></i>
        </button>

        <div v-if="userMenuOpen" class="absolute top-12 right-0 w-56 bg-white border border-gray-200  shadow-xl z-50 overflow-hidden">
          <div class="p-4 bg-gray-50 border-b border-gray-100 text-xs text-left">
            <div class="font-bold uppercase text-gray-900">{{ authStore.user?.username }}</div>
            <div class="text-gray-400 lowercase tracking-widest mt-0.5">{{ authStore.user?.role }}</div>
          </div>
          <div class="p-2">
            <button @click="handleLogout" class="w-full text-left p-2 text-sm font-bold text-gray-600 hover:bg-gray-100  flex items-center gap-3">
              <i class="fa-light fa-right-from-bracket"></i> Logout
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden relative">
      <aside 
        :class="[
          'fixed inset-y-0 left-0 w-50 bg-white border-r border-gray-200 z-40 transition-transform duration-300 transform lg:translate-x-0 lg:static lg:block flex-shrink-0 flex flex-col',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        ]"
      >
        <nav class="flex-1 overflow-y-auto p-3 space-y-4">
          <router-link 
            v-for="item in navItems" 
            :key="item.id" 
            :to="item.to"
            @click="sidebarOpen = false"
            class="flex items-center p-4 transition-all font-bold group"
            active-class="bg-gray-100 text-gray-900 "
            :class="item.disabled ? 'opacity-50 pointer-events-none' : 'text-gray-500 hover:bg-gray-100'"
          >
            <div class="w-12 flex justify-center">
              <i :class="[item.icon, 'text-xl', $route.path === item.to ? 'text-gray-500 font-bold' : 'text-gray-400 group-hover:text-gray-900 transition-colors']"></i>
            </div>
            <span class="ml-4 text-sm font-semibold tracking-tight group-hover:text-gray-900">{{ item.label }}</span>
          </router-link>
        </nav>


      </aside>

      <main class="flex-1 overflow-y-auto bg-gray-50">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <ConnectionStatusBanner v-if="!realtimeStore.isConnected" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useRealtimeStore } from '@/stores/realtime';
import ConnectionStatusBanner from '@/components/ConnectionStatusBanner.vue';

const router = useRouter();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();

const sidebarOpen = ref(false);
const userMenuOpen = ref(false);

const navItems = [
  { id: 'dashboard', label: 'Dashboard', to: '/', icon: 'fa-light fa-house-signal' },
  { id: 'history', label: 'History', to: '/history', icon: 'fa-light fa-chart-line' },
  { id: 'analytics', label: 'Analytics', to: '/analytics', icon: 'fa-light fa-chart-mixed' },
  { id: 'events', label: 'Events', to: '/events', icon: 'fa-light fa-bell-on' },
  { id: 'control', label: 'Inverter Control', to: '/control', icon: 'fa-light fa-solar-panel' },
  { id: 'settings', label: 'Settings', to: '/settings', icon: 'fa-light fa-gears' }
];

const toggleUserMenu = () => { userMenuOpen.value = !userMenuOpen.value; };

const handleLogout = async () => {
  await authStore.logout();
  router.push('/login');
};
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>