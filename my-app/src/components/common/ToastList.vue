<!-- /components/common/ToastList.vue -->

<template>
  <div class="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 w-full max-w-sm ">
    <transition-group 
      enter-active-class="transform ease-out duration-3000 transition"
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div 
        v-for="toast in toastStore.toasts" 
        :key="toast.id"
        :class="[severityClass(toast.severity)]"
        class="p-4 flex items-start gap-4 overflow-hidden relative rounded-md shadow-xl "
        
      >
        <!--<div :class="['absolute left-0 top-0 bottom-0 w-1.5', severityClass(toast.severity)]"></div>-->
        
        <div class="flex-1">
          <!--<div class="flex items-center gap-2 mb-1">
            <i :class="[iconClass(toast.severity), 'text-lg']"></i>
            <span class="text-md font-medium text-slate-800">{{ toast.summary }}</span>
          </div>-->
          <p class="text-md font-medium "><i :class="[iconClass(toast.severity), 'text-lg']"></i>
            <span class="text-md font-medium px-4 "> {{ toast.summary }}</span> :   
            <span class="text-md font-normal px-4 "> {{ toast.detail }}</span>
          </p>

          <!-- Action buttons — only rendered when toast has actions -->
          <div v-if="toast.actions?.length" class="flex gap-2 mt-3">
            <button
              v-for="action in toast.actions"
              :key="action.label"
              class="toast-action-btn"
              :class="action.variant === 'primary' ? 'toast-action-btn--primary' : 'toast-action-btn--secondary'"
              @click="handleAction(toast, action)"
            >
              <i v-if="action.icon" :class="['ph-light mr-1', action.icon]"></i>
              {{ action.label }}
            </button>
          </div>
        </div>

        <button @click="toastStore.remove(toast.id)" class="text-slate-300 hover:text-slate-900 transition-colors">
          <i class="ph-light ph-xmark"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useToastStore } from '@/stores/toast';
const toastStore = useToastStore();

const severityClass = (sev) => ({
  'bg-blue-100  text-blue-900 border-l-4 border-blue-700': sev === 'info',
  'bg-green-100 text-green-900 border-l-4 border-green-700': sev === 'success',
  'bg-amber-100 text-amber-900 border-l-4 border-amber-700': sev === 'warn',
  'bg-red-100   text-red-900 border-l-4 border-red-700': sev === 'error'
});

const iconClass = (sev) => ({
  'ph-light ph-info text-blue-900': sev === 'info',
  'ph-light ph-check text-green-900': sev === 'success',
  'ph-light ph-warning text-amber-900': sev === 'warn',
  'ph-light ph-warning-diamond text-red-900': sev === 'error'
});

function handleAction(toast, action) {
  // Call handler — if it returns false, keep the toast open
  const result = action.handler?.();
  if (result !== false) {
    toastStore.remove(toast.id);
  }
}
</script>

<style scoped>
.toast-action-btn {
  display: inline-flex; align-items: center;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem; font-weight: 600;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: opacity 0.15s;
}
.toast-action-btn:hover { opacity: 0.85; }
.toast-action-btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.toast-action-btn--secondary {
  background: transparent;
  border-color: var(--color-secondary-300);
  color: var(--color-text-secondary);
}
</style>