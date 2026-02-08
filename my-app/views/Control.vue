<template>
  <div class="p-8 w-full min-h-screen bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">
    <h1 class="text-xl font-light mb-6 uppercase tracking-widest border-b border-zinc-200 dark:border-zinc-800 pb-2">
      System Control
    </h1>

    <div class="grid grid-cols-12 gap-4">
      
      <div class="col-span-12 md:col-span-6 lg:col-span-3">
        <Card class="h-full border border-zinc-200 shadow-none bg-zinc-100">
          <template #title>
            <div class="flex justify-between items-center text-[10px] uppercase tracking-wider text-zinc-500">
              <span>Strategy</span>
              <InputSwitch 
                :modelValue="!strategyStore.isManualOverride" 
                @update:modelValue="handleOverrideToggle"
                class="scale-75"
              />
            </div>
          </template>
          <template #content>
            <div class="flex flex-col gap-4 text-center">
              <div class="py-2">
                <div class="text-[10px] text-zinc-400 uppercase">Target Buffer</div>
                <div class="text-3xl font-light tracking-tighter">{{ strategyStore.formattedTargetBuffer }}</div>
              </div>
              <div class="p-2 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-500 italic border border-zinc-200 dark:border-zinc-700">
                "{{ strategyStore.reasoning }}"
              </div>
            </div>
          </template>
        </Card>
      </div>

      <div class="col-span-12 md:col-span-6 lg:col-span-3">
        <Card class="h-full border border-zinc-200  shadow-none">
          <template #title>
            <div class="flex justify-between items-center text-[10px] uppercase tracking-wider text-zinc-500">
              <span>SolarEdge</span>
              <InputSwitch v-model="autoCurtail" :disabled="strategyStore.isManualOverride" class="scale-75" />
            </div>
          </template>
          <template #content>
            <div class="flex flex-col gap-4">
              <div class="flex justify-between items-end">
                <span class="text-[10px] uppercase text-zinc-400">Power Limit</span>
                <span class="text-xl font-light">{{ solarPowerLimit }}%</span>
              </div>
              <Slider v-model="solarPowerLimit" :disabled="!strategyStore.isManualOverride" class="w-full my-2" @slideend="updateSolarLimit" />
              <div class="text-[9px] uppercase tracking-tight text-center text-zinc-400">
                {{ strategyStore.isManualOverride ? 'Manual Override Active' : 'Managed by System' }}
              </div>
            </div>
          </template>
        </Card>
      </div>

      <div class="col-span-12 md:col-span-6 lg:col-span-3">
        <Card class="h-full border border-zinc-200 dark:border-zinc-800 shadow-none">
          <template #title>
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">Manual Charge</div>
          </template>
          <template #content>
            <div class="flex flex-col gap-3">
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Watts</label>
                  <InputNumber v-model="chargePower" class="w-full" inputClass="py-1 text-sm border-zinc-200 dark:border-zinc-700" />
                </div>
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Limit %</label>
                  <InputNumber v-model="targetSoc" class="w-full" inputClass="py-1 text-sm border-zinc-200 dark:border-zinc-700" />
                </div>
              </div>
              <Button label="Execute" severity="secondary" outlined class="w-full uppercase text-[10px] tracking-widest py-2" @click="handleGridCharge" />
            </div>
          </template>
        </Card>
      </div>

      <div class="col-span-12 md:col-span-6 lg:col-span-3 flex flex-col gap-2">
        <Button @click="handleStop" severity="secondary" outlined class="flex-1 py-3 uppercase text-[10px] tracking-widest" :disabled="!systemStore.dispatchStatus?.active">
          <i class="pi pi-stop mr-2"></i> Stop
        </Button>
        <Button @click="handlePreventDischarge" severity="secondary" outlined class="flex-1 py-3 uppercase text-[10px] tracking-widest">
          <i class="pi pi-lock mr-2"></i> Lock Discharge
        </Button>
        <Button @click="handleNormal" severity="secondary" class="flex-1 py-3 uppercase text-[10px] tracking-widest bg-zinc-800 text-white dark:bg-zinc-200 dark:text-black border-none">
          <i class="pi pi-check mr-2"></i> Normal Mode
        </Button>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useStrategyStore } from '@/stores/strategy';
import { useSystemStore } from '@/stores/system';
import { useToast } from 'primevue/usetoast';
import socket from '@/services/websocket';

const strategyStore = useStrategyStore();
const systemStore = useSystemStore();
const toast = useToast();

const chargePower = ref(3000);
const targetSoc = ref(100);
const solarPowerLimit = ref(100);
const autoCurtail = ref(true);

const handleOverrideToggle = (isAuto) => {
  strategyStore.toggleManualOverride(!isAuto);
};

const updateSolarLimit = () => {
  if (!strategyStore.isManualOverride) return;
  socket.emit('inverter_control', { device: 'solaredge', command: 'SET_POWER_LIMIT', value: solarPowerLimit.value });
};

async function handleGridCharge() {
  socket.emit('battery_control', { command: 'CHARGE_FROM_GRID', power: chargePower.value, targetSoc: targetSoc.value });
}

async function handleStop() { await systemStore.stopDispatch(); }
async function handlePreventDischarge() { await systemStore.preventDischarge(); }
async function handleNormal() { await systemStore.normalOperation(); }
</script>

<style scoped>
/* Forceer monochroom voor PrimeVue elementen */
:deep(.p-inputswitch.p-inputswitch-checked .p-inputswitch-slider) {
  background: #3f3f46 !important; /* Zinc-700 */
}

:deep(.p-slider .p-slider-range) {
  background: #3f3f46 !important;
}

:deep(.p-slider .p-slider-handle) {
  border-color: #3f3f46 !important;
}

:deep(.p-card .p-card-body) {
  padding: 1rem;
}

:deep(.p-card .p-card-title) {
  margin-bottom: 0.5rem;
}
</style>