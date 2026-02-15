<template>
  <div class="p-8 w-full min-h-screen bg-white dark:bg-black text-zinc-900 dark:text-zinc-100">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      
      <div class="w-full">
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

      <div class="w-full">
        <Card class="h-full border border-zinc-200 shadow-none">
          <template #title>
            <div class="flex justify-between items-center text-[10px] uppercase tracking-wider text-zinc-500">
              <span>RS485 Connection</span>
              <Tag :severity="rs485Connected ? 'success' : 'danger'" :value="rs485Connected ? 'ONLINE' : 'OFFLINE'" class="text-[8px]" />
            </div>
          </template>
          <template #content>
            <div class="flex flex-col gap-4">
              <div class="flex flex-col">
                <label class="text-[9px] uppercase text-zinc-400 mb-1">Serial Port</label>
                <InputText v-model="rs485Config.port" placeholder="/dev/ttyUSB0" class="p-inputtext-sm" />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Baudrate</label>
                  <Dropdown v-model="rs485Config.baudrate" :options="[9600, 19200, 38400, 115200]" class="text-xs" />
                </div>
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Slave ID</label>
                  <InputNumber v-model="rs485Config.slave_id" :min="1" :max="247" class="w-full" inputClass="py-1 text-sm" />
                </div>
              </div>
              <Button 
                :label="rs485Connected ? 'Reconnect' : 'Connect RS485'" 
                severity="secondary" 
                outlined 
                class="w-full text-[10px] tracking-widest py-2" 
                @click="handleRS485Update" 
              />
            </div>
          </template>
        </Card>
      </div>

      <div class="w-full">
        <Card class="h-full border border-zinc-200 dark:border-zinc-800 shadow-none">
          <template #title>
            <div class="text-[10px] uppercase tracking-wider text-zinc-500">Battery Command</div>
          </template>
          <template #content>
            <div class="flex flex-col gap-3">
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Watts</label>
                  <InputNumber v-model="chargePower" class="w-full" inputClass="py-1 text-sm" />
                </div>
                <div class="flex flex-col">
                  <label class="text-[9px] uppercase text-zinc-400 mb-1">Limit %</label>
                  <InputNumber v-model="targetSoc" class="w-full" inputClass="py-1 text-sm" />
                </div>
              </div>
              <Button label="Force Grid Charge" severity="secondary" outlined class="w-full uppercase text-[10px] tracking-widest py-2" @click="handleGridCharge" />
            </div>
          </template>
        </Card>
      </div>

      <div class="w-full flex flex-col gap-2">
        <Button @click="handleStop" severity="secondary" outlined class="flex-1 py-3 uppercase text-[10px] tracking-widest" :disabled="!systemStore.status.isConnected">
          <i class="pi pi-stop mr-2"></i> Stop Dispatch
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
import { ref, reactive, onMounted } from 'vue';
import { useStrategyStore } from '@/stores/strategy';
import { useSystemStore } from '@/stores/system';
import socket from '@/services/websocket';
import apiClient from '@/services/api';

const strategyStore = useStrategyStore();
const systemStore = useSystemStore();


// Local State for RS485 module
const rs485Connected = ref(false);
const rs485Config = reactive({
  port: '/dev/ttyUSB0',
  baudrate: 9600,
  slave_id: 1
});

const chargePower = ref(3000);
const targetSoc = ref(100);

onMounted(async () => {
  // Check if RS485 module is enabled and get settings
  try {
    const response = await apiClient.get('/system/collector-status');
    // Assuming the collector-status returns which module is active
    if (response.data.activeModule === 'alphaess-modbus-rs485') {
      rs485Connected.value = response.data.connected;
    }
  } catch (err) {
    console.error('Failed to fetch module status', err);
  }
});

/**
 * Update RS485 settings in the backend module
 */
async function handleRS485Update() {
  try {
    // Send configuration to the dedicated RS485 routes
    await apiClient.post('/alphaess-modbus-rs485/settings', rs485Config);
    
    toast.add({ 
      severity: 'success', 
      summary: 'Config Updated', 
      detail: 'RS485 settings applied. Restarting collector...', 
      life: 3000 
    });
    
    // Trigger a module restart via socket or API
    socket.emit('module_control', { module: 'alphaess-modbus-rs485', command: 'RESTART' });
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to update RS485 settings', life: 3000 });
  }
}

const handleOverrideToggle = (isAuto) => {
  strategyStore.toggleManualOverride(!isAuto);
};

async function handleGridCharge() {
  // Use the systemStore's connection state to validate
  if (!systemStore.isConnected) {
    toast.add({ severity: 'warn', summary: 'Offline', detail: 'System is not connected', life: 3000 });
    return;
  }
  
  // Emit battery control through the RS485 protocol
  socket.emit('battery_control', { 
    device: 'alphaess-rs485', 
    command: 'CHARGE_FROM_GRID', 
    power: chargePower.value, 
    targetSoc: targetSoc.value 
  });
}

async function handleStop() { await systemStore.stopDispatch(); }
async function handlePreventDischarge() { await systemStore.preventDischarge(); }
async function handleNormal() { await systemStore.normalOperation(); }
</script>