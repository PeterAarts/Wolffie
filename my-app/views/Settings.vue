<template>
  <div class="flex flex-col md:flex-row min-h-screen text-gray-900">
    <aside class="w-full md:w-72 border-r bg-gray-100 border-gray-200 flex-shrink-0 flex flex-col">
      <div class="p-6 border-b border-gray-100">
        <h4 class="text-md font-bold text-gray-900 flex items-center gap-3">
          <span>Instellingen</span>
        </h4>
      </div>

      <nav class="flex-1 overflow-y-auto p-4 space-y-4">
        <p class="p-4 text-xs font-normal text-gray-400 lowercase tracking-wider mb-2">Systeem</p>
        
        <button v-for="item in staticMenu" :key="item.id"
          @click="activeModuleId = item.id"
          class="w-full flex items-center p-3 transition-all duration-200 group"
          :class="activeModuleId === item.id ? 'bg-gray-200' : 'hover:bg-gray-200 text-gray-900'">
   <!--       <i :class="[item.icon, 'w-6 text-lg', activeModuleId === item.id ? 'text-white' : 'text-gray-500 group-hover:text-gray-900']"></i>-->
          <span class="p-2 font-medium text-gray-600">{{ item.label }}</span>
        </button>

        <div class="my-6 border-t border-gray-100"></div>

        <p class="p-4 text-xs font-normal text-gray-400 lowercase tracking-wider mb-2">Modules</p>
        
        <button v-for="mod in settingsModules" :key="mod.module_id"
          @click="activeModuleId = mod.module_id"
          class="w-full flex items-center p-2 transition-all duration-200 group"
          :class="[
            activeModuleId === mod.module_id ? 'bg-gray-200' : 'hover:bg-gray-200 text-gray-900',
            !mod.enabled ? 'opacity-50 grayscale' : ''
          ]">
          <!--<i :class="[getModuleIcon(mod), 'w-6 text-lg', activeModuleId === mod.module_id ? 'text-white' : 'text-gray-500 group-hover:text-gray-900']"></i>-->
          <span class="ml-3 font-medium text-gray-600 ">{{ mod.module_name }}</span>
          <span v-if="!mod.enabled" class="ml-auto text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">OFF</span>
        </button>
      </nav>
    </aside>

    <main class="flex-1 overflow-y-auto bg-white">
      <div class="max-w-6xl mx-auto p-6 md:p-10">
        
        <div class="mb-8 flex justify-between items-end">
          <div>
            <h4 class="font-bold text-xl text-gray-900 tracking-tight">{{ activeLabel }}</h4>
          </div>
        </div>

        <div class="bg-white  overflow-hidden">
          <div class="">
            <div v-if="activeModuleId === 'core'">
              <CoreSettings />
            </div>
            <div v-else-if="activeModuleId === 'users'">
              <UserSettings />
            </div>
            <div v-else-if="activeModuleId === 'modules'">
              <ModuleManagement />
            </div>
            <div v-else>
              <UniversalSettingsPanel :key="activeModuleId" :module-id="activeModuleId" />
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import apiClient from '@/services/api';
import UniversalSettingsPanel from '@/components/settings/universalSettingsPanel.vue';
import CoreSettings from '@/components/settings/CoreSettings.vue';
import UserSettings from '@/components/settings/UserSettings.vue';
import ModuleManagement from '@/components/settings/ModuleManagement.vue';

const activeModuleId = ref('core');
const settingsModules = ref([]);

const staticMenu = [
  { id: 'core', label: 'Algemeen', icon: 'fa-duotone fa-server' },
  { id: 'users', label: 'Gebruikers', icon: 'fa-duotone fa-users-gear' },
  { id: 'modules', label: 'Module Beheer', icon: 'fa-duotone fa-grid-2-plus' }
];

const activeLabel = computed(() => {
  const combined = [...staticMenu, ...settingsModules.value.map(m => ({ id: m.module_id, label: m.module_name }))];
  return combined.find(i => i.id === activeModuleId.value)?.label || 'Instellingen';
});

function getModuleIcon(mod) {
  // Map module IDs to FontAwesome Pro icons
  const icons = {
    'homewizard': 'fa-duotone fa-plug-circle-bolt',
    'alphaess-cloud': 'fa-duotone fa-cloud-sun',
    'solaredge': 'fa-duotone fa-solar-panel'
  };
  return icons[mod.module_id] || 'fa-duotone fa-box-open';
}

async function loadConfigurableModules() {
  try {
    const { data } = await apiClient.get('/settings/modules');
    // Filter to show only dynamic modules in this section
    settingsModules.value = data.modules.filter(m => 
      m.has_schema && m.module_id !== 'core' && m.module_id !== 'users'
    );
  } catch (err) { console.error('Failed to load modules', err); }
}

onMounted(loadConfigurableModules);
</script>