<template>
  <div class="settings-page">
    <TabView>
      <!-- Core System Settings -->
      <TabPanel header="System" icon="pi-cog">
        <UniversalSettingsPanel module-id="core" />
      </TabPanel>

      <!-- Module Management -->
      <TabPanel header="Modules" icon="pi-box">
        <ModuleManagement />
      </TabPanel>

      <!-- Dynamic Module Tabs (loaded from API) -->
      <TabPanel 
        v-for="module in enabledModules" 
        :key="module.module_id"
        :header="module.module_name"
        :disabled="!module.enabled"
      >
        <UniversalSettingsPanel :module-id="module.module_id" />
      </TabPanel>

      <!-- User Management -->
      <TabPanel header="Users" icon="pi-users">
        <UniversalSettingsPanel module-id="users" />
      </TabPanel>
    </TabView>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import UniversalSettingsPanel from '@/components/settings/UniversalSettingsPanel.vue';
import ModuleManagement from '@/components/settings/ModuleManagement.vue';

const enabledModules = ref([]);

onMounted(async () => {
  // Load module list
  const { data } = await axios.get('/api/settings/modules');
  enabledModules.value = data.modules.filter(m => m.enabled && m.has_ui);
});
</script>