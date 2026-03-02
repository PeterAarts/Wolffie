<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-slate-50 app-section font-sans antialiased">
    <div class="py-6 px-4 w-full flex justify-center">
      <div class="grid lg:grid-cols-2 items-center gap-10 max-w-3xl w-full">
        
        <div class="bg-white m-3  p-8 ">
          <div class="flex items-center gap-3 mb-2">
            <img src="@/assets/wolffie.svg" alt="Wolffie Logo" class="w-8 h-8 drop-shadow-sm" />
            <h2 class="text-4xl font-black text-slate-900  sm:block uppercase">Wolffie</h2>
          </div>  
          <form @submit.prevent="handleLogin" autocomplete="off" class="space-y-6">
            <div class="mb-10 min-h-[3.5rem] flex items-center text-center overflow-hidden">
              <transition name="shout" mode="out-in">
                <div :key="currentShoutIndex" class="text-gray-400  text-sm tracking-tight ">{{ currentShout }}</div>
              </transition>
            </div>

            <!-- Username field with floating label -->
            <div class="field-wrap group !mt-6">
              <input 
                v-model="username"
                autocomplete="new-password"
                name="username" 
                type="text" 
                required 
                :disabled="authStore.loading"
                @focus="usernameFocused = true"
                @blur="usernameFocused = false"
                class="field-input outline-none transition-all bg-gray-100 focus:bg-white disabled:opacity-50 focus:ring-1 focus:ring-slate-400 w-full text-sm text-slate-900"
                placeholder=""
              />
              <label class="field-label" :class="{ 'field-label--active': usernameFocused || username }">username</label>
              <i class="fa-light fa-user field-icon text-slate-400 group-focus-within:text-slate-600 transition-colors"></i>
            </div>

            <!-- Password field with floating label -->
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
                class="field-input outline-none transition-all bg-gray-100 focus:bg-white disabled:opacity-50 focus:ring-1 focus:ring-slate-400 w-full text-sm text-slate-900"
                placeholder=""
              />
              <label class="field-label" :class="{ 'field-label--active': passwordFocused || password }">password</label>
              <button type="button" @click="showPassword = !showPassword" class="field-icon text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-none cursor-pointer p-0">
                <i :class="['fa-light', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
              </button>
            </div>



            <transition name="fade">
              <div v-if="authStore.error" class="p-4 mt-6 bg-red-50 text-red-700 text-sm flex items-center gap-3">
                <i class="fa-light fa-circle-exclamation text-base"></i>
                {{ authStore.error }}
              </div>
            </transition>

            <div class="!mt-6">
              <button 
                type="submit" 
                :disabled="authStore.loading"
                class="w-full p-2 text-sm text-white bg-gray-500 hover:bg-gray-600 focus:outline-none transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
              >
                <i v-if="authStore.loading" class="fa-light fa-spinner-third fa-spin"></i>
                <i v-else class="fa-light fa-right-to-bracket"></i>
                Sign in
              </button>
            </div>
          </form>
        </div>

        <div class="max-lg:mt-12 flex flex-col items-center justify-center text-center p-6">
          <img 
            src="@/assets/wolffie.svg" 
            class="w-4/5 max-w-[400px] aspect-square object-contain grayscale opacity-20 hover:opacity-100 transition-opacity duration-700" 
            alt="Wolffie Logo" 
          />
          <div class="mt-0 space-y-2">
            <h2 class="text-2xl font-black text-slate-700 tracking-tighter uppercase">Wolffie</h2>
            <p class="text-slate-400 text-xs tracking-[0.1em]">your <b>W</b>atts <b>O</b>n<b>L</b>ine/o<b>FF</b>l<b>I</b>n<b>E</b> energy management system</p>
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

// Rotating welcome shouts
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

/* Kill browser autofill background injection */
.field-input:-webkit-autofill,
.field-input:-webkit-autofill:hover,
.field-input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #f3f4f6 inset;
  -webkit-text-fill-color: #0f172a;
  transition: background-color 9999s ease-in-out 0s;
}

/* Field wrapper */
.field-wrap {
  position: relative;
  margin-top: 1rem;
  height: 3.25rem;
}

/* The input sits full-width inside the wrapper */
.field-input {
  position: absolute;
  inset: 0;
  padding: 1.25rem 2.5rem 0.25rem 0.625rem;
  height: 100%;
}

/* Icon pinned to the right, vertically centred */
.field-icon {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  line-height: 1;
}

/* Label — sits in the middle of the field at rest */
.field-label {
  position: absolute;
  left: 0.625rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.875rem;
  color: #94a3b8;
  letter-spacing: 0.05em;
  text-transform: lowercase;
  pointer-events: none;
  transition: top 0.25s ease, font-size 0.25s ease, color 0.25s ease, transform 0.25s ease, opacity 0.25s ease;
}

/* Label floats to top when focused or filled */
.field-label--active {
  top: 0.5rem;
  transform: translateY(0);
  font-size: 0.625rem;
  color: #94a3b8;
  letter-spacing: 0.08em;
}

/* Error fade */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Shout transition */
.shout-enter-active {
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.shout-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.shout-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.shout-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>