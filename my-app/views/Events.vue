<!-- src/views/Events.vue -->
<template>
  <div class="events">
    <h1 class="page-title">System Events</h1>

    <Card>
      <template #title>Event Log</template>
      <template #content>
        <p>System event log coming soon...</p>
        <p class="text-sm mt-2" style="color: #6b7280">
          Dispatch history, errors, and system events will be displayed here
        </p>
      </template>
    </Card>
  </div>
</template>

<script setup>
import Card from 'primevue/card';
</script>

<style scoped>
.page-title {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: #111827;
}
</style>