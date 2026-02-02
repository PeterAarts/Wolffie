<template>
  <div class="homewizard-cards">
    <!-- Card for each enabled meter -->
    <div 
      v-for="meter in activeMeters" 
      :key="meter.id"
      class="meter-card"
    >
      <!-- Card Header -->
      <div class="card-header">
        <div class="header-left">
          <i class="pi pi-bolt card-icon"></i>
          <div>
            <h4>{{ meter.name }}</h4>
            <span class="card-subtitle">P1 Smart Meter</span>
          </div>
        </div>
        <Tag 
          :value="meter.online ? 'Online' : 'Offline'" 
          :severity="meter.online ? 'success' : 'danger'"
        />
      </div>

      <!-- Current Power -->
      <div class="power-section">
        <div class="power-display">
          <div 
            class="power-value" 
            :class="{ 
              importing: meter.currentPower > 0, 
              exporting: meter.currentPower < 0,
              neutral: meter.currentPower === 0
            }"
          >
            <i :class="getPowerIcon(meter.currentPower)"></i>
            {{ Math.abs(meter.currentPower).toFixed(0) }}
            <span class="unit">W</span>
          </div>
          <div class="power-label">
            {{ getPowerLabel(meter.currentPower) }}
          </div>
        </div>

        <!-- Phase Breakdown (if available) -->
        <div v-if="showPhases && meter.phases" class="phase-grid">
          <div class="phase-item">
            <span class="phase-label">L1</span>
            <span class="phase-value">{{ meter.phases.L1 }} W</span>
          </div>
          <div class="phase-item">
            <span class="phase-label">L2</span>
            <span class="phase-value">{{ meter.phases.L2 }} W</span>
          </div>
          <div class="phase-item">
            <span class="phase-label">L3</span>
            <span class="phase-value">{{ meter.phases.L3 }} W</span>
          </div>
        </div>
      </div>

      <!-- Daily Totals -->
      <div class="totals-section">
        <div class="total-row">
          <div class="total-item import">
            <i class="pi pi-arrow-down"></i>
            <div>
              <span class="total-label">Today Import</span>
              <span class="total-value">{{ meter.dailyImport.toFixed(2) }} kWh</span>
            </div>
          </div>
          <div class="total-item export">
            <i class="pi pi-arrow-up"></i>
            <div>
              <span class="total-label">Today Export</span>
              <span class="total-value">{{ meter.dailyExport.toFixed(2) }} kWh</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Voltage & Current (collapsible) -->
      <div v-if="showDetails" class="details-section">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Voltage</span>
            <span class="detail-value">{{ meter.voltage }} V</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Current</span>
            <span class="detail-value">{{ meter.current }} A</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Frequency</span>
            <span class="detail-value">{{ meter.frequency }} Hz</span>
          </div>
        </div>
      </div>

      <!-- Card Footer -->
      <div class="card-footer">
        <span class="last-update">
          <i class="pi pi-clock"></i>
          Updated {{ formatTimestamp(meter.lastUpdate) }}
        </span>
        <Button 
          :icon="showDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
          text
          rounded
          size="small"
          @click="showDetails = !showDetails"
          v-tooltip.top="'Toggle Details'"
        />
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="activeMeters.length === 0" class="empty-state">
      <i class="pi pi-inbox"></i>
      <h4>No Active Meters</h4>
      <p>Configure HomeWizard P1 meters in Settings to see grid power data here</p>
      <Button 
        label="Go to Settings" 
        icon="pi pi-cog"
        @click="$router.push('/settings')"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import Tag from 'primevue/tag';
import Button from 'primevue/button';

const router = useRouter();
const API_BASE = 'http://localhost:3000/api';

// State
const meters = ref([]);
const meterData = ref({});
const showDetails = ref(false);
const showPhases = ref(true);

let refreshInterval = null;

// Computed
const activeMeters = computed(() => {
  return meters.value
    .filter(m => m.enabled)
    .map(m => {
      const data = meterData.value[m.id];
      
      return {
        id: m.id,
        name: m.name,
        online: data?.online || false,
        currentPower: data?.realtime?.grid?.power || 0,
        dailyImport: data?.daily?.grid?.imported || 0,
        dailyExport: data?.daily?.grid?.exported || 0,
        voltage: data?.realtime?.grid?.voltage || 0,
        current: data?.realtime?.grid?.current || 0,
        frequency: data?.realtime?.grid?.frequency || 50,
        phases: data?.realtime?.grid ? {
          L1: data.realtime.grid.powerL1 || 0,
          L2: data.realtime.grid.powerL2 || 0,
          L3: data.realtime.grid.powerL3 || 0
        } : null,
        lastUpdate: data?.timestamp || null
      };
    });
});

// Lifecycle
onMounted(async () => {
  await loadMeters();
  await loadMeterData();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});

// Load meter configurations
async function loadMeters() {
  try {
    const response = await axios.get(`${API_BASE}/homewizard/settings`);
    meters.value = response.data.data || [];
  } catch (error) {
    console.error('Failed to load meters:', error);
  }
}

// Load current data for all meters
async function loadMeterData() {
  try {
    const response = await axios.get(`${API_BASE}/homewizard/data`);
    
    if (response.data.success) {
      const results = response.data.data;
      
      // Update data for each meter
      for (const result of results) {
        meterData.value[result.meterId] = {
          online: result.success,
          timestamp: Date.now(),
          ...result.data
        };
      }
    }
  } catch (error) {
    console.error('Failed to load meter data:', error);
  }
}

// Auto-refresh every 10 seconds
function startAutoRefresh() {
  refreshInterval = setInterval(loadMeterData, 10000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
}

// Helper functions
function getPowerIcon(power) {
  if (power > 0) return 'pi pi-arrow-down';
  if (power < 0) return 'pi pi-arrow-up';
  return 'pi pi-minus';
}

function getPowerLabel(power) {
  if (power > 100) return 'Importing from Grid';
  if (power < -100) return 'Exporting to Grid';
  if (power > 0) return 'Small Import';
  if (power < 0) return 'Small Export';
  return 'Balanced';
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Never';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return 'Over 1 day ago';
}
</script>

<style scoped>
.homewizard-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

/* Meter Card */
.meter-card {
  background: white;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border: 1px solid #e5e7eb;
  transition: all 0.3s;
}

.meter-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

/* Card Header */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}

.header-left {
  display: flex;
  gap: 0.75rem;
}

.card-icon {
  font-size: 1.5rem;
  color: #f59e0b;
  background: #fef3c7;
  padding: 0.5rem;
  border-radius: 8px;
}

.card-header h4 {
  margin: 0 0 0.25rem 0;
  font-size: 1.125rem;
  color: #1e293b;
}

.card-subtitle {
  font-size: 0.875rem;
  color: #64748b;
}

/* Power Section */
.power-section {
  margin-bottom: 1.5rem;
}

.power-display {
  text-align: center;
  padding: 1.5rem 0;
  background: linear-gradient(to bottom, #f9fafb 0%, #ffffff 100%);
  border-radius: 12px;
  margin-bottom: 1rem;
}

.power-value {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.power-value i {
  font-size: 1.75rem;
}

.power-value.importing {
  color: #dc2626;
}

.power-value.exporting {
  color: #10b981;
}

.power-value.neutral {
  color: #64748b;
}

.unit {
  font-size: 1.25rem;
  font-weight: 400;
  color: #64748b;
}

.power-label {
  font-size: 0.875rem;
  color: #64748b;
  font-weight: 500;
}

/* Phase Grid */
.phase-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.phase-item {
  background: #f9fafb;
  padding: 0.75rem;
  border-radius: 8px;
  text-align: center;
}

.phase-label {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.phase-value {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

/* Totals Section */
.totals-section {
  padding: 1rem 0;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}

.total-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.total-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 8px;
}

.total-item.import {
  background: #fef2f2;
}

.total-item.export {
  background: #f0fdf4;
}

.total-item i {
  font-size: 1.25rem;
}

.total-item.import i {
  color: #dc2626;
}

.total-item.export i {
  color: #10b981;
}

.total-label {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 0.125rem;
}

.total-value {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

/* Details Section */
.details-section {
  margin-bottom: 1rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.detail-item {
  text-align: center;
  padding: 0.75rem;
  background: #f9fafb;
  border-radius: 8px;
}

.detail-label {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 0.25rem;
}

.detail-value {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
}

/* Card Footer */
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.last-update {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #9ca3af;
}

.last-update i {
  font-size: 0.875rem;
}

/* Empty State */
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 3rem 1rem;
  background: white;
  border-radius: 16px;
  border: 2px dashed #e5e7eb;
}

.empty-state i {
  font-size: 3rem;
  color: #cbd5e1;
  margin-bottom: 1rem;
}

.empty-state h4 {
  margin: 0 0 0.5rem 0;
  color: #1e293b;
}

.empty-state p {
  margin: 0 0 1.5rem 0;
  color: #64748b;
}
</style>