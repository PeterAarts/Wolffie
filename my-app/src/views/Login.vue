<template>
  <div class="loginscreen flex flex-col items-center justify-center app-section font-sans antialiased bg-secondary">
    <div class="login-outer w-full flex justify-center">
      <div class="login-grid grid lg:grid-cols-2 items-center w-full max-w-3xl">

        <!-- ── Form card ──────────────────────────────────────────────────── -->
        <div class="login-card bg-white shadow-md">

          <div class="login-logo flex items-center">
            <img src="@/assets/wolffie.svg" alt="Wolffie Logo" class="w-8 h-8 drop-shadow-sm" />
            <h2 class="text-4xl font-black uppercase text-primary">Wolffie</h2>
          </div>

          <form @submit.prevent="handleLogin" autocomplete="off">

            <div class="shout-wrap flex items-center text-center overflow-hidden">
              <transition name="shout" mode="out-in">
                <div :key="currentShoutIndex" class="text-sm tracking-tight text-secondary-400 w-full">
                  {{ currentShout }}
                </div>
              </transition>
            </div>

            <!-- Username -->
            <div class="field-wrap group">
              <input
                v-model="username"
                autocomplete="new-password"
                name="username"
                type="text"
                required
                :disabled="authStore.loading"
                @focus="usernameFocused = true"
                @blur="usernameFocused = false"
                class="field-input outline-none transition-all disabled:opacity-50 w-full text-sm text-primary"
                placeholder=""
              />
              <label class="field-label" :class="{ 'field-label--active': usernameFocused || username }">username</label>
              <i class="fa-light fa-user field-icon transition-colors text-secondary-400"></i>
            </div>

            <!-- Password -->
            <div class="field-wrap group">
              <input
                v-model="password"
                autocomplete="new-password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                required
                :disabled="authStore.loading"
                @focus="passwordFocused = true"
                @blur="passwordFocused = false"
                class="field-input outline-none transition-all disabled:opacity-50 w-full text-sm text-primary"
                placeholder=""
              />
              <label class="field-label" :class="{ 'field-label--active': passwordFocused || password }">password</label>
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="field-icon field-icon--btn transition-colors bg-transparent border-none cursor-pointer text-secondary-400"
              >
                <i :class="['fa-light', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
              </button>
            </div>

            <!-- Error -->
            <transition name="fade">
              <div v-if="authStore.error" class="error-banner flex items-center gap-3 bg-red-50 text-red-700 text-sm">
                <i class="fa-light fa-circle-exclamation text-base"></i>
                {{ authStore.error }}
              </div>
            </transition>

            <!-- Submit -->
            <div class="login-submit">
              <button
                type="submit"
                :disabled="authStore.loading"
                class="login-btn w-full text-sm focus:outline-none transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <i v-if="authStore.loading" class="fa-light fa-spinner-third fa-spin"></i>
                <i v-else class="fa-light fa-right-to-bracket"></i>
                Sign in
              </button>
            </div>
          </form>
        </div>

        <!-- ── Branding panel ─────────────────────────────────────────────── -->
        <div class="brand-panel flex flex-col items-center justify-center text-center">
          <img
            src="@/assets/wolffie.svg"
            class="w-4/5 max-w-[400px] aspect-square object-contain grayscale opacity-20 hover:opacity-100 transition-opacity duration-700"
            alt="Wolffie Logo"
          />
          <div class="brand-text">
            <h2 class="text-2xl font-black tracking-tighter uppercase text-primary">Wolffie</h2>
            <p class="text-xs tracking-[0.1em] text-secondary-400">
              your <b>W</b>atts management <b>O</b>n<b>l</b>ine/o<b>ff</b> l <b>i</b> n <b>E</b> system
            </p>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const showPassword = ref(false);
const usernameFocused = ref(false);
const passwordFocused = ref(false);

const handleLogin = async () => {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    router.push('/');
  }
};

const shouts = [
  'Your sun worked hard today. Come see the receipts.',
  'Charging ahead. One watt at a time.',
  'The grid called. You told it you\'re fine.',
  'Peak hours, meet your match.',
  'Solar in, costs out. Simple as that.',
  'Your panels pulled their weight. Did you?',
  'Every kilowatt counts. You\'re about to count them.',
  'Off-grid dreams, on-grid backup. Best of both.',
  'Less bill, more thrill.',
  'The electrons are ready. Are you?',
];

const currentShoutIndex = ref(Math.floor(Math.random() * shouts.length));
const currentShout = ref(shouts[currentShoutIndex.value]);

let shoutInterval = null;

onMounted(() => {
  shoutInterval = setInterval(() => {
    currentShoutIndex.value = (currentShoutIndex.value + 1) % shouts.length;
    currentShout.value = shouts[currentShoutIndex.value];
  }, 12000);
});

onUnmounted(() => {
  clearInterval(shoutInterval);
});
</script>

<style scoped>
/* ── Screen ──────────────────────────────────────────────────────────────── */
.loginscreen  { height: calc(100vh - 2rem); box-shadow: 3px 3px 6px var(--color-border-dark); }

/* ── Outer wrapper + grid ────────────────────────────────────────────────── */
.login-outer  { padding: 1.5rem 1rem; }
.login-grid   { gap: 2.5rem; }

/* ── Form card ───────────────────────────────────────────────────────────── */
.login-card   { padding: 2rem; margin: 0.75rem; }
.login-logo   { gap: 0.75rem; margin-bottom: 0.5rem; }

/* ── Shout ───────────────────────────────────────────────────────────────── */
.shout-wrap   { min-height: 3.5rem; margin-bottom: 2.5rem; }

/* ── Fields ──────────────────────────────────────────────────────────────── */
.field-wrap {
  position: relative;
  margin-top: 1.5rem;
  height: 3.25rem;
  background: var(--color-bg-primary);
}

.field-input {
  position: absolute;
  inset: 0;
  padding: 1.25rem 2.5rem 0.25rem 0.625rem;
  height: 100%;
  background: var(--color-bg-primary);
  border: none;
}
.field-input:focus { background: var(--color-bg-secondary); }

/* Kill browser autofill bg injection */
.field-input:-webkit-autofill,
.field-input:-webkit-autofill:hover,
.field-input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px var(--color-bg-primary) inset;
  -webkit-text-fill-color: var(--color-text-primary);
  transition: background-color 9999s ease-in-out 0s;
}

.field-icon {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  line-height: 1;
}
.field-icon--btn { padding: 0; }

.field-label {
  position: absolute;
  left: 0.625rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  letter-spacing: 0.05em;
  text-transform: lowercase;
  pointer-events: none;
  transition: top 0.25s ease, font-size 0.25s ease, color 0.25s ease, transform 0.25s ease;
}
.field-label--active {
  top: 0.5rem;
  transform: translateY(0);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

/* ── Error banner ────────────────────────────────────────────────────────── */
.error-banner { padding: 1rem; margin-top: 1.5rem; }

/* ── Submit ──────────────────────────────────────────────────────────────── */
.login-submit { margin-top: 1.5rem; }
.login-btn {
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: #fff;
}
.login-btn:hover:not(:disabled) { background: var(--color-secondary-400); }

/* ── Brand panel ─────────────────────────────────────────────────────────── */
.brand-panel  { padding: 1.5rem; }
.brand-text   { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }

/* ── Transitions ─────────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active   { transition: opacity 0.3s ease; }
.fade-enter-from,   .fade-leave-to       { opacity: 0; }

.shout-enter-active { transition: opacity 0.6s ease, transform 0.6s ease; }
.shout-leave-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.shout-enter-from   { opacity: 0; transform: translateY(8px); }
.shout-leave-to     { opacity: 0; transform: translateY(-8px); }
</style>