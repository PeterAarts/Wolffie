<template>
  <div class="module-management">
    <div class="page-header">
      <div>
        <h2>Module Management</h2>
        <p>Enable, disable, and configure data collection modules</p>
      </div>
      <Button
        label="Discover Modules"
        icon="pi pi-search"
        @click="discoverModules"
        :loading="discovering"
        severity="secondary"
      />
    </div>

    <!-- Modules Table -->
    <DataTable
      :value="modules"
      :loading="loading"
      dataKey="module_id"
      stripedRows
      class="modules-table"
    >
      <!-- Module Column -->
      <Column field="module_name" header="Module" sortable>
        <template #body="{ data }">
          <div class="module-cell">
            <div 
              class="module-icon"
              :style="{ backgroundColor: data.color ? data.color + '20' : '#e5e7eb' }"
            >
              <i 
                :class="`pi ${data.icon || 'pi-box'}`"
                :style="{ color: data.color || '#6b7280' }"
              ></i>
            </div>
            <div class="module-details">
              <span class="module-name">{{ data.module_name }}</span>
              <span class="module-description">{{ data.description }}</span>
            </div>
          </div>
        </template>
      </Column>

      <!-- Version Column -->
      <Column field="module_version" header="Version" sortable>
        <template #body="{ data }">
          <Tag :value="`v${data.module_version}`" severity="info" />
        </template>
      </Column>

      <!-- Type Column -->
      <Column field="module_type" header="Type" sortable>
        <template #body="{ data }">
          <Tag 
            :value="formatModuleType(data.module_type)"
            :severity="getTypeSeverity(data.module_type)"
          />
        </template>
      </Column>

      <!-- Capabilities Column -->
      <Column header="Capabilities">
        <template #body="{ data }">
          <div class="capabilities">
            <Tag v-if="data.has_collector" value="Collector" severity="success" rounded />
            <Tag v-if="data.has_api" value="API" severity="info" rounded />
            <Tag v-if="data.has_ui" value="UI" severity="warning" rounded />
          </div>
        </template>
      </Column>

      <!-- Status Column -->
      <Column field="enabled" header="Status" sortable>
        <template #body="{ data }">
          <div class="status-cell">
            <InputSwitch
              :modelValue="data.enabled"
              @update:modelValue="toggleModule(data, $event)"
            />
            <span :class="{ 'text-green-600': data.enabled, 'text-red-600': !data.enabled }">
              {{ data.enabled ? 'Enabled' : 'Disabled' }}
            </span>
          </div>
        </template>
      </Column>

      <!-- Last Seen Column -->
      <Column field="last_seen_at" header="Last Seen" sortable>
        <template #body="{ data }">
          <span class="text-sm text-600">
            {{ formatDate(data.last_seen_at) }}
          </span>
        </template>
      </Column>

      <!-- Actions Column -->
      <Column header="Actions">
        <template #body="{ data }">
          <div class="action-buttons">
            <Button
              v-if="data.has_ui"
              icon="pi pi-cog"
              tooltip="Configure"
              size="small"
              text
              rounded
              @click="configureModule(data)"
            />
            <Button
              icon="pi pi-info-circle"
              tooltip="Details"
              size="small"
              text
              rounded
              @click="showModuleDetails(data)"
            />
            <Button
              v-if="!data.installed"
              icon="pi pi-trash"
              tooltip="Remove"
              severity="danger"
              size="small"
              text
              rounded
              @click="removeModule(data)"
            />
          </div>
        </template>
      </Column>

      <!-- Empty State -->
      <template #empty>
        <div class="empty-state">
          <i class="pi pi-box" style="font-size: 3rem; color: #9ca3af;"></i>
          <p>No modules found</p>
          <Button
            label="Discover Modules"
            icon="pi pi-search"
            @click="discoverModules"
            severity="secondary"
          />
        </div>
      </template>
    </DataTable>

    <!-- Module Details Dialog -->
    <Dialog
      v-model:visible="detailsVisible"
      :header="selectedModule?.module_name"
      modal
      :style="{ width: '600px' }"
    >
      <div v-if="selectedModule" class="module-details-dialog">
        <div class="detail-row">
          <span class="detail-label">Module ID:</span>
          <span class="detail-value">{{ selectedModule.module_id }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Version:</span>
          <span class="detail-value">{{ selectedModule.module_version }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Type:</span>
          <span class="detail-value">{{ formatModuleType(selectedModule.module_type) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Author:</span>
          <span class="detail-value">{{ selectedModule.author || 'Unknown' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Description:</span>
          <span class="detail-value">{{ selectedModule.description }}</span>
        </div>

        <Divider />

        <h4>Capabilities</h4>
        <div class="capabilities-list">
          <div class="capability-item">
            <i :class="selectedModule.has_collector ? 'pi pi-check-circle text-green-600' : 'pi pi-times-circle text-red-600'"></i>
            <span>Data Collector</span>
          </div>
          <div class="capability-item">
            <i :class="selectedModule.has_api ? 'pi pi-check-circle text-green-600' : 'pi pi-times-circle text-red-600'"></i>
            <span>API Endpoints</span>
          </div>
          <div class="capability-item">
            <i :class="selectedModule.has_ui ? 'pi pi-check-circle text-green-600' : 'pi pi-times-circle text-red-600'"></i>
            <span>Settings UI</span>
          </div>
        </div>

        <Divider v-if="selectedModule.has_collector" />

        <div v-if="selectedModule.has_collector">
          <h4>Collector Configuration</h4>
          <div class="detail-row">
            <span class="detail-label">Interval:</span>
            <span class="detail-value">{{ selectedModule.collector_interval }}ms</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Priority:</span>
            <span class="detail-value">{{ selectedModule.collector_priority }}</span>
          </div>
        </div>

        <Divider v-if="selectedModule.api_prefix" />

        <div v-if="selectedModule.api_prefix">
          <h4>API Configuration</h4>
          <div class="detail-row">
            <span class="detail-label">API Prefix:</span>
            <span class="detail-value">{{ selectedModule.api_prefix }}</span>
          </div>
        </div>

        <Divider />

        <div class="detail-row">
          <span class="detail-label">Installed:</span>
          <span class="detail-value">{{ formatDate(selectedModule.installed_at) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last Updated:</span>
          <span class="detail-value">{{ formatDate(selectedModule.updated_at) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Last Seen:</span>
          <span class="detail-value">{{ formatDate(selectedModule.last_seen_at) }}</span>
        </div>
      </div>

      <template #footer>
        <Button label="Close" @click="detailsVisible = false" />
      </template>
    </Dialog>

    <!-- Confirm Dialog -->
    <ConfirmDialog />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import apiClient from '@/services/api';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import InputSwitch from 'primevue/inputswitch';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import ConfirmDialog from 'primevue/confirmdialog';

const router = useRouter();
const toast = useToast();
const confirm = useConfirm();

const modules = ref([]);
const loading = ref(false);
const discovering = ref(false);
const detailsVisible = ref(false);
const selectedModule = ref(null);

// Load modules
async function loadModules() {
  loading.value = true;
  try {
    const { data } = await apiClient.get(endpoint);
    modules.value = data.modules || [];
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load modules',
      life: 3000
    });
  } finally {
    loading.value = false;
  }
}

// Toggle module enabled/disabled
async function toggleModule(module, enabled) {
  try {
    await apiClient.put(endpoint, payload);
    module.enabled = enabled;

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: `Module ${enabled ? 'enabled' : 'disabled'}`,
      life: 2000
    });
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to toggle module',
      life: 3000
    });
    // Reload to revert
    await loadModules();
  }
}

// Discover modules
async function discoverModules() {
  discovering.value = true;
  try {
    await apiClient.post('/api/system/discover-modules');

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Module discovery started',
      life: 3000
    });

    // Reload after discovery
    setTimeout(loadModules, 2000);
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to discover modules',
      life: 3000
    });
  } finally {
    discovering.value = false;
  }
}

// Configure module
function configureModule(module) {
  // Navigate to module settings
  router.push({ 
    name: 'Settings',
    query: { tab: module.module_id }
  });
}

// Show module details
function showModuleDetails(module) {
  selectedModule.value = module;
  detailsVisible.value = true;
}

// Remove module
function removeModule(module) {
  confirm.require({
    message: `Remove module "${module.module_name}"? This will delete all module data.`,
    header: 'Confirm Removal',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await apiClient.delete(`/api/settings/modules/${module.module_id}`);

        toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Module removed',
          life: 3000
        });

        await loadModules();
      } catch (error) {
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to remove module',
          life: 3000
        });
      }
    }
  });
}

// Format module type
function formatModuleType(type) {
  const types = {
    'data-collector': 'Data Collector',
    'control': 'Control System',
    'analytics': 'Analytics',
    'integration': 'Integration'
  };
  return types[type] || type;
}

// Get type severity
function getTypeSeverity(type) {
  const severities = {
    'data-collector': 'info',
    'control': 'success',
    'analytics': 'warning',
    'integration': 'secondary'
  };
  return severities[type] || 'secondary';
}

// Format date
function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

onMounted(() => {
  loadModules();
});
</script>

<style scoped>
.module-management {
  padding: 1.5rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.page-header h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
  color: #111827;
}

.page-header p {
  margin: 0;
  color: #6b7280;
}

/* Module Cell */
.module-cell {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.module-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
}

.module-icon i {
  font-size: 1.5rem;
}

.module-details {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.module-name {
  font-weight: 600;
  color: #111827;
}

.module-description {
  font-size: 0.875rem;
  color: #6b7280;
}

/* Capabilities */
.capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* Status Cell */
.status-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 0.25rem;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 1rem;
  color: #6b7280;
}

/* Module Details Dialog */
.module-details-dialog {
  padding: 1rem 0;
}

.detail-row {
  display: flex;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f3f4f6;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  font-weight: 600;
  color: #6b7280;
  min-width: 150px;
}

.detail-value {
  color: #111827;
  flex: 1;
}

.module-details-dialog h4 {
  margin: 1rem 0 0.75rem 0;
  color: #374151;
  font-size: 1.1rem;
}

.capabilities-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.capability-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.capability-item i {
  font-size: 1.25rem;
}
</style>