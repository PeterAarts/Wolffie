<!-- src/components/ui/AppModal.vue -->
<!--
  Reusable confirm/alert modal.

  Props:
    visible     (Boolean)        – controls visibility, supports v-model:visible
    message     (String)         – body text
    confirmLabel (String)        – confirm button label   (default: t('common.confirm'))
    cancelLabel  (String)        – cancel button label    (default: t('common.cancel'))
    destructive  (Boolean)       – style confirm as destructive (red)
    busy         (Boolean)       – show spinner on confirm button

  Emits:
    update:visible  – when closed
    confirm         – when the confirm button is clicked
    cancel          – when cancelled (also closes)

  Slot:
    default  – optional rich body content (overrides `message` prop)

  Usage (simple):
    <AppModal
      v-model:visible="showRemove"
      :message="`Remove ${item.name}?`"
      destructive
      :busy="removing"
      @confirm="doRemove"
    />

  Usage (rich body):
    <AppModal v-model:visible="showTerms" confirm-label="Accept">
      <p>Long terms text…</p>
    </AppModal>
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="modal-backdrop"
        @click.self="cancel"
      >
        <div class="modal" role="dialog" aria-modal="true">

          <div class="modal__body">
            <slot>
              <p class="modal__message">{{ message }}</p>
            </slot>
          </div>

          <div class="modal__actions">
            <button class="btn btn--sm" @click="cancel">
              {{ cancelLabel || t('common.cancel') }}
            </button>
            <button
              class="btn btn--sm"
              :class="destructive ? 'btn--destructive' : 'btn--primary'"
              @click="confirm"
            >
              {{ confirmLabel || t('common.confirm') }}
            </button>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useLocale } from '@/composables/useLocale';

const { t } = useLocale();

const props = defineProps({
  visible:      { type: Boolean, required: true },
  message:      { type: String,  default: '' },
  confirmLabel: { type: String,  default: '' },
  cancelLabel:  { type: String,  default: '' },
  destructive:  { type: Boolean, default: false },
  busy:         { type: Boolean, default: false },
});

const emit = defineEmits(['update:visible', 'confirm', 'cancel']);

function confirm() {
  emit('confirm');
}

function cancel() {
  emit('update:visible', false);
  emit('cancel');
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.25);
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1.5rem;
  width: 500px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

.modal__body { margin-bottom: 1.25rem; }

.modal__message {
  font-size: 0.875rem;
  color: #374151;
  line-height: 1.55;
  margin: 0;
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Transition */
.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.15s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to     { opacity: 0; }

/* Buttons */
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
.btn--primary { background: #111827; border-color: #111827; color: #fff; }
.btn--primary:hover:not(:disabled) { background: #1f2937; border-color: #1f2937; }
.btn--destructive { color: #991b1b; border-color: #fca5a5; background: #fef2f2; }
.btn--destructive:hover:not(:disabled) { background: #fee2e2; border-color: #f87171; }
.btn--busy { opacity: 0.6; pointer-events: none; }
</style>