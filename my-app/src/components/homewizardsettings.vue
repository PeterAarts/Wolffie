<template>
  <div class="homewizard-section">
    <!-- Discovery Section -->
    <div class="discovery-panel">
      <div class="panel-header">
        <div class="header-content">
          <i class="pi pi-wifi"></i>
          <div>
            <h4>Device Discovery</h4>
            <p>Automatically find HomeWizard devices on your local network</p>
          </div>
        </div>
        <Button 
          label="Discover Devices" 
          icon="pi pi-search"
          @click="discoverDevices"
          :loading="discovering"
          :disabled="discovering"
        />
      </div>

      <!-- Discovery Results -->
      <Message v-if="discoveryMessage" :severity="discoveryMessage.severity" :closable="false">
        {{ discoveryMessage.text }}
      </Message>

      <div v-if="discoveryStats" class="discovery-stats">
        <div class="stat-item">
          <span class="stat-value">{{ discoveryStats.total }}</span>
          <span class="stat-label">Found</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ discoveryStats.new }}</span>
          <span class="stat-label">New</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ discoveryStats.existing }}</span>
          <span class="stat-label">Existing</span>
        </div>
      </div>
    </div>

    <!-- Meters Table -->
    <div class="meters-table-panel">
      <div class="panel-header">
        <h4>Configured Devices ({{ meters.length }})</h4>
        <Button 
          label="Refresh" 
          icon="pi pi-refresh"
          @click="loadMeters"
          :loading="loading"
          size="small"
          severity="secondary"
        />
      </div>

      <DataTable 
        v-if="meters.length > 0"
        :value="meters" 
        :loading="loading"
        responsiveLayout="scroll"
        class="meters-table"
      >
      <!--  <Column field="enabled" header="Active" style="width: 80px">
          <template #body="slotProps">
            <InputSwitch 
              v-model="slotProps.data.enabled" 
              @change="toggleEnabled(slotProps.data)"
            />
          </template>
        </Column> -->

        <Column field="name" header="Name" sortable>
          <template #body="slotProps">
            <div class="meter-name-cell">
              <i :class="getDeviceTypeIcon(slotProps.data.product_type)" 
                 :style="{ color: getDeviceIconColor(slotProps.data.product_type) }"></i>
              {{ getDisplayName(slotProps.data) }}
            </div>
          </template>
        </Column>

        <!--<Column field="product_type" header="Device Type" style="width: 150px" sortable>
          <template #body="slotProps">
            <Tag 
              :value="getDeviceTypeLabel(slotProps.data.product_type)" 
              :severity="getDeviceTypeSeverity(slotProps.data.product_type)"
            >
              <i :class="getDeviceTypeIcon(slotProps.data.product_type)" class="mr-1"></i>
              {{ getDeviceTypeLabel(slotProps.data.product_type) }}
            </Tag>
          </template>
        </Column>

        <Column field="serial" header="Serial / MAC" style="width: 160px">
          <template #body="slotProps">
            <span class="serial-text" v-if="slotProps.data.serial">
              {{ formatSerial(slotProps.data.serial) }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>
        </Column>

        <Column field="ip_address" header="IP Address" sortable>
          <template #body="slotProps">
            <div class="ip-cell">
              <code>{{ slotProps.data.ip_address }}</code>
              <Tag 
                v-if="meterStatus[slotProps.data.id]?.online" 
                value="1" 
                severity="success" 
                style="margin-left: 0.5rem"
              />
              <Tag 
                v-else-if="meterStatus[slotProps.data.id]?.online === false" 
                value="O" 
                severity="danger"
                style="margin-left: 0.5rem"
              />
            </div>
          </template>
        </Column>

        <Column field="poll_interval" header="Poll" style="width: 80px">
          <template #body="slotProps">
            {{ slotProps.data.poll_interval }}s
          </template>
        </Column>-->

        <Column header="Current Power" style="width: 140px">
          <template #body="slotProps">
            <div v-if="meterData[slotProps.data.id]" class="power-cell">
              <span :class="getPowerClass(meterData[slotProps.data.id].power)">
                <i :class="getPowerIcon(meterData[slotProps.data.id].power)"></i>
                {{ Math.abs(meterData[slotProps.data.id].power).toFixed(0) }} W
              </span>
            </div>
            <span v-else class="text-muted">—</span>
          </template>
        </Column>
<!--
        <Column header="Actions" style="width: 150px">
          <template #body="slotProps">
            <div class="action-buttons">
              <Button 
                icon="pi pi-check-circle" 
                severity="info"
                text
                rounded
                @click="testConnection(slotProps.data)"
                v-tooltip.top="'Test Connection'"
              />
              <Button 
                icon="pi pi-pencil" 
                severity="secondary"
                text
                rounded
                @click="editMeter(slotProps.data)"
                v-tooltip.top="'Edit'"
              />
              <Button 
                icon="pi pi-trash" 
                severity="danger"
                text
                rounded
                @click="confirmDelete(slotProps.data)"
                v-tooltip.top="'Delete'"
              />
            </div>
          </template>
        </Column>-->
      </DataTable>

      <div v-else class="empty-state">
        <i class="pi pi-inbox"></i>
        <p>No devices configured yet</p>
        <small>Click "Discover Devices" to find HomeWizard P1 meters and Energy Sockets on your network</small>
      </div>
    </div>

    <!-- Info Panel -->
    <div class="info-panel">
      <i class="pi pi-info-circle"></i>
      <div class="info-content">
        <strong>About HomeWizard Devices</strong>
        <p>
          HomeWizard P1 meters read data from Dutch smart meters (DSMR). Energy Sockets monitor individual appliances.
          Make sure the Local API is enabled in the HomeWizard Energy app: 
          Settings → Devices → [Your Device] → Local API.
        </p>
      </div>
    </div>
  </div>

  <!-- Edit Dialog -->
  <Dialog 
    v-model:visible="showEditDialog" 
    :header="editingMeter ? 'Edit Device' : 'Add Device'"
    :modal="true"
    :style="{ width: '500px' }"
  >
    <div class="edit-form">
      <div class="field">
        <label for="meterName">Device Name *</label>
        <InputText 
          id="meterName"
          v-model="meterForm.name" 
          placeholder="e.g., Main House P1 or Office Socket"
          class="w-full"
        />
        <small class="field-hint">Leave empty to use MAC address as name</small>
      </div>

      <div class="field">
        <label for="ipAddress">IP Address *</label>
        <InputText 
          id="ipAddress"
          v-model="meterForm.ip_address" 
          placeholder="192.168.1.x"
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="port">Port</label>
        <InputNumber 
          id="port"
          v-model="meterForm.port" 
          :min="1" 
          :max="65535"
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="productType">Device Type</label>
        <Dropdown 
          id="productType"
          v-model="meterForm.product_type" 
          :options="deviceTypes"
          optionLabel="label"
          optionValue="value"
          placeholder="Select device type"
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="serial">Serial / MAC Address</label>
        <InputText 
          id="serial"
          v-model="meterForm.serial" 
          placeholder="3c39e7abcdef"
          class="w-full"
        />
        <small class="field-hint">Used to prevent duplicate devices</small>
      </div>

      <div class="field">
        <label for="pollInterval">Poll Interval (seconds)</label>
        <InputNumber 
          id="pollInterval"
          v-model="meterForm.poll_interval" 
          :min="5" 
          :max="300"
          class="w-full"
        />
      </div>

      <div class="field">
        <label for="priority">Priority</label>
        <InputNumber 
          id="priority"
          v-model="meterForm.priority" 
          :min="1" 
          :max="10"
          class="w-full"
        />
      </div>

      <div class="field-checkbox">
        <Checkbox 
          id="enabled"
          v-model="meterForm.enabled" 
          :binary="true"
        />
        <label for="enabled">Active</label>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" @click="closeEditDialog" />
      <Button 
        label="Save" 
        icon="pi pi-save"
        @click="saveMeter" 
        :loading="saving"
      />
    </template>
  </Dialog>

  <!-- Delete Confirmation -->
  <Dialog 
    v-model:visible="showDeleteDialog" 
    header="Confirm Delete"
    :modal="true"
    :style="{ width: '400px' }"
  >
    <p>
      Are you sure you want to delete device 
      <strong>{{ getDisplayName(meterToDelete) }}</strong>?
    </p>
    <p class="text-muted">This action cannot be undone.</p>

    <template #footer>
      <Button label="Cancel" severity="secondary" @click="showDeleteDialog = false" />
      <Button 
        label="Delete" 
        severity="danger"
        icon="pi pi-trash"
        @click="deleteMeter" 
        :loading="deleting"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import { useToast } from 'primevue/usetoast';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import InputSwitch from 'primevue/inputswitch';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Checkbox from 'primevue/checkbox';
import Dropdown from 'primevue/dropdown';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Tag from 'primevue/tag';

const toast = useToast();
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// State
const meters = ref([]);
const loading = ref(false);
const discovering = ref(false);
const saving = ref(false);
const deleting = ref(false);

const discoveryMessage = ref(null);
const discoveryStats = ref(null);

const meterStatus = ref({});
const meterData = ref({});

const showEditDialog = ref(false);
const showDeleteDialog = ref(false);
const editingMeter = ref(null);
const meterToDelete = ref(null);

const meterForm = ref({
  id: null,
  name: '',
  ip_address: '',
  port: 80,
  product_type: 'HWE-P1',
  product_name: null,
  serial: null,
  enabled: true,
  poll_interval: 10,
  priority: 3
});

// Device types for dropdown
const deviceTypes = [
  { label: 'P1 Meter (Smart Meter)', value: 'HWE-P1' },
  { label: 'Energy Socket (Plug)', value: 'HWE-SKT' },
  { label: 'Water Meter', value: 'HWE-WTR' },
  { label: 'kWh Meter', value: 'HWE-KWH1' },
  { label: 'kWh Meter 3-Phase', value: 'HWE-KWH3' }
];

let dataRefreshInterval = null;

// Load meters on mount
onMounted(async () => {
  await loadMeters();
  startDataRefresh();
});

onUnmounted(() => {
  stopDataRefresh();
});

// Load all meters from database
async function loadMeters() {
  loading.value = true;
  try {
    const response = await axios.get(`${API_BASE}/homewizard/settings`);
    meters.value = response.data.data || [];
    
    // Load current data for each meter
    await loadMeterData();
  } catch (error) {
    console.error('Failed to load meters:', error);
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to load devices', 
      life: 3000 
    });
  } finally {
    loading.value = false;
  }
}

// Discover devices via mDNS
async function discoverDevices() {
  discovering.value = true;
  discoveryMessage.value = null;
  discoveryStats.value = null;

  try {
    const response = await axios.post(`${API_BASE}/homewizard/discover`);
    
    if (response.data.success) {
      const { stats, message } = response.data;
      
      discoveryStats.value = stats;
      
      if (stats.new > 0) {
        discoveryMessage.value = {
          severity: 'success',
          text: `✓ ${message}`
        };
        
        toast.add({ 
          severity: 'success', 
          summary: 'Discovery Complete', 
          detail: `Added ${stats.new} new device(s)`, 
          life: 5000 
        });
      } else if (stats.total === 0) {
        discoveryMessage.value = {
          severity: 'warn',
          text: 'No devices found. Make sure Local API is enabled in the HomeWizard Energy app.'
        };
      } else {
        discoveryMessage.value = {
          severity: 'info',
          text: `Found ${stats.total} device(s), all already configured.`
        };
      }
      
      // Reload meters to show new devices
      await loadMeters();
    }
  } catch (error) {
    console.error('Discovery failed:', error);
    discoveryMessage.value = {
      severity: 'error',
      text: error.response?.data?.message || 'Discovery failed. Make sure avahi-utils is installed.'
    };
    
    toast.add({ 
      severity: 'error', 
      summary: 'Discovery Failed', 
      detail: error.response?.data?.message || 'An error occurred', 
      life: 5000 
    });
  } finally {
    discovering.value = false;
  }
}

// Load current data for all meters
async function loadMeterData() {
  try {
    const response = await axios.get(`${API_BASE}/homewizard/data`);
    
    if (response.data.success) {
      const results = response.data.data;
      
      // Update status and data for each meter
      for (const result of results) {
        meterStatus.value[result.meterId] = {
          online: result.success
        };
        
        if (result.success && result.data.realtime) {
          meterData.value[result.meterId] = {
            power: result.data.realtime.grid?.power || 0,
            voltage: result.data.realtime.grid?.voltage || 0,
            current: result.data.realtime.grid?.current || 0
          };
        }
      }
    }
  } catch (error) {
    console.error('Failed to load meter data:', error);
  }
}

// Start auto-refresh of meter data
function startDataRefresh() {
  dataRefreshInterval = setInterval(loadMeterData, 10000); // Every 10 seconds
}

function stopDataRefresh() {
  if (dataRefreshInterval) {
    clearInterval(dataRefreshInterval);
  }
}

// Toggle meter enabled state
async function toggleEnabled(meter) {
  try {
    await axios.put(`${API_BASE}/homewizard/settings/${meter.id}`, {
      enabled: meter.enabled
    });
    
    toast.add({ 
      severity: 'success', 
      summary: 'Updated', 
      detail: `Device ${meter.enabled ? 'enabled' : 'disabled'}`, 
      life: 2000 
    });
  } catch (error) {
    console.error('Failed to toggle meter:', error);
    // Revert on error
    meter.enabled = !meter.enabled;
    
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to update device', 
      life: 3000 
    });
  }
}

// Test connection to meter
async function testConnection(meter) {
  try {
    const response = await axios.post(`${API_BASE}/homewizard/test`, {
      ip_address: meter.ip_address,
      port: meter.port
    });
    
    if (response.data.success) {
      toast.add({ 
        severity: 'success', 
        summary: 'Connected', 
        detail: response.data.message, 
        life: 3000 
      });
    } else {
      toast.add({ 
        severity: 'error', 
        summary: 'Connection Failed', 
        detail: response.data.message, 
        life: 5000 
      });
    }
  } catch (error) {
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to test connection', 
      life: 3000 
    });
  }
}

// Edit meter
function editMeter(meter) {
  editingMeter.value = meter;
  meterForm.value = { ...meter };
  showEditDialog.value = true;
}

// Save meter
async function saveMeter() {
  saving.value = true;
  
  try {
    await axios.post(`${API_BASE}/homewizard/settings`, meterForm.value);
    
    toast.add({ 
      severity: 'success', 
      summary: 'Saved', 
      detail: 'Device configuration saved', 
      life: 2000 
    });
    
    await loadMeters();
    closeEditDialog();
  } catch (error) {
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to save device', 
      life: 3000 
    });
  } finally {
    saving.value = false;
  }
}

function closeEditDialog() {
  showEditDialog.value = false;
  editingMeter.value = null;
  meterForm.value = {
    id: null,
    name: '',
    ip_address: '',
    port: 80,
    product_type: 'HWE-P1',
    product_name: null,
    serial: null,
    enabled: true,
    poll_interval: 10,
    priority: 3
  };
}

// Delete meter
function confirmDelete(meter) {
  meterToDelete.value = meter;
  showDeleteDialog.value = true;
}

async function deleteMeter() {
  if (!meterToDelete.value) return;
  
  deleting.value = true;
  
  try {
    await axios.delete(`${API_BASE}/homewizard/settings/${meterToDelete.value.id}`);
    
    toast.add({ 
      severity: 'success', 
      summary: 'Deleted', 
      detail: 'Device deleted', 
      life: 2000 
    });
    
    await loadMeters();
    showDeleteDialog.value = false;
    meterToDelete.value = null;
  } catch (error) {
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to delete device', 
      life: 3000 
    });
  } finally {
    deleting.value = false;
  }
}

// Helper functions for device display
function getDisplayName(meter) {
  if (!meter) return '';
  
  // Use name if available
  if (meter.name && meter.name.trim() !== '') {
    return meter.name;
  }
  
  // Fallback to serial (MAC address)
  if (meter.serial) {
    return `Device ${meter.serial.substring(0, 12)}`;
  }
  
  // Last resort: IP address
  return meter.ip_address;
}

function getDeviceTypeLabel(productType) {
  const labels = {
    'HWE-P1': 'P1 Meter',
    'HWE-SKT': 'Socket',
    'HWE-WTR': 'Water',
    'HWE-KWH1': 'kWh',
    'HWE-KWH3': 'kWh 3P'
  };
  return labels[productType] || 'Device';
}

function getDeviceTypeSeverity(productType) {
  const severities = {
    'HWE-P1': '',      // Blue
    'HWE-SKT': '',  // Green
    'HWE-WTR': 'primary',  // Purple
    'HWE-KWH1': 'warning', // Orange
    'HWE-KWH3': 'warning'  // Orange
  };
  return severities[productType] || 'secondary';
}

function getDeviceTypeIcon(productType) {
  const icons = {
    'HWE-P1': 'pi pi-chart-line',    // Graph for P1 Meter
    'HWE-SKT': 'pi pi-bolt',         // Lightning for Socket
    'HWE-WTR': 'pi pi-cloud',        // Cloud/Droplet for Water
    'HWE-KWH1': 'pi pi-th-large',    // Grid for kWh
    'HWE-KWH3': 'pi pi-th-large'     // Grid for kWh 3P
  };
  return icons[productType] || 'pi pi-microchip';
}

function getDeviceIconColor(productType) {
  const colors = {
    'HWE-P1': '#aaa',   // Blue
    'HWE-SKT': '#aaa',  // Green
    'HWE-WTR': '#8b5cf6',  // Purple
    'HWE-KWH1': '#f59e0b', // Orange
    'HWE-KWH3': '#f59e0b'  // Orange
  };
  return colors[productType] || '#64748b';
}

function formatSerial(serial) {
  if (!serial) return '';
  // Format MAC address: 3c39e7abcdef -> 3c:39:e7:ab:cd:ef
  if (serial.length === 12) {
    return serial.match(/.{1,2}/g).join(':');
  }
  return serial;
}

function getPowerClass(power) {
  if (power > 0) return 'power-importing';
  if (power < 0) return 'power-exporting';
  return 'power-neutral';
}

function getPowerIcon(power) {
  if (power > 0) return 'pi pi-arrow-down';
  if (power < 0) return 'pi pi-arrow-up';
  return 'pi pi-minus';
}
</script>

<style scoped>
.homewizard-section {
  padding: 1.5rem;
}

.section-header {
  margin-bottom: 2rem;
}

.section-header h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
  color: #1e293b;
}

.section-header p {
  margin: 0;
  color: #64748b;
}

/* Discovery Panel */
.discovery-panel {
  background: white;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e5e7eb;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-content i {
  font-size: 2rem;
  color: #f59e0b;
}

.header-content h4 {
  margin: 0 0 0.25rem 0;
  font-size: 1.125rem;
  color: #1e293b;
}

.header-content p {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b;
}

.discovery-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.stat-item {
  text-align: center;
  padding: 1rem;
  background: #f9fafb;
  border-radius: 8px;
}

.stat-value {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  color: #1e293b;
}

.stat-label {
  display: block;
  font-size: 0.875rem;
  color: #64748b;
  margin-top: 0.25rem;
}

/* Meters Table Panel */
.meters-table-panel {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e5e7eb;
}

.meters-table {
  margin-top: 1rem;
}

.meter-name-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ip-cell {
  display: flex;
  align-items: center;
}

.ip-cell code {
  background: #f1f5f9;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
}

.serial-text {
  font-family: 'Courier New', monospace;
  font-size: 0.8125rem;
  color: #64748b;
  background: #f1f5f9;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.power-cell {
  font-weight: 600;
}

.power-importing {
  color: #dc2626;
}

.power-exporting {
  color: #10b981;
}

.power-neutral {
  color: #64748b;
}

.action-buttons {
  display: flex;
  gap: 0.25rem;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: #64748b;
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
}

.empty-state small {
  font-size: 0.875rem;
}

/* Info Panel */
.info-panel {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  gap: 1rem;
}

.info-panel i {
  color: #3b82f6;
  font-size: 1.25rem;
  flex-shrink: 0;
}

.info-content strong {
  display: block;
  margin-bottom: 0.5rem;
  color: #1e40af;
}

.info-content p {
  margin: 0;
  font-size: 0.875rem;
  color: #1e40af;
  line-height: 1.5;
}

/* Edit Form */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field label {
  font-weight: 600;
  color: #374151;
  font-size: 0.875rem;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-hint {
  color: #64748b;
  font-size: 0.75rem;
  margin-top: -0.25rem;
}

.w-full {
  width: 100%;
}

.text-muted {
  color: #9ca3af;
  font-size: 0.875rem;
}

.mr-1 {
  margin-right: 0.25rem;
}

/* Responsive */
@media (max-width: 1024px) {
  .discovery-stats {
    grid-template-columns: 1fr;
  }
}
</style>