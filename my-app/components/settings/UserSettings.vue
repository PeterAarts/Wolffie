<template>
  <div class="user-settings">
    <div class="section-header mb-4">
      <h3>Gebruikersbeheer</h3>
      <p class="text-secondary">Beheer accounts en autorisatieniveaus voor dit systeem.</p>
    </div>

    <UniversalSettingsPanel module-id="users" />

    </div>
</template>

<script setup>
import UniversalSettingsPanel from './UniversalSettingsPanel.vue';


</script>