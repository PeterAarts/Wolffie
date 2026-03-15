<template>
  <div class="flex flex-col md:flex-row  text-gray-900">
    <aside class="w-full md:w-64  bg-gray-100  flex-shrink-0 flex flex-col">
    <!--  <div class="p-6 border-b border-gray-100">
        <h4 class="text-md font-bold text-gray-900 flex items-center gap-3">
          <span>Instellingen</span>
        </h4>
      </div>-->

      <nav class="flex-1 overflow-y-auto p-4 pe-0 space-y-4 settingsmenu">
        <p class="p-4 text-xs font-normal text-gray-500 lowercase border-b border-gray-200 tracking-wider mb-2">{{ t('settings.system') }}</p>
        
        <button v-for="item in staticMenu" :key="item.id"
          @click="activeModuleId = item.id"
          class="w-full flex items-center p-2 transition-all duration-200 group text-sm"
          :class="activeModuleId === item.id ? 'bg-white' : 'hover:bg-gray-200 text-gray-900'">
   <!--       <i :class="[item.icon, 'w-6 text-lg', activeModuleId === item.id ? 'text-white' : 'text-gray-500 group-hover:text-gray-900']"></i>-->
          <span class="p-2 font-medium text-gray-700">{{ item.label }}</span>
        </button>

        <div class="my-6 border-t border-gray-100"></div>

        <p class="p-4 text-xs font-normal text-gray-500 lowercase border-b border-gray-200 tracking-wider mb-2">{{ t('settings.modules') }}</p>
        
        <button v-for="mod in settingsModules" :key="mod.module_id"
          @click="activeModuleId = mod.module_id"
          class="w-full flex items-center p-4 transition-all duration-200 group text-sm text-gray-700"
          :class="[
            activeModuleId === mod.module_id ? 'bg-white' : 'hover:bg-gray-200 text-gray-700',
            !mod.enabled ? 'opacity-50 grayscale' : ''
          ]">
          <!--<i :class="[getModuleIcon(mod), 'w-6 text-lg', activeModuleId === mod.module_id ? 'text-white' : 'text-gray-500 group-hover:text-gray-900']"></i>-->
          <span class="ml-3 font-medium text-gray-700s">{{ mod.module_name }}</span>
          <span v-if="!mod.enabled" class="ml-auto text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">OFF</span>
        </button>
      </nav>
    </aside>

    <main class="flex-1 overflow-y-auto bg-white ">
      <div class="mx-auto p-6 md:p-10">
        
        <div class="flex justify-between items-end">
          <div>
            <h4 class="font-bold text-xl text-gray-900 tracking-tight">{{ activeLabel }}</h4>
          </div>
        </div>
        <div class="bg-white ">
          <div class="">
            <div v-if="activeModuleId === 'core'">
              <CoreSettings />
            </div>
            <div v-else-if="activeModuleId === 'users'">
              <UserSettings />
            </div>
            <div v-else-if="activeModuleId === 'modules'">
              <ModulesTab />
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
import { useI18n } from 'vue-i18n';
import UniversalSettingsPanel from '@/components/settings/universalSettingsPanel.vue';
import CoreSettings from '@/components/settings/CoreSettings.vue';
import UserSettings from '@/components/settings/UserSettings.vue';
import ModulesTab from '@/components/settings/ModulesTab.vue';
const { t } = useI18n();

const activeModuleId = ref('core');
const settingsModules = ref([]);

const staticMenu = [
  { id: 'core', label: t('settings.general'), icon: 'fa-light fa-server' },
  { id: 'users', label: t('settings.usermanagement'), icon: 'fa-light fa-users-gear' },
  { id: 'modules', label: t('modulesTab.install'), icon: 'fa-light fa-puzzle-piece' },
];

const activeLabel = computed(() => {
  const combined = [...staticMenu, ...settingsModules.value.map(m => ({ id: m.module_id, label: m.module_name }))];
  return combined.find(i => i.id === activeModuleId.value)?.label || t('settings.title');
});

function getModuleIcon(mod) {
  // Map module IDs to FontAwesome Pro icons
  const icons = {
    'homewizard': 'fa-light fa-plug-circle-bolt',
    'alphaess-cloud': 'fa-light fa-cloud-sun',
    'solaredge': 'fa-light fa-solar-panel'
  };
  return icons[mod.module_id] || 'fa-light fa-box-open';
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
<style scoped>
.settingsmenu         {padding-right: 0px!important;;}
</style>