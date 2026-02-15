<!-- src/App.vue - WITH AUTHENTICATION -->
<template>
  <div id="app-x" class="p-4">
    <!-- Show loading screen during initial load -->
    <div v-if="isInitializing" class="loading-screen">
      <div class="loading-content">
        <i class="pi pi-spin pi-spinner" style="font-size: 3rem"></i>
        <p>Loading Wolffie...</p>
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
import { useSystemStore } from '@/stores/system';
import ToastList from '@/components/common/ToastList.vue';

const router = useRouter();
const authStore = useAuthStore();
const configStore = useConfigStore();
const systemStore = useSystemStore();

const isInitializing = ref(true);

/**
 * Optimized startup flow with authentication
 */
onMounted(async () => {
  console.log('- App starting...');

  try {
    // STEP 0: Check authentication
    console.log('- Checking authentication...');
    const isAuthenticated = await authStore.initialize();

    if (!isAuthenticated) {
      console.log('- Not authenticated, redirecting to login');
      router.push('/login');
      isInitializing.value = false;
      return;
    }

    console.log('- Authenticated as:', authStore.user.username);

    // PHASE 1: Load minimal config (1 API call)
    // GET /api/setup/status
    await configStore.loadMinimalConfig();

    // Check if setup is completed
    if (!configStore.setupCompleted) {
      console.log('⚠️  Setup not completed, redirecting to wizard');
      router.push('/setupWizard');
      isInitializing.value = false;
      return;
    }

    // PHASE 2: Initialize system store (1 API call)
    // GET /api/alphaess/collector-status
    await systemStore.initialize();

    console.log('✅ App initialization complete (3 API calls)');
    console.log('📊 Dashboard ready');

  } catch (error) {
    console.error('❌ App initialization failed:', error);
    
    // If error is auth-related, redirect to login
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