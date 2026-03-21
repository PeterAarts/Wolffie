<template>
  <div class="app-section flex flex-col overflow-hidden font-sans bg-white text-primary">

    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <header class="app-header flex items-center justify-between p-2 bg-white z-40 shrink-0 bg-secondary-100 border-b border-secondary-200">

      <div class="flex items-center gap-3">
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="nav-mobile-toggle lg:hidden flex items-center justify-center text-secondary-400 hover:bg-secondary-200 transition-colors"
        >
          <i class="fa-light fa-bars text-xl"></i>
        </button>

        <div class="flex items-center gap-3">
          <router-link to="/" class="flex items-center gap-3 no-underline text-inherit">
            <img src="@/assets/wolffie.svg" alt="Wolffie Logo" class="w-8 h-8 drop-shadow-sm" />
            <span class="text-3xl font-black tracking-tight uppercase">Wolffie</span>
          </router-link>

          <div class="flex items-center">
            <span class="relative flex h-2.5 w-2.5">
              <span
                v-if="realtimeStore.isConnected"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
              ></span>
              <span
                :class="['relative inline-flex rounded-full h-2.5 w-2.5',
                  realtimeStore.isConnected ? 'bg-green-700' : 'bg-amber-500']"
              ></span>
            </span>
            <span class="connection-label text-xs lowercase tracking-wider text-secondary-400 hidden lg:block">
              {{ realtimeStore.isConnected ? t('header.connected') : t('header.disconnected') }}
            </span>
          </div>
        </div>
      </div>

      <!-- User menu -->
      <div class="flex items-center relative">
        <button
          @click="toggleUserMenu"
          class="user-menu-btn flex items-center bg-white hover:bg-secondary-300 transition-colors"
        >
          <div class="user-avatar flex items-center justify-center text-[10px] font-bold uppercase bg-primary text-white">
            {{ authStore.user?.username?.substring(0,2) || 'me' }}
          </div>
          <span class="text-sm font-bold text-secondary-400 hidden sm:block">{{ authStore.user?.username }}</span>
          <i class="fa-solid fa-chevron-down text-[10px] text-secondary-400"></i>
        </button>

        <div
          v-if="userMenuOpen"
          class="user-dropdown absolute z-50 overflow-hidden shadow-xl bg-white border border-secondary-200"
        >
          <div class="dropdown-inner">
            <button
              @click="openProfile"
              class="dropdown-item w-full text-left flex items-center gap-3 text-sm text-secondary-400 hover:bg-secondary-200 hover:text-primary transition-colors"
            >
              <i class="fa-light fa-user-pen"></i> {{ t('nav.myProfile') }}
            </button>
            <button
              @click="handleLogout"
              class="dropdown-item w-full text-left flex items-center gap-3 text-sm text-secondary-400 hover:bg-secondary-200 hover:text-primary transition-colors"
            >
              <i class="fa-light fa-right-from-bracket"></i> {{ t('header.logout') }}
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- ── Profile drawer ──────────────────────────────────────────────────── -->
    <AppDrawer v-model:visible="profileDrawerOpen" :title="t('nav.myProfile')">
      <div v-if="profileDrawerOpen">

        <div class="profile-meta bg-white">
          <div class="profile-meta__avatar bg-primary text-white">
            {{ authStore.user?.username?.substring(0,2)?.toUpperCase() || '??' }}
          </div>
          <div class="profile-meta__name text-primary">{{ authStore.user?.full_name || authStore.user?.username }}</div>
          <div class="profile-meta__sub">
            <span :class="[
              'role-badge',
              authStore.user?.role === 'admin'  ? 'role-badge--admin' :
              authStore.user?.role === 'viewer' ? 'role-badge--viewer' : 'role-badge--user'
            ]">{{ authStore.user?.role }}</span>
          </div>
        </div>

        <div class="profile-fields border-t border-secondary-200 border-b border-secondary-200">
          <div class="profile-field border-b border-secondary-100">
            <span class="profile-field__label text-secondary-400">{{ t('settings.users.name') }}</span>
            <span class="profile-field__value text-primary">{{ authStore.user?.username }}</span>
          </div>
          <div class="profile-field border-b border-secondary-100">
            <span class="profile-field__label text-secondary-400">{{ t('settings.users.full_name') }}</span>
            <span class="profile-field__value text-primary">{{ authStore.user?.full_name || '—' }}</span>
          </div>
          <div v-if="authStore.user?.email" class="profile-field">
            <span class="profile-field__label text-secondary-400">{{ t('settings.users.email') }}</span>
            <span class="profile-field__value text-primary">{{ authStore.user?.email }}</span>
          </div>
        </div>

        <div class="drawer-section">
          <div class="drawer-section__title">{{ t('profile.changePassword') }}</div>
          <div class="form-field">
            <label class="form-label">{{ t('profile.currentPassword') }} <span class="req">*</span></label>
            <input v-model="profileForm.oldPassword" type="password" class="input" autocomplete="current-password" />
          </div>
          <div class="form-field">
            <label class="form-label">{{ t('profile.newPassword') }} <span class="req">*</span></label>
            <input v-model="profileForm.newPassword" type="password" class="input" autocomplete="new-password" />
          </div>
          <div class="form-field">
            <label class="form-label">{{ t('profile.confirmPassword') }} <span class="req">*</span></label>
            <input v-model="profileForm.confirmPassword" type="password" class="input" autocomplete="new-password" />
            <span v-if="passwordMismatch" class="field-error">{{ t('profile.passwordMismatch') }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="profileDrawerOpen = false">{{ t('common.cancel') }}</button>
        <button
          class="btn btn--sm btn--primary"
          :class="{ 'btn--busy': savingPassword }"
          :disabled="savingPassword || passwordMismatch || !profileForm.oldPassword || !profileForm.newPassword"
          @click="savePassword"
        >
          {{ t('profile.savePassword') }}
        </button>
      </template>
    </AppDrawer>

    <!-- ── Body ────────────────────────────────────────────────────────────── -->
    <div class="flex flex-1 overflow-hidden relative">

      <div
        v-if="sidebarOpen"
        class="fixed inset-0 bg-black/30 z-30 lg:hidden"
        @click="sidebarOpen = false"
      />

      <aside
        :class="[
          'app-sidebar absolute inset-y-0 left-0 z-40 transition-transform duration-300 lg:translate-x-0 lg:static lg:block shrink-0 flex flex-col bg-white',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        ]"
      >
        <nav class="sidebar-nav flex flex-col overflow-y-auto">
          <router-link
            v-for="item in navItems"
            :key="item.id"
            :to="item.to"
            @click="sidebarOpen = false"
            class="nav-item flex items-center p-2 mb-2 font-medium tracking-tight transition-colors no-underline"
            :class="[
              item.disabled ? 'opacity-50 pointer-events-none' : '',
              isActive(item.to)
                ? 'bg-primary text-white'
                : 'text-secondary-400 hover:bg-secondary-200 hover:text-primary'
            ]"
          >
            <div class="nav-item__icon flex justify-center shrink-0">
              <i :class="[item.icon, 'text-base', isActive(item.to) ? 'text-white' : 'text-secondary-400']"></i>
            </div>
            <span class="nav-item__label text-sm">{{ item.label }}</span>
          </router-link>
        </nav>
      </aside>

      <main class="flex-1 overflow-y-auto bg-background">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useRealtimeStore } from '@/stores/realtime';
import { useToastStore } from '@/stores/toast';
import ConnectionStatusBanner from '@/components/ConnectionStatusBanner.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';
import { useLocale } from '../composables/useLocale';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const realtimeStore = useRealtimeStore();
const toast = useToastStore();
const { t } = useLocale();

// Exact match for '/', prefix match for everything else
const isActive = (path) => {
  if (path === '/') return route.path === '/';
  return route.path.startsWith(path);
};

const sidebarOpen    = ref(false);
const userMenuOpen   = ref(false);
const profileDrawerOpen = ref(false);
const savingPassword = ref(false);
const profileForm    = ref({ oldPassword: '', newPassword: '', confirmPassword: '' });

const passwordMismatch = computed(() =>
  profileForm.value.confirmPassword.length > 0 &&
  profileForm.value.newPassword !== profileForm.value.confirmPassword
);

function openProfile() {
  userMenuOpen.value = false;
  profileForm.value  = { oldPassword: '', newPassword: '', confirmPassword: '' };
  profileDrawerOpen.value = true;
}

async function savePassword() {
  if (passwordMismatch.value || !profileForm.value.oldPassword || !profileForm.value.newPassword) return;
  savingPassword.value = true;
  try {
    const ok = await authStore.changePassword(profileForm.value.oldPassword, profileForm.value.newPassword);
    if (ok) {
      toast.add({ severity: 'success', summary: t('common.success'), detail: t('profile.passwordChanged') });
      profileDrawerOpen.value = false;
      // changePassword() calls logout() internally — auth guard will redirect to /login
    } else {
      toast.add({ severity: 'error', summary: t('common.error'), detail: authStore.error || t('common.error') });
    }
  } finally {
    savingPassword.value = false;
  }
}

const allNavItems = [
  { id: 'dashboard', label: t('nav.dashboard'), to: '/',         icon: 'fa-light fa-table-cells-large', roles: null },
  { id: 'history',   label: t('nav.history'),   to: '/history',  icon: 'fa-light fa-chart-line',   roles: null },
  { id: 'control',   label: t('nav.control'),   to: '/control',  icon: 'fa-light fa-bolt',  roles: null },
  { id: 'settings',  label: t('nav.settings'),  to: '/settings', icon: 'fa-light fa-gear',        roles: ['admin', 'user'] },
];

// roles: null = visible to everyone, otherwise restricted to listed roles
const navItems = computed(() =>
  allNavItems.filter(item => !item.roles || item.roles.includes(authStore.user?.role))
);

const toggleUserMenu = () => { userMenuOpen.value = !userMenuOpen.value; };

const handleLogout = async () => {
  await authStore.logout();
  router.push('/login');
};

// ─── Realtime connection — global lifecycle ───────────────────────────────────
// MainLayout mounts once and lives for the whole session, making it the right
// place to own the realtimeStore connection so the indicator stays accurate on
// every page, not just the Dashboard.
onMounted(async () => {
  await realtimeStore.initialize();
  startPolling();
});

let _pollInterval = null;

const startPolling = () => {
  if (_pollInterval) return;
  _pollInterval = setInterval(async () => {
    if (realtimeStore.isConnected) {
      // Already connected — let the store refresh its data
      realtimeStore.fetchData?.();
    } else {
      // Not connected — try to re-establish
      await realtimeStore.initialize();
    }
  }, 10000);
};

onUnmounted(() => {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
});
// ─────────────────────────────────────────────────────────────────────────────
</script>

<style scoped>
/* Page transition */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,  .fade-leave-to      { opacity: 0; }

/* nav-link needs explicit no-underline since router-link renders as <a> */
.nav-item { text-decoration: none; }

/* ── Header ─────────────────────────────────────────────────────────────── */
.app-header           { height: 4rem; padding: 0 1.5rem; }
.nav-mobile-toggle    { width: 2.5rem; height: 2.5rem; }
.connection-label     { padding: 0 0.5rem; }

/* ── User menu ───────────────────────────────────────────────────────────── */
.user-menu-btn        { gap: 0.5rem; padding: 0.375rem 0.5rem; }
.user-avatar          { width: 1.5rem; height: 1.25rem; }
.user-dropdown        { top: 3rem; right: 0; width: 11rem; }
.dropdown-inner       { padding: 0.375rem; }
.dropdown-item        { padding: 0.375rem 0.625rem; gap: 0.625rem; }

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
.app-sidebar          { width: 13rem; }
.sidebar-nav          { padding: 0.75rem; gap: 0.125rem; flex: 1; }
.nav-item             { gap: 0; }
.nav-item__icon       { width: 2.5rem; padding: 0.5rem 0; }
.nav-item__label      { padding: 0.5rem 0.25rem; }

/* ── Profile drawer ──────────────────────────────────────────────────────── */
.profile-meta               { display: flex; flex-direction: column; align-items: center; padding: 1.5rem 1rem 1.25rem; text-align: center; }
.profile-meta__avatar       { width: 3.5rem; height: 3.5rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
.profile-meta__name         { font-size: 1rem; font-weight: 700; }
.profile-meta__sub          { margin-top: 0.35rem; }

.profile-fields             { margin-bottom: 0; }
.profile-field              { display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1rem; }
.profile-field:last-child   { border-bottom: none !important; }
.profile-field__label       { font-size: 0.75rem; font-weight: 400; text-transform: lowercase; letter-spacing: 0.04em; }
.profile-field__value       { font-size: 0.85rem; font-weight: 600; }

.role-badge                 { display: inline-block; padding: 0.125rem 0.5rem; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.role-badge--admin          { background: var(--color-primary); color: #fff; }
.role-badge--user           { background: var(--color-secondary-200); color: var(--color-text-secondary); }
.role-badge--viewer         { background: var(--color-secondary-100); color: var(--color-text-tertiary); }
.req                        { color: #ef4444; margin-left: 2px; }
.field-error                { font-size: 0.72rem; color: #ef4444; margin-top: 0.25rem; display: block; }
</style>