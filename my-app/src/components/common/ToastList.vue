<!-- /components/common/ToastList.vue -->

<template>
  <div class="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 w-full max-w-sm">
    <transition-group 
      enter-active-class="transform ease-out duration-300 transition"
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div 
        v-for="toast in toastStore.toasts" 
        :key="toast.id"
        class="bg-gray-100  p-4 flex items-start gap-4 overflow-hidden relative "
      >
        <div :class="['absolute left-0 top-0 bottom-0 w-1.5', severityClass(toast.severity)]"></div>
        
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <i :class="[iconClass(toast.severity), 'text-lg']"></i>
            <span class="text-md font-medium text-slate-800">{{ toast.summary }}</span>
          </div>
          <p class="text-sm text-slate-500 mt-4 font-medium leading-tight">{{ toast.detail }}</p>
        </div>

        <button @click="toastStore.remove(toast.id)" class="text-slate-300 hover:text-slate-900 transition-colors">
          <i class="fa-light fa-xmark"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useToastStore } from '@/stores/toast';
const toastStore = useToastStore();

const severityClass = (sev) => ({
  'bg-blue-700': sev === 'info',
  'bg-gray-200': sev === 'success',
  'bg-amber-700': sev === 'warn',
  'bg-red-700': sev === 'error'
});

const iconClass = (sev) => ({
  'fa-light fa-circle-info text-blue-600': sev === 'info',
  'fa-light fa-circle-check text-gray-700': sev === 'success',
  'fa-light fa-triangle-exclamation text-amber-500': sev === 'warn',
  'fa-light fa-circle-exclamation text-red-500': sev === 'error'
});
</script>