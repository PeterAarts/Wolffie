<template>
  <div class="core-settings">
    <div class="section-header mb-4">
      <h3>Systeemconfiguratie</h3>
      <p class="text-secondary">Beheer de basisinstellingen van het Wolffie platform.</p>
    </div>
    
    <UniversalSettingsPanel module-id="core" />
    
    <div class="system-actions mt-4 p-3 border-top">
      <Button label="Systeem Herstarten" icon="pi pi-refresh" severity="danger" text />
    </div>
  </div>
</template>

<script setup>
import UniversalSettingsPanel from './UniversalSettingsPanel.vue';

</script>