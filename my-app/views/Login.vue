<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-slate-50 font-sans antialiased">
    <div class="py-6 px-4 w-full flex justify-center">
      <div class="grid lg:grid-cols-2 items-center gap-10 max-w-3xl w-full">
        
        <div class="bg-white m-3 border border-slate-200 p-8 ">
          <form @submit.prevent="handleLogin" class="space-y-6">
            <div class="mb-10">
              <h1 class="text-slate-900 text-3xl font-black tracking-tight">Sign in</h1>
              <p class="text-slate-500 text-[15px] mt-4 leading-relaxed font-medium">
                Log in to your Wolffie account to manage your home energy and monitor real-time performance.
              </p>
            </div>

            <div class="mt-4">
              <label class="text-slate-400 text-sm ms-2 mb-2 block lowercase tracking-wider">Username</label>
              <div class="relative flex items-center group">
                <input 
                  v-model="username"
                  name="username" 
                  type="text" 
                  required 
                  :disabled="authStore.loading"
                  class="w-full text-sm text-slate-900  p-2 outline-none focus:border-slade-600 focus:ring-1 focus:ring-slade-400 transition-all bg-slate-50 focus:bg-white disabled:opacity-50" 
                  placeholder="Enter user name" 
                />
                <i class="fa-light fa-user absolute right-4 text-slate-400 group-focus-within:text-slade-600"></i>
              </div>
            </div>

            <div class="mt-4">
              <label class="text-slate-400 text-sm ms-2 mb-2 block lowercase tracking-wider">Password</label>
              <div class="relative flex items-center group">
                <input 
                  v-model="password"
                  name="password" 
                  :type="showPassword ? 'text' : 'password'" 
                  required 
                  :disabled="authStore.loading"
                  class="w-full text-sm text-slate-900  p-2 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all bg-slate-50 focus:bg-white disabled:opacity-50" 
                  placeholder="Enter password" 
                />
                <button 
                  type="button"
                  @click="showPassword = !showPassword"
                  class="absolute right-4 text-slate-400 hover:text-blue-600 transition-colors"
                >
                  <i :class="['fa-light', showPassword ? 'fa-eye-slash' : 'fa-eye']"></i>
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="flex items-center gap-4">
                <input id="remember-me" name="remember-me" type="checkbox" class="h-4 w-4 shrink-0 text-blue-600 focus:ring-blue-500 border-slate-300 rounded cursor-pointer" />
                <label for="remember-me" class="p-3 block text-sm text-slate-700 font-medium cursor-pointer">Remember me</label>
              </div>
              <div class="text-sm">
                <a href="javascript:void(0);" class="text-slade-600 hover:underline font-bold">
                  Forgot password?
                </a>
              </div>
            </div>

            <transition name="fade">
              <div v-if="authStore.error" class="p-4 mt-6 bg-red-50 text-red-700 text-sm flex items-center gap-3">
                <i class="fa-duotone fa-circle-exclamation text-base"></i>
                {{ authStore.error }}
              </div>
            </transition>

            <div class="!mt-8">
              <button 
                type="submit" 
                :disabled="authStore.loading"
                class="w-full  py-3.5 px-4 text-sm text-white bg-gray-500 hover:bg-gray-600 focus:outline-none transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
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
            src="@/assets/woffie.svg" 
            class="w-4/5 max-w-[400px] aspect-square object-contain grayscale opacity-20 hover:opacity-100 transition-opacity duration-700" 
            alt="Wolffie Logo" 
          />
          <div class="mt-8 space-y-2">
            <h2 class="text-4xl font-black text-slate-900 tracking-tighter uppercase">Wolffie</h2>
            <p class="text-slate-400 text-xs  tracking-[0.1em]">your <b>W</b>atts <b>O</b>n<b>L</b>ine/o<b>FF</b>l<b>I</b>n<b>E</b> energy management system</p>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

// Logic strictly preserved from your previous files
const username = ref('');
const password = ref('');
const showPassword = ref(false);

const handleLogin = async () => {
  const success = await authStore.login(username.value, password.value);
  if (success) {
    router.push('/');
  }
};
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>