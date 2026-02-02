<!-- src/views/Control.vue -->
<template>
  <div class="control">
    <h1 class="page-title">Battery Control</h1>

    <!-- Quick Actions -->
    <div class="grid grid-cols-3 mb-4">
      <Card>
        <template #content>
          <Button 
            label="Stop Dispatch" 
            icon="pi pi-stop" 
            severity="danger"
            class="w-full"
            :disabled="!systemStore.dispatchStatus.active"
            @click="handleStop"
          />
        </template>
      </Card>
      <Card>
        <template #content>
          <Button 
            label="Prevent Discharge" 
            icon="pi pi-lock" 
            severity="warning"
            class="w-full"
            @click="handlePreventDischarge"
          />
        </template>
      </Card>
      <Card>
        <template #content>
          <Button 
            label="Normal Operation" 
            icon="pi pi-check" 
            severity="success"
            class="w-full"
            @click="handleNormal"
          />
        </template>
      </Card>
    </div>

    <!-- Charge from Grid -->
    <Card class="mb-4">
      <template #title>Charge from Grid</template>
      <template #content>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block mb-2 font-semibold">Power (W)</label>
            <InputNumber 
              v-model="chargeConfig.watts" 
              :min="0" 
              :max="5000"
              :step="100"
              showButtons
              class="w-full"
            />
          </div>
          <div>
            <label class="block mb-2 font-semibold">Target SOC (%)</label>
            <Slider v-model="chargeConfig.targetSOC" :min="0" :max="100" class="w-full" />
            <span class="text-sm">{{ chargeConfig.targetSOC }}%</span>
          </div>
          <div>
            <label class="block mb-2 font-semibold">Duration (hours)</label>
            <InputNumber 
              v-model="chargeConfig.duration" 
              :min="0.5" 
              :max="24"
              :step="0.5"
              showButtons
              class="w-full"
            />
          </div>
        </div>
        <Button 
          label="Start Charging" 
          icon="pi pi-bolt" 
          class="w-full mt-4"
          @click="handleCharge"
        />
      </template>
    </Card>

    <!-- Discharge to Grid -->
    <Card>
      <template #title>Discharge to Grid</template>
      <template #content>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block mb-2 font-semibold">Power (W)</label>
            <InputNumber 
              v-model="dischargeConfig.watts" 
              :min="0" 
              :max="5000"
              :step="100"
              showButtons
              class="w-full"
            />
          </div>
          <div>
            <label class="block mb-2 font-semibold">Minimum SOC (%)</label>
            <Slider v-model="dischargeConfig.minimumSOC" :min="0" :max="100" class="w-full" />
            <span class="text-sm">{{ dischargeConfig.minimumSOC }}%</span>
          </div>
          <div>
            <label class="block mb-2 font-semibold">Duration (hours)</label>
            <InputNumber 
              v-model="dischargeConfig.duration" 
              :min="0.5" 
              :max="24"
              :step="0.5"
              showButtons
              class="w-full"
            />
          </div>
        </div>
        <Button 
          label="Start Discharging" 
          icon="pi pi-arrow-up" 
          severity="warning"
          class="w-full mt-4"
          @click="handleDischarge"
        />
      </template>
    </Card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import Slider from 'primevue/slider';

const systemStore = useSystemStore();
const toast = useToast();
const confirm = useConfirm();

const chargeConfig = ref({
  watts: 2000,
  targetSOC: 100,
  duration: 4
});

const dischargeConfig = ref({
  watts: 2000,
  minimumSOC: 20,
  duration: 2
});

async function handleCharge() {
  confirm.require({
    message: `Charge at ${chargeConfig.value.watts}W to ${chargeConfig.value.targetSOC}% for ${chargeConfig.value.duration}h?`,
    header: 'Confirm Charging',
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await systemStore.chargeFromGrid(
          chargeConfig.value.watts,
          chargeConfig.value.targetSOC,
          chargeConfig.value.duration
        );
        toast.add({
          severity: 'success',
          summary: 'Charging Started',
          detail: `Charging at ${chargeConfig.value.watts}W`,
          life: 3000
        });
      } catch (error) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message,
          life: 5000
        });
      }
    }
  });
}

async function handleDischarge() {
  confirm.require({
    message: `Discharge at ${dischargeConfig.value.watts}W to ${dischargeConfig.value.minimumSOC}% for ${dischargeConfig.value.duration}h?`,
    header: 'Confirm Discharging',
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      try {
        await systemStore.dischargeToGrid(
          dischargeConfig.value.watts,
          dischargeConfig.value.minimumSOC,
          dischargeConfig.value.duration
        );
        toast.add({
          severity: 'success',
          summary: 'Discharging Started',
          detail: `Discharging at ${dischargeConfig.value.watts}W`,
          life: 3000
        });
      } catch (error) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: error.message,
          life: 5000
        });
      }
    }
  });
}

async function handleStop() {
  try {
    await systemStore.stopDispatch();
    toast.add({
      severity: 'success',
      summary: 'Stopped',
      detail: 'Dispatch mode stopped',
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message,
      life: 5000
    });
  }
}

async function handlePreventDischarge() {
  try {
    await systemStore.preventDischarge();
    toast.add({
      severity: 'success',
      summary: 'Applied',
      detail: 'Grid discharge prevented',
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message,
      life: 5000
    });
  }
}

async function handleNormal() {
  try {
    await systemStore.normalOperation();
    toast.add({
      severity: 'success',
      summary: 'Applied',
      detail: 'Normal operation mode',
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: error.message,
      life: 5000
    });
  }
}
</script>

<style scoped>
.page-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: #111827;
}

.w-full {
  width: 100%;
}

.gap-4 {
  gap: 1rem;
}
</style>