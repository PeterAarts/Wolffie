<template>
  <div class="setup-wizard">
    <div class="setup-container">
      <div class="setup-header">
        <h1>{{ isEditMode ? 'Edit Configuration' : 'Welcome to Wolffie' }}</h1>
        <h4>{{ isEditMode ? 'Review and update your system configuration' : ' your Watts monitor Online & Offline' }}</h4>
        <p>{{ isEditMode ? 'Review and update your system configuration' : 'Let\'s set up your system in a few easy steps' }}</p>
        
        <!-- Show current config notice in edit mode -->
        <div v-if="isEditMode" class="edit-mode-notice">
          <i class="pi pi-info-circle"></i>
          <span>Current configuration is pre-filled. Make any changes needed and click Next to save.</span>
        </div>
      </div>

      <div class="setup-progress">
        <div 
          v-for="step in steps" 
          :key="step.number"
          class="progress-step"
          :class="{ active: currentStep === step.number, completed: currentStep > step.number }"
        >
          <div class="step-circle">
            <i v-if="currentStep > step.number" class="pi pi-check"></i>
            <span v-else>{{ step.number }}</span>
          </div>
          <span class="step-label">{{ step.label }}</span>
        </div>
      </div>

      <!-- Step 1: Select Inverter Model -->
      <div v-if="currentStep === 1" class="setup-step">
        <h2>Select your Inverter</h2>
        <p>Choose your inverter brand / model to configure the correct communication (registers)</p>

        <div class="model-selection">
          <div class="search-box">
            <InputText 
              v-model="searchQuery" 
              placeholder="Search models..." 
              class="search-input"
            />
          </div>

          <div class="model-grid">
            <div 
              v-for="model in filteredModels" 
              :key="model.id"
              class="model-card"
              :class="{ selected: selectedModel?.id === model.id }"
              @click="selectModel(model)"
            >
              <div class="model-icon">
                <i class="pi pi-bolt"></i>
              </div>
              <div class="model-info">
                <h3>{{ model.model_name }}</h3>
                <p class="model-manufacturer">{{ model.manufacturer }}</p>
                <div class="model-specs">
                  <span><i class="pi pi-database"></i> {{ model.battery_capacity_kwh }} kWh</span>
                  <span><i class="pi pi-sun"></i> {{ model.max_pv_input_kw }} kW PV</span>
                  <span><i class="pi pi-chart-line"></i> {{ model.mppt_inputs }} MPPT</span>
                </div>
              </div>
              <div v-if="selectedModel?.id === model.id" class="selected-badge">
                <i class="pi pi-check"></i>
              </div>
            </div>
          </div>

          <div v-if="filteredModels.length === 0" class="no-models">
            <i class="pi pi-search"></i>
            <p>No models found. Try a different search term.</p>
          </div>
        </div>
      </div>

      <!-- Step 2: Configure ModBus -->
      <div v-if="currentStep === 2" class="setup-step">
        <h2>Configure the connection</h2>
        <p>Enter the connection details for your  inverter</p>

        <div class="config-form">
          <!-- Model Selection -->
          <div class="form-section">
            <h3>Inverter Model</h3>
            <div class="model-selector">
              
              <div v-if="selectedModbusModel" class="model-info-box">
                <div class="info-row">
                  <span class="info-label">Model:</span>
                  <span class="info-value">{{ getModelInfo(selectedModbusModel).name }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Battery Capacity:</span>
                  <span class="info-value">{{ getModelInfo(selectedModbusModel).battery }} kWh</span>
                </div>
                <div class="info-row">
                  <span class="info-label">MPPT Inputs:</span>
                  <span class="info-value">{{ getModelInfo(selectedModbusModel).mppt }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Registers:</span>
                  <span class="info-value">{{ getModelInfo(selectedModbusModel).registers }} configured</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ModBus Connection Settings -->
          <div class="form-section">
            <h3>Connection Settings</h3>
            <div class="form-grid">
              <div class="form-field">
                <label>IP Address</label>
                <InputText 
                  v-model="modbusConfig.ip" 
                  placeholder="192.168.1.158"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Port</label>
                <InputNumber 
                  v-model="modbusConfig.port" 
                  :min="1"
                  :max="65535"
                  placeholder="502"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Slave ID</label>
                <InputNumber 
                  v-model="modbusConfig.slaveId" 
                  :min="1"
                  :max="247"
                  placeholder="85"
                  class="w-full"
                />
              </div>
            </div>
            <div class="test-section">
            <Button 
              label="Test Connection" 
              icon="pi pi-bolt"
              @click="testModbusConnection"
              :loading="testingConnection"
              outlined
            />
            
            <div v-if="connectionTestResult" class="test-result" :class="{ success: connectionTestResult.success, error: !connectionTestResult.success }">
              <i :class="connectionTestResult.success ? 'pi pi-check-circle' : 'pi pi-times-circle'"></i>
              <span>{{ connectionTestResult.message }}</span>
            </div>
          </div>
          </div>

          <!-- Test Connection -->
          
        </div>
      </div>

      <!-- Step 3: Cloud API (Optional) -->
      <div v-if="currentStep === 3" class="setup-step">
        <h2>Cloud API Configuration</h2>
        <p>Connect to Provider Cloud for additional features </p>

        <div class="config-form">
          <div class="form-section">
            <h3>Cloud Credentials</h3>
            <p class="section-help">Enter your Cloud API credentials to enable cloud monitoring</p>
            
            <div class="form-grid">
              <div class="form-field">
                <label>App ID</label>
                <InputText 
                  v-model="cloudConfig.appId" 
                  placeholder="Your App ID"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>App Secret</label>
                <Password 
                  v-model="cloudConfig.appSecret" 
                  placeholder="Your App Secret"
                  :feedback="false"
                  toggleMask
                  class="w-full"
                />
              </div>
              <div class="form-field ">
                <label>System SN</label>
                <InputText 
                  v-model="cloudConfig.systemSn" 
                  placeholder="Your System Serial Number"
                  class="w-full"
                />
              </div>
              <div class="form-field ">
                <label>API Endpoint URL</label>
                <InputText 
                  v-model="cloudConfig.endpointUrl" 
                  placeholder="https://openapi.alphaess.com/api"
                  class="w-full"
                />
              </div>
            </div>
          </div> 
          <!-- Test Cloud Connection -->
          <div class="test-section">
            <Button 
              label="Test Cloud Connection" 
              icon="pi pi-cloud"
              @click="testCloudConnection"
              :loading="testingCloud"
              outlined
            />
            
            <div v-if="cloudTestResult" class="test-result" :class="{ success: cloudTestResult.success, error: !cloudTestResult.success }">
              <i :class="cloudTestResult.success ? 'pi pi-check-circle' : 'pi pi-times-circle'"></i>
              <span>{{ cloudTestResult.message }}</span>
            </div>
          </div>         
        </div>
      </div>

      <!-- Step 4: Review -->
      <div v-if="currentStep === 4" class="setup-step">
        <h2>Review Your Configuration</h2>
        <p>Please verify your settings before completing setup</p>

        <div class="review-sections">
          <!-- Inverter Model -->
          <div class="review-section">
            <div class="review-header">
              <i class="pi pi-bolt"></i>
              <h3>Inverter Model</h3>
            </div>
            <div class="review-content">
              <div class="review-item">
                <span class="item-label">Manufacturer:</span>
                <span class="item-value">{{ getModelInfo(selectedModbusModel).name.split(' ')[0] }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">Model:</span>
                <span class="item-value">{{ getModelInfo(selectedModbusModel).name }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">Battery:</span>
                <span class="item-value">{{ getModelInfo(selectedModbusModel).battery }} kWh</span>
              </div>
            </div>
          </div>

          <!-- ModBus Connection -->
          <div class="review-section">
            <div class="review-header">
              <i class="pi pi-sitemap"></i>
              <h3>ModBus Connection</h3>
            </div>
            <div class="review-content">
              <div class="review-item">
                <span class="item-label">Model:</span>
                <span class="item-value">{{ getModelInfo(selectedModbusModel).name }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">IP Address:</span>
                <span class="item-value">{{ modbusConfig.ip }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">Port:</span>
                <span class="item-value">{{ modbusConfig.port }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">Slave ID:</span>
                <span class="item-value">{{ modbusConfig.slaveId }}</span>
              </div>
              <div class="review-item">
                <span class="item-label">Registers:</span>
                <span class="item-value">{{ getModelInfo(selectedModbusModel).registers }} configured</span>
              </div>
            </div>
          </div>

          <!-- Cloud API -->
          <div class="review-section">
            <div class="review-header">
              <i class="pi pi-cloud"></i>
              <h3>Cloud API</h3>
            </div>
            <div class="review-content">
              <div v-if="cloudConfig.appId" class="review-item">
                <span class="item-label">App ID:</span>
                <span class="item-value">{{ cloudConfig.appId }}</span>
              </div>
              <div v-if="cloudConfig.systemSn" class="review-item">
                <span class="item-label">System SN:</span>
                <span class="item-value">{{ cloudConfig.systemSn }}</span>
              </div>
              <div v-if="cloudConfig.appId" class="review-item">
                <span class="item-label">Status:</span>
                <span class="item-value">
                  <Badge value="Enabled" severity="success" />
                </span>
              </div>
              <div v-else class="review-item">
                <span class="item-label">Status:</span>
                <span class="item-value text-muted">Not configured</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="setup-actions">
        <Button 
          v-if="currentStep > 1"
          label="Back" 
          icon="pi pi-arrow-left"
          @click="previousStep"
          outlined
        />
        
        <div class="spacer"></div>
        
        <Button 
          v-if="currentStep === 3"
          label="Skip Cloud Setup" 
          @click="skipCloudSetup"
          outlined
          severity="secondary"
        />
        
        <Button 
          v-if="currentStep < 4"
          label="Next" 
          icon="pi pi-arrow-right"
          iconPos="right"
          @click="nextStep"
          :disabled="!canProceed"
        />
        
        <Button 
          v-if="currentStep === 4"
          label="Complete Setup" 
          icon="pi pi-check"
          @click="completeSetup"
          :loading="completing"
        />
      </div>
    </div>

    <Toast />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Dropdown from 'primevue/dropdown';
import Badge from 'primevue/badge';
import Toast from 'primevue/toast';

const router = useRouter();
const toast = useToast();

// State
const currentStep = ref(1);
const isEditMode = ref(false);
const searchQuery = ref('');
const models = ref([]);
const modbusModels = ref([]);
const selectedModel = ref(null);
const selectedModbusModel = ref(null);
const testingConnection = ref(false);
const testingCloud = ref(false);
const completing = ref(false);
const connectionTestResult = ref(null);
const cloudTestResult = ref(null);

const modbusConfig = ref({
  ip: '',
  port: 502,
  slaveId: 85,
  enabled: true
});

const cloudConfig = ref({
  appId: '',
  appSecret: '',
  systemSn: '',
  endpointUrl: 'https://openapi.alphaess.com/api',
  enabled: true
});

const steps = [
  { number: 1, label: 'Select Model' },
  { number: 2, label: 'Configure Direct connection' },
  { number: 3, label: 'Cloud API' },
  { number: 4, label: 'Review' }
];

// Computed
const filteredModels = computed(() => {
  if (!searchQuery.value) return models.value;
  
  const query = searchQuery.value.toLowerCase();
  return models.value.filter(model => 
    model.model_name.toLowerCase().includes(query) ||
    model.manufacturer.toLowerCase().includes(query) ||
    model.model_series.toLowerCase().includes(query)
  );
});

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return selectedModel.value !== null;
    case 2:
      return selectedModbusModel.value && modbusConfig.value.ip && modbusConfig.value.port && modbusConfig.value.slaveId;
    case 3:
      return true; // Cloud API is optional
    case 4:
      return true;
    default:
      return false;
  }
});

// ============================================================================
// LOAD EXISTING CONFIGURATION
// ============================================================================

const loadExistingConfiguration = async () => {
  try {
   
    // Load setup status and selected model
    const statusResponse = await axios.get('http://localhost:3000/api/setup/status');
    
    if (statusResponse.data.setupCompleted) {
      isEditMode.value = true;
    }
    
    // Load selected model
    if (statusResponse.data.selectedModel) {
      const model = statusResponse.data.selectedModel;
      selectedModel.value = model;
      selectedModbusModel.value = model.id;
    }
    
    // Load ModBus configuration
    try {
      const modbusResponse = await axios.get('http://localhost:3000/api/settings/category/modbus');
      if (modbusResponse.data) {
        modbusConfig.value = {
          ip: modbusResponse.data.ip_address || '',
          port: parseInt(modbusResponse.data.port) || 502,
          slaveId: parseInt(modbusResponse.data.slave_id) || 85,
          enabled: modbusResponse.data.enabled !== '0'
        };
      }
    } catch (error) {
      console.log('ℹ️ No ModBus config found');
    }
    
    // Load Cloud API configuration
    try {
      const cloudResponse = await axios.get('http://localhost:3000/api/settings/category/cloud_api');
      if (cloudResponse.data) {
        cloudConfig.value = {
          appId: cloudResponse.data.app_id || '',
          appSecret: '', // Never load secret for security
          systemSn: cloudResponse.data.system_sn || '',
          endpointUrl: cloudResponse.data.endpoint_url || 'https://openapi.alphaess.com/api',
          enabled: cloudResponse.data.enabled !== '0'
        };
      }
    } catch (error) {
      console.log('ℹ️ No Cloud API config found');
    }
    
  } catch (error) {
    console.error('❌ Error loading configuration:', error);
  }
};

// ============================================================================
// LOAD MODELS
// ============================================================================

const loadModels = async () => {
  try {
    const response = await axios.get('http://localhost:3000/api/modbus/models');
    models.value = response.data;
    
    // Also populate ModBus models dropdown
    modbusModels.value = response.data.map(model => ({
      label: `${model.manufacturer} ${model.model_name}`,
      value: model.id,
      ...model
    }));
    
    console.log('✅ Loaded models:', models.value.length);
  } catch (error) {
    console.error('❌ Error loading models:', error);
    toast.add({ 
      severity: 'error', 
      summary: 'Error', 
      detail: 'Failed to load inverter models', 
      life: 5000 
    });
  }
};

// ============================================================================
// SELECT MODEL (Step 1) - SAVE IMMEDIATELY
// ============================================================================

const selectModel = async (model) => {
  selectedModel.value = model;
  selectedModbusModel.value = model.id;
  modbusConfig.value.slaveId = model.default_slave_id || 85;
  
  // Save model to database immediately
  try {
    await axios.post('http://localhost:3000/api/setup/select-model', {
      modelId: model.id
    });
    console.log('✅ Model saved:', model.model_name);
  } catch (error) {
    console.error('❌ Error saving model:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to save model selection',
      life: 3000
    });
  }
};

// ============================================================================
// SAVE MODBUS CONFIG
// ============================================================================

const saveModbusConfig = async () => {
  try {
    await axios.post('http://localhost:3000/api/settings/modbus', {
      ip_address: modbusConfig.value.ip,
      port: modbusConfig.value.port,
      slave_id: modbusConfig.value.slaveId,
      enabled: modbusConfig.value.enabled
    });
    console.log('✅ ModBus config saved');
    return true;
  } catch (error) {
    console.error('❌ Error saving ModBus config:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to save ModBus configuration',
      life: 3000
    });
    return false;
  }
};

// ============================================================================
// SAVE CLOUD API CONFIG
// ============================================================================

const saveCloudApiConfig = async () => {
  // Only save if user entered data
  if (!cloudConfig.value.appId || !cloudConfig.value.systemSn) {
    console.log('ℹ️ Cloud API not configured, skipping');
    return true;
  }
  
  try {
    await axios.post('http://localhost:3000/api/settings/system/cloud-api', {
      app_id: cloudConfig.value.appId,
      app_secret: cloudConfig.value.appSecret,
      system_sn: cloudConfig.value.systemSn,
      endpoint_url: cloudConfig.value.endpointUrl,
      enabled: cloudConfig.value.enabled
    });
    console.log('✅ Cloud API config saved');
    return true;
  } catch (error) {
    console.error('❌ Error saving Cloud API config:', error);
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to save Cloud API configuration',
      life: 3000
    });
    return false;
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getModelInfo = (modelId) => {
  if (!modelId) return { name: '-', battery: '-', mppt: '-', registers: '-', slaveId: 85 };
  
  const model = modbusModels.value.find(m => m.value === modelId);
  if (!model) return { name: '-', battery: '-', mppt: '-', registers: '-', slaveId: 85 };
  
  return {
    name: `${model.manufacturer} ${model.model_name}`,
    battery: model.battery_capacity_kwh || '-',
    mppt: model.mppt_inputs || '-',
    registers: model.register_count || '50+',
    slaveId: model.default_slave_id || 85
  };
};

const onModbusModelChange = (event) => {
  const modelId = event.value;
  const model = modbusModels.value.find(m => m.value === modelId);
  
  if (model && model.default_slave_id) {
    modbusConfig.value.slaveId = model.default_slave_id;
  }
  
  // Also select this model for Step 1 if not already selected
  if (!selectedModel.value) {
    selectedModel.value = models.value.find(m => m.id === modelId);
  }
};

// ============================================================================
// TEST CONNECTIONS
// ============================================================================

const testModbusConnection = async () => {
  testingConnection.value = true;
  connectionTestResult.value = null;
  
  try {
    const response = await axios.post('http://localhost:3000/api/settings/test/modbus-connection', {
      ip: modbusConfig.value.ip,
      port: modbusConfig.value.port,
      slaveId: modbusConfig.value.slaveId
    });

    connectionTestResult.value = {
      success: true,
      message: response.data.message || 'Connection successful!'
    };
  } catch (error) {
    connectionTestResult.value = {
      success: false,
      message: error.response?.data?.message || 'Connection failed'
    };
  } finally {
    testingConnection.value = false;
  }
};

const testCloudConnection = async () => {
  testingCloud.value = true;
  cloudTestResult.value = null;
  
  try {
    const response = await axios.post('http://localhost:3000/api/settings/test/cloud-connection', {
      appId: cloudConfig.value.appId,
      appSecret: cloudConfig.value.appSecret,
      systemSn: cloudConfig.value.systemSn
    });

    cloudTestResult.value = {
      success: true,
      message: response.data.message || 'Connection successful!'
    };
  } catch (error) {
    cloudTestResult.value = {
      success: false,
      message: error.response?.data?.message || 'Connection failed'
    };
  } finally {
    testingCloud.value = false;
  }
};

// ============================================================================
// NAVIGATION
// ============================================================================

const nextStep = async () => {
  if (!canProceed.value || currentStep.value >= 4) return;
  
  // Save current step's data before proceeding
  let saved = true;
  
  if (currentStep.value === 1) {
    // Auto-select ModBus model when moving from Step 1 to Step 2
    if (selectedModel.value && !selectedModbusModel.value) {
      selectedModbusModel.value = selectedModel.value.id;
      if (selectedModel.value.default_slave_id) {
        modbusConfig.value.slaveId = selectedModel.value.default_slave_id;
      }
    }
  } else if (currentStep.value === 2) {
    // Save ModBus config when leaving step 2
    saved = await saveModbusConfig();
  } else if (currentStep.value === 3) {
    // Save Cloud API config when leaving step 3
    saved = await saveCloudApiConfig();
  }
  
  if (!saved) {
    // Don't proceed if save failed
    return;
  }
  
  currentStep.value++;
};

const previousStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
    connectionTestResult.value = null;
    cloudTestResult.value = null;
  }
};

const skipCloudSetup = () => {
  cloudConfig.value = { 
    appId: '', 
    appSecret: '', 
    systemSn: '',
    endpointUrl: 'https://openapi.alphaess.com/api',
    enabled: false
  };
  nextStep();
};

// ============================================================================
// COMPLETE SETUP
// ============================================================================

import { useConfigStore } from '@/stores/config'; // Add this import

const configStore = useConfigStore();

const completeSetup = async () => {
  completing.value = true;
  try {
    // 1. Save pending Cloud API changes
    await saveCloudApiConfig();
    
    // 2. Use the store action instead of raw axios
    const success = await configStore.completeSetup();
    
    if (success) {
      toast.add({
        severity: 'success',
        summary: 'Setup Complete',
        detail: 'Your system is configured and ready to use',
        life: 3000
      });
      
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } else {
      throw new Error("Backend failed to mark setup as complete");
    }
  } catch (error) {
    console.error('❌ Error completing setup:', error);
    // ... error handling
  } finally {
    completing.value = false;
  }
};

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(async () => {
  await loadModels();
  await loadExistingConfiguration();
});
</script>

<style scoped>
/* Previous styles remain the same - just using the existing CSS from your file */
.setup-wizard         {min-height: 100vh;background: transparent;display: flex;align-items: center;justify-content: center;padding: 2rem;}
.setup-container      {background: white;border-radius: 16px;padding: 3rem;max-width: 1400px;width: 100%;box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);}
.setup-header         {text-align: center;margin-bottom: 3rem;}
.setup-header h1      {margin: 0 0 0.5rem 0;font-size: 2rem;color: #1e293b;}
.setup-header p       {margin: 0;color: #64748b;font-size: 1.125rem;}
.edit-mode-notice     {display: flex;align-items: center;justify-content: center;gap: 0.5rem;margin-top: 1rem;padding: 0.75rem 1rem;background: #f0f9ff;border: 1px solid #bae6fd;border-radius: 8px;color: #0c4a6e;font-size: 0.875rem;}
.setup-progress       {display: flex;justify-content: space-between;margin-bottom: 3rem;position: relative;}
.setup-progress::before 
                      {content: ''; position: absolute; top: 20px; left: 10%; right: 10%; height: 2px; background: #e2e8f0; z-index: 0;}
.progress-step        {display: flex;  flex-direction: column;  align-items: center;  gap: 0.5rem;  position: relative;  z-index: 1;}
.step-circle          {width: 40px;  height: 40px;  border-radius: 50%;  background: #e2e8f0;  display: flex;  align-items: center;  justify-content: center;  font-weight: 600;  color: #64748b;  transition: all 0.3s;}
.progress-step.active .step-circle 
                      {background: #667eea;color: white;box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);}
.progress-step.completed .step-circle 
                      {background: #10b981;color: white;}
.step-label           {font-size: 0.875rem;color: #64748b;font-weight: 500;}
.setup-step           {margin-bottom: 2rem;}
.setup-step h2        {margin: 0 0 0.5rem 0;font-size: 1.5rem;color: #1e293b;}
.setup-step > p       {margin: 0 0 2rem 0;color: #64748b;}
.model-selection      {display: flex;flex-direction: column;gap: 1.5rem;}
.search-input         {width: 100%;}

.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
  max-height: 400px;
  overflow-y: auto;
  padding: 0.5rem;
}

.model-card {
  border: 3px solid transparent;
  background: #f9f9f9;
  border-radius: 12px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.3s;
  position: relative;
}

.model-card:hover {
  border-color:#6c6c6d;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
  background-color: #f3f3f3;
  border-width:3px;
}

.model-card.selected {
  border-color: #667eea;
  background: #f8f9ff;
  border-width:3px;
}

.model-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: #667eea;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5rem;
  margin-bottom: 1rem;
}

.model-info h3 {
  margin: 0 0 0.25rem 0;
  font-size: 1.125rem;
  color: #1e293b;
}

.model-manufacturer {
  margin: 0 0 0.75rem 0;
  color: #64748b;
  font-size: 0.875rem;
}

.model-specs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: #64748b;
}

.model-specs span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.selected-badge {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #10b981;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.no-models {
  text-align: center;
  padding: 3rem 1rem;
  color: #64748b;
}

.no-models i {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.5;
}

.config-form {
  display: flex;
  flex-direction: row;
  gap: 3rem;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-section h3 {
  margin: 0;
  font-size: 1.125rem;
  color: #1e293b;
}

.section-help {
  margin: 0;
  font-size: 0.875rem;
  color: #64748b;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1rem;
  flex:2;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field.full-width {
  grid-column: 1 / -1;
}

.form-field label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
}

.model-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width:400px
}

.model-info-box {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.info-label {
  color: #64748b;
  font-weight: 500;
}

.info-value {
  color: #1e293b;
  font-weight: 600;
}

.test-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.test-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
}

.test-result.success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.test-result.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.skip-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #64748b;
  font-size: 0.875rem;
}

.review-sections {
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
}

.review-section {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  flex: 1;
}

.review-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.review-header i {
  color: #667eea;
  font-size: 1.25rem;
}

.review-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #1e293b;
  font-weight: 600;
}

.review-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.review-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.item-label {
  color: #64748b;
  font-size: 0.875rem;
  font-weight: 500;
}

.item-value {
  color: #1e293b;
  font-size: 0.875rem;
  font-weight: 600;
}

.item-value.text-muted {
  color: #64748b;
  font-weight: 500;
}

.setup-actions {
  display: flex;
  gap: 1rem;
  padding-top: 2rem;
  border-top: 1px solid #e2e8f0;
}

.spacer {
  flex: 1;
}

@media (max-width: 768px) {
  .setup-container {
    padding: 2rem 1.5rem;
  }
  
  .model-grid {
    grid-template-columns: 1fr;
  }
  
  .form-grid {
    grid-template-columns: 1fr;
  }
  
  .setup-actions {
    flex-direction: column;
  }
  
  .spacer {
    display: none;
  }
}
</style>