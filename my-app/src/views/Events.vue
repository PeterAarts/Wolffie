<template>
  <div class="events-view flex flex-col h-full bg-secondary-100">
    <header class="p-6 border-b border-secondary-200 flex-shrink-0">
      <p class="text-sm text-secondary-500">{{ t('events.description') }}</p>
    </header>

    <div class="flex-1 overflow-hidden p-6">
      <AppTable
        :items="events"
        :columns="columns"
        :loading="loading"
        @row-click="openDetails"
      >
        <template #toolbar-left>
          <span class="toolbar__count">{{ events.length }} {{ t('events.total') }}</span>
        </template>

        <template #toolbar-right>
          <button class="btn btn--sm" :disabled="loading" @click="fetchEvents">
            <i class="fa-duotone fa-rotate mr-2" /> {{ t('control.devices.refresh') }}
          </button>
        </template>

        <template #category="{ value }">
          <span :class="['status-badge', `status-badge--${value.category.toLowerCase()}`]">
            {{ value.category }}
          </span>
        </template>

        <template #user_name="{ value }">
          <div class="flex items-center gap-2">
            <i v-if="value.user_id === 0" class="fa-duotone fa-robot text-blue-500" />
            <i v-else class="fa-duotone fa-user text-secondary-500" />
            <span>{{ value.user_id === 0 ? 'System' : value.user_name }}</span>
          </div>
        </template>

        <template #status="{ value }">
          <i :class="value.status === 'SUCCESS' ? 'fa-solid fa-circle-check text-green-500' : 'fa-solid fa-circle-exclamation text-red-500'" />
        </template>
      </AppTable>
    </div>

    <AppDrawer
      v-model:visible="drawerOpen"
      :title="t('events.drawerTitle')"
    >
      <div v-if="selectedEvent" class="event-details">
        <section class="drawer-meta-section">
          <h5 class="graph-label">{{ t('events.logicReason') }}</h5>
          <div class="p-4 bg-secondary-50 rounded-lg text-sm italic border-s-4 border-secondary-300">
            "{{ selectedEvent.details?.reason || 'No reason provided.' }}"
          </div>
        </section>

        <section class="drawer-meta-section mt-6">
          <h5 class="graph-label">{{ t('events.rawPayload') }}</h5>
          <pre class="bg-secondary-900 text-secondary-100 p-4 rounded-lg text-xs overflow-x-auto">
{{ JSON.stringify(selectedEvent.details, null, 2) }}
          </pre>
        </section>
      </div>

      <template #footer>
        <button class="btn btn--sm" @click="drawerOpen = false">
          {{ t('common.close') }}
        </button>
      </template>
    </AppDrawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import AppTable from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';

const { t } = useI18n();
const events = ref([]);
const loading = ref(false);
const drawerOpen = ref(false);
const selectedEvent = ref(null);

const columns = [
  { field: 'timestamp', title: t('events.colTime'), width: '180px', sortable: true },
  { field: 'category', title: t('events.colType'), width: '120px' },
  { field: 'action', title: t('events.colAction'), width: '150px' },
  { field: 'user_name', title: t('events.colUser'), width: '150px' },
  { field: 'details', title: t('events.details') },
  { field: 'status', title: t('events.colStatus'), width: '80px' }
];

async function fetchEvents() {
  loading.value = true;
  try {
    // Direct call using the apiClient as requested
    const response = await apiClient.get('/system/events');
    events.value = response.data;
  } catch (error) {
    console.error('Failed to fetch events:', error);
  } finally {
    loading.value = false;
  }
}

function openDetails(row) {
  selectedEvent.value = row;
  drawerOpen.value = true;
}

onMounted(fetchEvents);
</script>