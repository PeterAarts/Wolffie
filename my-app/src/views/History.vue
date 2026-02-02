<!-- src/views/History.vue -->
<template>
  <div class="history">
    <!-- Date/period selector -->
    <PeriodSelector @change="handlePeriodChange" />
    
    <!-- Reusable graph component -->
    <EnergyFlowGraph 
      :period="selectedPeriod" 
      :date="selectedDate"
      :auto-update="false"
    />
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
.history {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1rem;
  background-color:#fff;
  height: calc(100vh - 6rem);
}
</style>