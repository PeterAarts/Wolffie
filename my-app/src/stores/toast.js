import { defineStore } from 'pinia';

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: []
  }),
  actions: {
    add({ severity = 'info', summary, detail, life = 3000 }) {
      const id = Date.now();
      this.toasts.push({ id, severity, summary, detail });

      // Auto-remove after 'life' duration
      setTimeout(() => {
        this.remove(id);
      }, life);
    },
    remove(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }
  }
});