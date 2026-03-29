<!-- src/App.vue - WITH AUTHENTICATION -->
<template>
  <div id="app-x" class="p-0">
    <!-- Show loading screen during initial load -->
    <div v-if="isInitializing" class="loading-screen">
      <div class="loading-content">
        <i class="fa-light fa-spinner-third fa-spin" style="font-size: 3rem"></i>
        <p> Wolffie</p>
      </div>
    </div>
    <!-- Main app content -->
    <router-view v-else />
    <ToastList />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useConfigStore } from '@/stores/config';
import { useStrategyStore } from '@/stores/strategy';
import { useThemeStore } from '@/stores/theme';
import ToastList from '@/components/common/ToastList.vue';

const router = useRouter();
const authStore = useAuthStore();
const configStore = useConfigStore();
const strategyStore = useStrategyStore();
const themeStore = useThemeStore();
const isInitializing = ref(true);

/**
 * Optimized startup flow with authentication
 */
onMounted(async () => {
  console.log('- App starting...');

  try {
    // Auth was already initialized in main.js before mount — read the result directly
    if (!authStore.isAuthenticated) {
      console.log('- Not authenticated, redirecting to login');
      router.push('/login');
      isInitializing.value = false;
      return;
    }

    console.log('- Authenticated as:', authStore.user.username);

    // Load theme from server — overwrites localStorage if DB has a different value
    await themeStore.loadFromServer();

    // Load minimal config: GET /api/setup/status
    await configStore.loadMinimalConfig();

    if (!configStore.setupCompleted) {
      console.log('⚠️  Setup not completed, redirecting to wizard');
      router.push('/setupWizard');
      isInitializing.value = false;
      return;
    }

    console.log('✅ App initialization complete');
    console.log('📊 Dashboard ready');
    strategyStore.startPolling();

  } catch (error) {
    console.error('❌ App initialization failed:', error);
    if (error.response?.status === 401) {
      router.push('/login');
    }
  } finally {
    isInitializing.value = false;
  }
});

</script>

<style scoped>
.loading-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #e8eaf1 0%, #737472 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  text-align: center;
  color: white;
}

.loading-content p {
  margin-top: 1rem;
  font-size: 1.2rem;
  font-weight: 500;
}
</style>