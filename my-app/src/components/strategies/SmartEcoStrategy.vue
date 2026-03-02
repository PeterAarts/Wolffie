<template>
  <div class="smart-eco-strategy">
    <Card class="mb-4 bg-blue-50">
      <template #title>Energy Projection</template>
      <template #content>
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm text-gray-600">Avg. Usage until 09:00</p>
            <p class="text-2xl font-bold">{{ projection.avgUsage }} kWh</p>
          </div>
          <div class="text-right">
            <p class="text-sm text-gray-600">Current Battery</p>
            <p class="text-2xl font-bold" :class="projection.isSafe ? 'text-green-600' : 'text-red-600'">
              {{ projection.currentEnergy }} kWh
            </p>
          </div>
        </div>
        <ProgressBar :value="projection.coveragePercent" class="mt-3" />
      </template>
    </Card>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="field in strategyFields" :key="field.key">
        <UniversalField 
          v-model="localSettings[field.key]" 
          :field="field"
        />
      </div>
    </div>

    <div class="flex justify-end gap-2 mt-6">
      <Button label="Cancel" class="p-button-text" @click="$emit('cancel')" />
      <Button 
        label="Save Strategy" 
        icon="pi pi-save" 
        :loading="saving"
        @click="saveSettings" 
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import UniversalField from '@/components/settings/UniversalField.vue';

const settingsStore = useSettingsStore();
const saving = ref(false);
const localSettings = ref({});

const strategyFields = [
  { key: 'morning_buffer_time', label: 'Morning Target Time', component: 'text', placeholder: '09:00' },
  { key: 'solar_trust_factor', label: 'Solar Forecast Buffer (%)', component: 'slider', validation: { min: 0, max: 100 } },
  { key: 'block_grid_export', label: 'Disable Grid Export', component: 'switch' },
  { key: 'price_cap_charge', label: 'Max Grid Charge Price', component: 'number', suffix: '€', decimals: 2 }
];

// Fetch existing settings from the 'smart_eco' category
onMounted(async () => {
  const data = await settingsStore.fetchCategory('smart_eco');
  localSettings.value = { ...data };
});

const saveSettings = async () => {
  saving.value = true;
  try {
    // Uses your existing service layer logic
    await settingsStore.updateCategory('smart_eco', localSettings.value);
  } finally {
    saving.value = false;
  }
};
</script>