import { defineStore } from 'pinia';

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: []
  }),
  actions: {
    /**
     * Add a toast notification.
     *
     * @param {object} options
     * @param {string}   options.severity  - 'info' | 'success' | 'warn' | 'error'
     * @param {string}   options.summary   - Bold title line
     * @param {string}   options.detail    - Body text
     * @param {number}   options.life      - Ms before auto-dismiss. 0 = persistent (default 4000)
     * @param {Array}    options.actions   - Optional buttons: [{ label, icon, handler }]
     *                                       Clicking a button auto-dismisses the toast
     *                                       unless handler returns false.
     */
    add({ severity = 'info', summary, detail, life = 4000, actions = [] }) {
      const id = Date.now();
      this.toasts.push({ id, severity, summary, detail, actions });

      // life = 0 means persistent — only dismissed manually or via action button
      if (life > 0) {
        setTimeout(() => this.remove(id), life);
      }
    },

    remove(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }
  }
});