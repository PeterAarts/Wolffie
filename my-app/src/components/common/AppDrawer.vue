<!-- src/components/ui/AppDrawer.vue -->
<!--
  Reusable slide-in drawer (right side).

  Props:
    visible  (Boolean) – controls visibility, supports v-model:visible
    title    (String)  – header title

  Emits:
    update:visible  – when the user closes the drawer

  Slots:
    default  – drawer body content
    footer   – optional custom footer (falls back to a close button)

  Usage:
    <AppDrawer v-model:visible="open" title="Edit device">
      <p>Form goes here</p>
      <template #footer>
        <button @click="open = false">Cancel</button>
        <button @click="save">Save</button>
      </template>
    </AppDrawer>
-->
<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="visible"
        class="drawer-backdrop"
        @click.self="close"
      >
        <Transition name="drawer-slide" appear>
          <aside v-if="visible" class="drawer">

            <!-- Header -->
            <div class="drawer__header">
              <span class="drawer__title">{{ title }}</span>
              <button class="icon-btn" :aria-label="t('common.close')" @click="close">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
            </div>

            <!-- Body -->
            <div class="drawer__body">
              <slot />
            </div>

            <!-- Footer -->
            <div class="drawer__footer">
              <slot name="footer">
                <button class="btn btn--sm" @click="close">{{ t('common.close') }}</button>
              </slot>
            </div>

          </aside>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const props = defineProps({
  visible: { type: Boolean, required: true },
  title:   { type: String,  default: '' },
});

const emit = defineEmits(['update:visible']);

function close() {
  emit('update:visible', false);
}
</script>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.2);
  z-index: 9000;
  display: flex;
  justify-content: flex-end;
}

.drawer {
  width: 600px;
  max-width: 100vw;
  height: 100%;
  background: #fff;
  border-left: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

/* Transitions */
.drawer-fade-enter-active,
.drawer-fade-leave-active  { transition: opacity 0.2s ease; }
.drawer-fade-enter-from,
.drawer-fade-leave-to      { opacity: 0; }

.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.2s ease; }
.drawer-slide-enter-from,
.drawer-slide-leave-to     { transform: translateX(100%); }

/* Header */
.drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.125rem 1.25rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.drawer__title { font-size: 0.9375rem; font-weight: 600; color: #111827; }

/* Body */
.drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Footer */
.drawer__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

/* Icon button (close) */
.icon-btn {
  width: 26px; height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  cursor: pointer;
  border: none;
  background: transparent;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover { color: #111827; background: #f3f4f6; }

/* Shared button styles (mirrored from control.css for self-contained use) */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4375rem 0.875rem;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  color: #374151;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover:not(:disabled) { background: #f9fafb; border-color: #9ca3af; }
.btn--sm { padding: 0.3125rem 0.625rem; font-size: 0.78125rem; }
</style>