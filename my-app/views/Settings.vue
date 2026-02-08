<template>
  <div class="settings-page">
    <div class="page-header mb-4">
      <h1>Systeeminstellingen</h1>
      <p class="text-secondary">Beheer de configuratie van Wolffie en modules.</p>
    </div>

    <TabView scrollable>
      <TabPanel 
        v-for="module in settingsModules" 
        :key="module.module_id"
        :header="module.module_name"
        :disabled="!module.enabled"
      >
        <div class="p-3">
          <div v-if="!module.enabled" class="p-message p-message-info mb-3">
            <i class="pi pi-info-circle mr-2"></i>
            Module uitgeschakeld. Activeer deze bij 'Modules'.
          </div>
          <UniversalSettingsPanel :module-id="module.module_id" />
        </div>
      </TabPanel>

      <TabPanel header="Systeem" leftIcon="pi pi-cog">
        <div class="p-3">
          <CoreSettings />
        </div>
      </TabPanel>

      <TabPanel header="Gebruikers" leftIcon="pi pi-users">
        <div class="p-3">
          <UserSettings />
        </div>
      </TabPanel>

      <TabPanel header="Modules" leftIcon="pi pi-th-large">
        <div class="p-3">
          <ModuleManagement />
        </div>
      </TabPanel>
    </TabView>
    
    <ConfirmDialog />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import apiClient from '@/services/api';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import ConfirmDialog from 'primevue/confirmdialog';
import { useToast } from 'primevue/usetoast';

import UniversalSettingsPanel from '@/components/settings/universalSettingsPanel.vue';
import ModuleManagement from '@/components/settings/ModuleManagement.vue';
import CoreSettings from '@/components/settings/CoreSettings.vue';
import UserSettings from '@/components/settings/UserSettings.vue';

const toast = useToast();
const settingsModules = ref([]);

async function loadConfigurableModules() {
  try {
    const { data } = await apiClient.get('/settings/modules');
    // Filter core en users eruit omdat ze hun eigen tabs hebben
    settingsModules.value = data.modules.filter(m => 
      m.has_schema && m.module_id !== 'core' && m.module_id !== 'users'
    );
  } catch (error) {
    console.error('Fout bij laden modules:', error);
  }
}

onMounted(loadConfigurableModules);
</script>

<style scoped>
.settings-page {
  padding: 1.5rem;
  max-width: 1900px;
  margin: 0 auto;
}

.page-header h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
}

:deep(.p-tabview-panels) {
  background: transparent;
  padding: 1rem 0;
}

:deep(.p-tabview-nav) {
  background: transparent;
}
</style>