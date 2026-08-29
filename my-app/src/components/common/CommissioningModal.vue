<template>
  <div v-if="visible" class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
    <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
      
      <div class="fixed inset-0 bg-secondary-500 bg-opacity-75 transition-opacity" aria-hidden="true" @click="close"></div>

      <span class="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
      <div class="inline-block align-bottom bg-card rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
        <div class="bg-card px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
          <div class="sm:flex sm:items-start">
            <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
              <h3 class="text-lg leading-6 font-medium text-secondary-900" id="modal-title">
                Commission New Matter Device
              </h3>
              
              <div class="mt-6 space-y-4">
                <div>
                  <label class="block text-sm font-semibold text-secondary-700 mb-1">Device Name</label>
                  <input 
                    type="text" 
                    v-model="form.name"
                    placeholder="e.g. SwitchBot Plug"
                    class="block w-full border border-secondary-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label class="block text-sm font-semibold text-secondary-700 mb-1">Pairing Code</label>
                  <input 
                    type="text" 
                    v-model="form.pairingCode"
                    placeholder="1389-872-2385"
                    class="block w-full border border-secondary-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  <p class="mt-1 text-xs text-secondary-500">
                    Use the 11-digit code from the SwitchBot app "Share via Matter" screen.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-secondary-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
          <button 
            type="button" 
            @click="submit"
            :disabled="loading || !isValid"
            class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
          >
            <span v-if="loading" class="mr-2">⌛</span>
            {{ loading ? 'Commissioning...' : 'Start Commissioning' }}
          </button>
          <button 
            type="button" 
            @click="close"
            class="mt-3 w-full inline-flex justify-center rounded-md border border-secondary-300 shadow-sm px-4 py-2 bg-card text-base font-medium text-secondary-700 hover:bg-secondary-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import apiClient from '@/services/api'; // Correctly using your apiClient

const props = defineProps({
  visible: Boolean
});

const emit = defineEmits(['update:visible', 'success', 'error']);

const loading = ref(false);
const form = ref({
  name: '',
  pairingCode: ''
});

const isValid = computed(() => {
  return form.value.name.trim().length > 0 && form.value.pairingCode.trim().length >= 8;
});

const close = () => {
  form.value = { name: '', pairingCode: '' };
  emit('update:visible', false);
};

const submit = async () => {
  loading.value = true;
  try {
    // Matches the verified Postman body: {"pairingCode": "...", "name": "..."}
    const response = await apiClient.post('/api/matter/commission', {
      pairingCode: form.value.pairingCode,
      name: form.value.name
    });

    if (response.data.success) {
      emit('success', response.data);
      close();
    }
  } catch (err) {
    const errorMsg = err.response?.data?.error || err.message;
    emit('error', errorMsg);
  } finally {
    loading.value = false;
  }
};
</script>