<!-- src/views/TestPrimeVue.vue -->
<template>
  <div class="p-4">
    <h1>PrimeVue Test</h1>
    
    <Button label="Click Me" icon="pi pi-check" @click="showToast" />
    
    <Card class="mt-4">
      <template #title>Test Card</template>
      <template #content>
        <p>If you can see this styled card and button, PrimeVue is working!</p>
      </template>
    </Card>
    
    <Toast />
  </div>
</template>

<script setup>
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Toast from 'primevue/toast';

const toast = useToast();

function showToast() {
  toast.add({
    severity: 'success',
    summary: 'Success',
    detail: 'PrimeVue is working!',
    life: 3000
  });
}
</script>