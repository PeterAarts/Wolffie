<!-- DynamicSystemDiagram-VueFlow-Nested.vue -->
<template>
  <div class="dynamic-system-diagram">
    <!-- Controls -->
    <div class="diagram-controls">
      <div class="view-mode-selector">
        <SelectButton v-model="viewMode" :options="viewModeOptions" optionLabel="label" optionValue="value" />
      </div>
    </div>

    <!-- Vue Flow Diagram -->
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :fit-view-on-init="true"
      :nodes-draggable="false"
      :zoom-on-scroll="false"
      :pan-on-scroll="false"
      :zoom-on-pinch="false"
      :pan-on-drag="false"
      :prevent-scrolling="false"
      class="vue-flow-container"
      :style="{ height: canvasHeight + 'px' }"
    >
      <!-- Location Container Node (Parent) -->
      <template #node-location="{ data }">
        <div class="location-container" :style="{ 
          width: data.width + 'px', 
          height: data.height + 'px',
          borderColor: data.borderColor 
        }">
          <div class="location-header">{{ data.label }}</div>
        </div>
      </template>

      <!-- Main Component Node -->
      <template #node-main="{ data, id, position }">
        <Handle :id="`${id}-top`" type="target" :position="Position.Top" />
        <Handle :id="`${id}-left`" type="target" :position="Position.Left" />
        <Handle :id="`${id}-right`" type="target" :position="Position.Right" />
        <Handle :id="`${id}-bottom`" type="target" :position="Position.Bottom" />
        <!-- Multiple bottom source handles with X and Y offsets for staggered lines -->
        <Handle :id="`${id}-bottom-left`" type="target" :position="Position.Bottom" :style="{ left: '25%' }" />
        <Handle :id="`${id}-bottom-center`" type="target" :position="Position.Bottom" :style="{ left: '50%' }" />
        <Handle :id="`${id}-bottom-right`" type="target" :position="Position.Bottom" :style="{ left: '75%' }" />
        <!-- Staggered Y positions with pixel offsets -->
        <Handle :id="`${id}-bottom-left-offset`" type="target" :position="Position.Bottom" :style="{ left: '25%', top: 'calc(100% + 20px)' }" />
        <Handle :id="`${id}-bottom-center-offset`" type="target" :position="Position.Bottom" :style="{ left: '50%', top: 'calc(100% + 10px)' }" />
        <Handle :id="`${id}-bottom-right-offset`" type="target" :position="Position.Bottom" :style="{ left: '75%', top: '100%' }" />
        
        <div class="main-node" :style="{ backgroundColor: data.color }">
          <div class="node-label">{{ data.label }}</div>
          <div v-if="data.powerData" class="power-data-main">
            <div v-if="data.powerData.currentIn !== undefined" class="power-item-main">
              <span class="power-label-main">in:</span>
              <span class="power-value-main">{{ formatPowerForNode(data.powerData.currentIn) }}</span>
            </div>
            <div v-if="data.powerData.currentOut !== undefined" class="power-item-main">
              <span class="power-label-main">Out:</span>
              <span class="power-value-main">{{ formatPowerForNode(data.powerData.currentOut) }}</span>
            </div>
          </div>
        </div>
        
        <Handle :id="`${id}-top`" type="source" :position="Position.Top" />
        <Handle :id="`${id}-left`" type="source" :position="Position.Left" />
        <Handle :id="`${id}-right`" type="source" :position="Position.Right" />
        <Handle :id="`${id}-bottom`" type="source" :position="Position.Bottom" />
        <!-- Multiple bottom source handles with X and Y offsets for staggered lines -->
        <Handle :id="`${id}-bottom-left`" type="source" :position="Position.Bottom" :style="{ left: '25%' }" />
        <Handle :id="`${id}-bottom-center`" type="source" :position="Position.Bottom" :style="{ left: '50%' }" />
        <Handle :id="`${id}-bottom-right`" type="source" :position="Position.Bottom" :style="{ left: '75%' }" />
        <!-- Staggered Y positions with pixel offsets -->
        <Handle :id="`${id}-bottom-left-offset`" type="source" :position="Position.Bottom" :style="{ left: '25%', top: 'calc(100% + 20px)' }" />
        <Handle :id="`${id}-bottom-center-offset`" type="source" :position="Position.Bottom" :style="{ left: '50%', top: 'calc(100% + 10px)' }" />
        <Handle :id="`${id}-bottom-right-offset`" type="source" :position="Position.Bottom" :style="{ left: '75%', top: '100%' }" />
      </template>

      <!-- Group Node -->
      <template #node-group="{ data, id, position }">
        <Handle :id="`${id}-top`" type="target" :position="Position.Top" />
        <Handle :id="`${id}-left`" type="target" :position="Position.Left" />
        <Handle :id="`${id}-right`" type="target" :position="Position.Right" />
        <Handle :id="`${id}-bottom`" type="target" :position="Position.Bottom" />
        <div class="group-node" :style="getGroupNodeStyle(data)">
          <div class="node-label">{{ data.label }}</div>
          
          <!-- Power Data -->
          <div v-if="data.powerData" class="power-data-group">
            <div v-if="data.powerData.currentIn !== undefined" class="power-item-small">
              <span class="power-label-small">using </span>
              <span class="power-value-small">{{ formatPowerForNode(data.powerData.currentIn) }}</span>
            </div>
            <div v-if="data.powerData.currentOut !== undefined" class="power-item-small">
              <span class="power-label-small">produce</span>
              <span class="power-value-small">{{ formatPowerForNode(data.powerData.currentOut) }}</span>
            </div>
          </div>
          
        </div>
        <Handle :id="`${id}-top`" type="source" :position="Position.Top" />
        <Handle :id="`${id}-left`" type="source" :position="Position.Left" />
        <Handle :id="`${id}-right`" type="source" :position="Position.Right" />
        <Handle :id="`${id}-bottom`" type="source" :position="Position.Bottom" />
      </template>
    </VueFlow>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { VueFlow, Position, Handle } from '@vue-flow/core';
import axios from 'axios';
import { useSystemStore } from '@/stores/system';

const props = defineProps({
  powerData: {
    type: Object,
    default: () => ({})
  },
  mode: {
    type: String,
    default: 'realtime'
  }
});

const viewMode = ref('simple');
const components = ref([]);
const flows = ref([]);
const nodes = ref([]);
const edges = ref([]);
const canvasHeight = ref(500);
const powerData = ref({}); // Reactive power data from WebSocket
let ws = null; // WebSocket connection
 
// OPTIONAL STORE INTEGRATION (works without store too)
const systemStore = useSystemStore();
console.log('📦 System store available:', !!systemStore);
let isConnected = ref(false);
let autoRefreshEnabled = ref(true);

// Store will be initialized later if available
const initializeStore = () => {
  try {
    // This will only work if systemStore.js exists and Pinia is configured
    // If not, component still works with local state
    const storeModule = { useSystemStore: null };
    // Comment these back in when store is ready:
    // const { useSystemStore } = require('@/stores/systemStore');
    // const { storeToRefs } = require('pinia');
    // systemStore = useSystemStore();
    // const storeRefs = storeToRefs(systemStore);
    // isConnected = storeRefs.isConnected;
    // autoRefreshEnabled = storeRefs.autoRefreshEnabled;
    console.log('Store integration disabled - using local state');
  } catch (err) {
    console.warn('System store not available, using local state');
  }
};

initializeStore();

// WebSocket connection for real-time power data
const connectWebSocket = () => {
  // TODO: Replace with your actual WebSocket URL
  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
  const fullUrl = wsUrl.endsWith('/ws/power-data') ? wsUrl : `${wsUrl}/ws/power-data`;
  
  console.log('🔌 Connecting to:', fullUrl);  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected');
  };
  
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      // Handle different message types
      if (message.type === 'modbus_connected') {
        // ModBus reconnected - restart auto-refresh!
        console.log('🔄 ModBus reconnected - restarting auto-refresh');
        isConnected.value = true;
        autoRefreshEnabled.value = true;
        if (systemStore && systemStore.handleConnectionRestored) {
          systemStore.handleConnectionRestored();
        }
        
      } else if (message.type === 'modbus_disconnected') {
        // ModBus disconnected - stop auto-refresh!
        console.log('⚠️ ModBus disconnected - stopping auto-refresh');
        isConnected.value = false;
        autoRefreshEnabled.value = false;
        if (systemStore && systemStore.handleConnectionLost) {
          systemStore.handleConnectionLost();
        }
        
      } else if (message.type === 'connection_status') {
        // Initial connection status
        console.log('📊 Connection status:', message.connected);
        isConnected.value = message.connected;
        if (systemStore) {
          systemStore.isConnected = message.connected;
        }
              
      } else if (message.batterySOC !== undefined) {
        console.log('🔋 Updating powerData with batterySOC:', message.batterySOC);
        powerData.value = message;
        
        // ADD THIS - Update system store
        if (systemStore) {
          systemStore.updateFromWebSocket(message);
        }
      } else if (message.data && message.data.batterySOC !== undefined) {
        // Wrapped power update
        if (autoRefreshEnabled.value) {
          powerData.value = message.data;
        }
      } else {
        // Default: treat as power data (backward compatible)
        if (autoRefreshEnabled.value) {
          powerData.value = message;
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting in 5s...');
    // Only reconnect if we're still mounted
    if (ws) {
      setTimeout(connectWebSocket, 5000);
    }
  };
};

// Cleanup on unmount
onUnmounted(() => {
  if (ws) {
    ws.close();
    ws = null;  // Prevent reconnection
  }
});

// Load architecture
onMounted(async () => {
  console.log('🚀 DynamicSystemDiagram mounting...');
  
  // Store is initialized by Dashboard - don't initialize here
  // WebSocket will handle connection status updates
  
  // Load diagram regardless of store status
  try {
    console.log('📊 Loading architecture...');
    await loadArchitecture();
    
    console.log('🏗️ Building nodes and edges...');
    buildNodesAndEdges();
    
    console.log('🔌 Connecting WebSocket...');
    connectWebSocket();
    
    console.log('✅ DynamicSystemDiagram mounted successfully');
  } catch (err) {
    console.error('❌ Error during mount:', err);
  }
});

const loadArchitecture = async () => {
  try {
    
    const timestamp = Date.now();
    const response = await axios.get(`http://localhost:3000/api/system/architecture?_t=${timestamp}`);
    
    const arch = response.data;
    arch.levels.forEach(level => {
      level.components.forEach(comp => {
        if (comp.subComponents && comp.subComponents.length > 0) {
          comp.subComponents.forEach(sub => {
            if (sub.subComponents && sub.subComponents.length > 0) {
              sub.subComponents.forEach(device => {
              });
            }
          });
        }
        if (comp.flowTo && comp.flowTo.length > 0) {
        }
      });
    });
    
    if (!arch || !arch.levels || arch.levels.length === 0) {
      return;
    }
    
    // Extract components and flows
    const allComps = [];
    const flowList = [];
    let flowId = 0;
    
    arch.levels.forEach(level => {
      level.components.forEach(comp => {
        // Main component
        allComps.push({
          component_key: comp.component_key,
          name: comp.name,
          type: comp.type,
          category: comp.category,
          location_type: level.name,
          location_label: level.label,
          parent_id: null,
          color: comp.color || '#1e5a78',
          specs: comp.specs
        });
        
        // Groups
        if (comp.subComponents && comp.subComponents.length > 0) {
          comp.subComponents.forEach(group => {
            const devices = group.subComponents || [];
            
            allComps.push({
              component_key: group.component_key,
              name: group.name,
              type: group.type,
              category: 'group',
              parent_id: comp.component_key,
              location_type: level.name,
              location_label: level.label,
              devices: devices.map(d => ({ 
                name: d.name, 
                type: d.type,
                specs: d.specs 
              })),
              specs: group.specs
            });
            
            // Extract flows from groups too!
            if (group.flowTo && group.flowTo.length > 0) {
              group.flowTo.forEach(targetKey => {
                flowList.push({
                  id: `flow-${flowId++}`,
                  from: group.component_key,
                  to: targetKey,
                  type: group.flowType || 'primary',
                  bidirectional: group.flowDirection === 'bidirectional',
                  color: group.flowColor || (group.flowDirection === 'bidirectional' ? '#f97316' : '#4a7c59')
                });
              });
            }
          });
        }
        
        // Flows from main components
        if (comp.flowTo && comp.flowTo.length > 0) {
          comp.flowTo.forEach(targetKey => {
            flowList.push({
              id: `flow-${flowId++}`,
              from: comp.component_key,
              to: targetKey,
              type: comp.flowType || 'primary',
              bidirectional: comp.flowDirection === 'bidirectional',
              color: comp.flowColor || (comp.flowDirection === 'bidirectional' ? '#f97316' : '#4a7c59')
            });
          });
        }
      });
    });
    
    
    components.value = allComps;
    flows.value = flowList;
    
  } catch (error) {
    console.error('❌ Error loading architecture:', error);
    console.error('Error details:', error.response?.data || error.message);
    
    // Set empty data so diagram still tries to render
    components.value = [];
    flows.value = [];
    
    // Show error to user
    alert(`Failed to load system architecture: ${error.message}\n\nPlease check:\n1. Is the API server running?\n2. Is http://localhost:3000 accessible?\n3. Check browser console for details`);
  }
};

const buildNodesAndEdges = () => {
  console.log('🏗️ Building nodes and edges...');
  console.log('Components:', components.value?.length || 0);
  console.log('Flows:', flows.value?.length || 0);
  
  // Safety check
  if (!components.value || components.value.length === 0) {
    console.warn('⚠️ No components to build - architecture may not be loaded');
    nodes.value = [];
    edges.value = [];
    return;
  }
  
  flows.value.forEach((flow, idx) => {
  });
  
  components.value.forEach(comp => {
  });
  
  const nodeList = [];
  const edgeList = [];
  
  // Group components by location
  const locations = {};
  components.value.forEach(comp => {
    if (!comp.parent_id && comp.location_type) {
      if (!locations[comp.location_type]) {
        locations[comp.location_type] = {
          key: comp.location_type,
          label: comp.location_label,
          mains: [],
          groups: []
        };
      }
      
      if (comp.category === 'main' || comp.category === 'external') {
        locations[comp.location_type].mains.push(comp);
      }
    }
  });
  
  // Add groups to locations
  components.value.forEach(comp => {
    // Only add groups (devices are already inside them from the API)
    if (comp.category === 'group') {
      // Check if parent is a main component or if this is a top-level group
      const parent = comp.parent_id ? components.value.find(c => c.component_key === comp.parent_id) : null;
      
      if (!comp.parent_id || (parent && parent.category === 'main')) {
        if (comp.location_type && locations[comp.location_type]) {
          // Devices are already in comp.devices from loadArchitecture
          const devices = comp.devices || [];
          
          locations[comp.location_type].groups.push({
            ...comp,
            devices
          });
        }
      }
    }
  });
  
  // Sort locations
  const sortedLocations = Object.entries(locations).sort(([a], [b]) => {
    const order = { external: 0, house: 1, main_house: 1, building_a: 2 };
    return (order[a] ?? 3) - (order[b] ?? 3);
  });
  
  
  // Layout constants
  const locationWidth = 300;
  const locationPadding = 20;
  const mainNodeWidth = 120;
  const mainNodeHeight = 70; // Increased for power data
  const groupNodeWidth = 120;
  const groupNodeHeightSimple = 45; // Optimized for power data
  const groupNodeHeightDetailed = 110; // Optimized for power data + specs
  const groupNodeHeight = viewMode.value === 'detailed' ? groupNodeHeightDetailed : groupNodeHeightSimple;
  const verticalSpacing = 15;
  const horizontalSpacing = 10;
  const cascadeOffset = 10; // Each node drops 25px for diagonal effect
  const groupOffsetFromMain = 45; // Groups start 35px below main
  
  let currentX = 10;
  let maxHeight = 0;
  
  sortedLocations.forEach(([locKey, loc]) => {
    // Calculate location dimensions
    const mainColumn = loc.mains.length > 0;
    const groupColumn = loc.groups.length > 0;
    
    // Calculate width: main column + all groups side-by-side
    const mainColWidth = mainColumn ? mainNodeWidth : 0;
    const groupsWidth = loc.groups.length > 0 ? (loc.groups.length * (groupNodeWidth + 15) - 15) : 0;
    const contentWidth = mainColWidth + (mainColumn && groupsWidth > 0 ? horizontalSpacing : 0) + groupsWidth;
    const locWidth = locationPadding * 2 + contentWidth;
    
    // Calculate height based on cascading layout
    const totalGroups = loc.groups.length;
    const cascadeHeight = totalGroups > 0 ? (totalGroups - 1) * cascadeOffset : 0;
    const contentHeight = groupOffsetFromMain + groupNodeHeight + cascadeHeight;
    const locHeight = contentHeight + 120; // Include header and padding
    
    maxHeight = Math.max(maxHeight, locHeight);
    
    // Create location container (parent node)
    const locationNodeId = `location-${locKey}`;
    nodeList.push({
      id: locationNodeId,
      type: 'location',
      position: { x: currentX, y: 50 },
      style: {
        width: `${locWidth}px`,
        height: `${locHeight}px`,
        zIndex: 0
      },
      data: {
        label: loc.label,
        width: locWidth,
        height: locHeight,
        borderColor: locKey === 'house' || locKey === 'main_house' ? '#1e5a78' : '#d1d5db'
      }
    });
    
    // Position for child nodes (relative to location container)
    const row1Y = 70; // Starting Y position for main nodes
    let mainX = locationPadding;
    let groupX = locationPadding + (mainColumn ? mainNodeWidth + horizontalSpacing : 0);
    let mainY = row1Y;
    let groupY = mainColumn ? row1Y + groupOffsetFromMain : row1Y; // Groups offset if there's a main node
    let nodeIndex = 0; // Track position in cascade for groups only
    
    // Add main components as children
    loc.mains.forEach(comp => {
      nodeList.push({
        id: comp.component_key,
        type: 'main',
        position: { x: mainX, y: mainY }, // Main nodes don't cascade
        parentNode: locationNodeId,
        extent: 'parent',
        data: {
          label: comp.name,
          color: comp.color,
          type: comp.type,
          powerData: getPowerData(comp.component_key, comp.type)
        },
        style: {
          width: `${mainNodeWidth}px`,
          height: `${mainNodeHeight}px`,
          zIndex: 1
        }
      });
      // Don't increment nodeIndex for main nodes
    });
    
    // Add groups as children
    loc.groups.forEach(comp => {
      
      nodeList.push({
        id: comp.component_key,
        type: 'group',
        position: { x: groupX, y: groupY + (nodeIndex * cascadeOffset) }, // Cascade vertically
        parentNode: locationNodeId,
        extent: 'parent',
        data: {
          label: comp.name,
          type: comp.type,
          devices: comp.devices || [],
          powerData: getPowerData(comp.component_key, comp.type)
        },
        style: {
          width: `${groupNodeWidth}px`,
          height: `${groupNodeHeight}px`,
          zIndex: 1
        }
      });
      nodeIndex++; // Increment for cascading effect
      // Increment X to place next group to the right
      groupX += groupNodeWidth + 15; // Small gap between groups
    });
    
    currentX += locWidth + 50; // Space between locations
  });
  
  // Update canvas width and height
  const canvasWidth = currentX + 50;
  canvasHeight.value = maxHeight + 150;
  
  nodeList.forEach(node => {
  });
  
  // Create edges
  
  flows.value.forEach((flow, idx) => {
    
    // Determine connection positions based on node locations
    const sourceNode = nodeList.find(n => n.id === flow.from);
    const targetNode = nodeList.find(n => n.id === flow.to);
    
    if (!sourceNode) {
      return;
    }
    if (!targetNode) {
      return;
    }
    
    
    // Determine source and target positions based on absolute coordinates
    let sourcePosition = Position.Right;
    let targetPosition = Position.Left;
    
    // Get parent locations
    const sourceParent = nodeList.find(n => n.id === sourceNode.parentNode);
    const targetParent = nodeList.find(n => n.id === targetNode.parentNode);
    
    // Calculate absolute positions (including parent offset)
    const sourceAbsX = (sourceParent?.position.x || 0) + sourceNode.position.x;
    const targetAbsX = (targetParent?.position.x || 0) + targetNode.position.x;
    const sourceAbsY = (sourceParent?.position.y || 0) + sourceNode.position.y;
    const targetAbsY = (targetParent?.position.y || 0) + targetNode.position.y;
    
    // Calculate deltas
    const deltaX = targetAbsX - sourceAbsX; // Positive = target is to the right
    const deltaY = targetAbsY - sourceAbsY; // Positive = target is below
    
    // Check if target is a group in same location as a main node
    const targetIsGroup = targetNode.type === 'group';
    const sameLocation = sourceNode.parentNode === targetNode.parentNode;
    const sourceIsMain = sourceNode.type === 'main';
    
    // Special rule: if source is main and target is group in same location, connect to group's BOTTOM
    if (sourceIsMain && targetIsGroup && sameLocation) {
      sourcePosition = Position.Bottom;
      targetPosition = Position.Bottom; // Groups connect at BOTTOM, not TOP
    } else {
      // Determine primary direction based on which delta is larger
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        // Primarily vertical
        if (deltaY > 0) {
          // Target is below
          sourcePosition = Position.Bottom;
          targetPosition = Position.Top;
        } else {
          // Target is above
          sourcePosition = Position.Top;
          targetPosition = Position.Bottom;
        }
      } else {
        // Primarily horizontal
        if (deltaX > 0) {
          // Target is to the right
          sourcePosition = Position.Right;
          targetPosition = Position.Left;
        } else {
          // Target is to the left
          sourcePosition = Position.Left;
          targetPosition = Position.Right;
        }
      }
    }
    
    
    
    // Vue Flow requires explicit handle IDs when there are multiple handles
    let sourceHandleId = `${flow.from}-${sourcePosition}`;
    let targetHandleId = `${flow.to}-${targetPosition}`;
    
    // Special handling for main → groups: use offset bottom handles based on target position
    let verticalOffset = 0; // Track vertical offset for staggering
    
    if (sourceIsMain && targetIsGroup && sameLocation && sourcePosition === Position.Bottom) {
      // Get all groups in this location to determine order
      const groupsInLocation = nodeList.filter(n => 
        n.type === 'group' && 
        n.parentNode === sourceNode.parentNode
      ).sort((a, b) => a.position.x - b.position.x); // Sort by X position (left to right)
      
      const targetIndex = groupsInLocation.findIndex(g => g.id === flow.to);
      const totalGroups = groupsInLocation.length;
      
      // Calculate vertical offset (negative = higher, so first line is highest)
      // Index 0 (Solar 1) = 0px (highest), Index 1 (Home) = -10px, Index 2 (Battery) = -20px
      verticalOffset = -targetIndex * 10;
      
      // Fan out pattern: leftmost group → rightmost handle
      if (totalGroups === 1) {
        sourceHandleId = `${flow.from}-bottom-center`;
      } else if (totalGroups === 2) {
        // 0 (left) → right, 1 (right) → left
        sourceHandleId = targetIndex === 0 ? `${flow.from}-bottom-right` : `${flow.from}-bottom-left`;
      } else if (totalGroups >= 3) {
        // 0 (leftmost) → right, 1 (middle) → center, 2+ (rightmost) → left
        if (targetIndex === 0) {
          sourceHandleId = `${flow.from}-bottom-right`; // Leftmost group → rightmost handle
        } else if (targetIndex === totalGroups - 1) {
          sourceHandleId = `${flow.from}-bottom-left`; // Rightmost group → leftmost handle
        } else {
          sourceHandleId = `${flow.from}-bottom-center`; // Middle groups → center handle
        }
      }
      
    }
    
    // Determine if this is a cross-location flow
    const isCrossLocation = sourceNode.parentNode !== targetNode.parentNode;
    
    // Get current flow power from WebSocket data
    const flowPower = getFlowPower(flow.from, flow.to);
    
    const edgeConfig = {
      id: flow.id,
      source: flow.from,
      target: flow.to,
      sourceHandle: sourceHandleId,
      targetHandle: targetHandleId,
      type: isCrossLocation ? 'step' : 'smoothstep', // Use step for cross-location to avoid overlaps
      animated: true, // Enable animation to show flow direction
      zIndex: 1000,
      label: flowPower > 0 ? formatPower(flowPower) : '', // Show current flow on edge
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      labelStyle: { 
        fontSize: '10px', 
        fontWeight: '600',
        fill: flow.color || '#4b5563'
      },
      data: {
        verticalOffset: verticalOffset, // Store offset for custom rendering
        flowPower: flowPower // Store for reference
      },
      style: {
        stroke: flow.color,
        strokeWidth: 3, // Slightly thicker for better visibility
        strokeDasharray: flow.type === 'secondary' ? '5,5' : 'none',
        zIndex: 1000
      },
      className: verticalOffset !== 0 ? `edge-offset-${Math.abs(verticalOffset)}${verticalOffset < 0 ? '-up' : ''}` : ''
      // No markerEnd or markerStart - animation shows direction
    };
    
    edgeList.push(edgeConfig);
  });
  
  nodes.value = nodeList;
  edges.value = edgeList;
  
};

const getGroupNodeStyle = (data) => {
  const colors = {
    solar_system: { bg: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', border: '#d1d5db' },
    battery_system: { bg: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)', border: '#d1d5db' },
    battery: { bg: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)', border: '#d1d5db' },
    home_usage: { bg: '#f3f4f6', border: '#d1d5db' },
    grid: { bg: '#f3f4f6', border: '#d1d5db' }
  };
  
  const style = colors[data.type] || { bg: '#f3f4f6', border: '#d1d5db' };
  
  return {
    background: style.bg,
    borderColor: style.border
  };
};

const formatDeviceName = (name) => {
  return name.toLowerCase().replace('solar ', '');
};

const formatPower = (value) => {
  if (value === undefined || value === null) return '0 W';
  const num = parseFloat(value);
  if (isNaN(num)) return '0 W';
  if (num === 0) return '0 W';
  if (Math.abs(num) >= 1000) {
    return `${(num / 1000).toFixed(2)} kW`;
  }
  return `${num.toFixed(0)} W`;
};

// Format power for nodes - always in Watts
const formatPowerForNode = (value) => {
  if (value === undefined || value === null) return '0 W';
  const num = parseFloat(value);
  if (isNaN(num)) return '0 W';
  return `${num.toFixed(0)} W`;
};

const formatEnergy = (value) => {
  if (value === undefined || value === null) return '-';
  const num = parseFloat(value);
  // Energy is in Wh, convert to kWh if >= 1000
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)} kWh`;
  }
  return `${num.toFixed(0)} Wh`;
};

// Get current flow power between two components
const getFlowPower = (fromKey, toKey) => {
  if (powerData.value && powerData.value.flows) {
    // Look for flow data from WebSocket
    const flowKey = `${fromKey}_to_${toKey}`;
    const flow = powerData.value.flows[flowKey];
    if (flow?.current !== undefined) {
      return flow.current;
    }
  }
  
  // Fallback to sample flow data for testing
  const sampleFlows = {
    'grid_to_backup_unit': 1250,
    'backup_unit_to_solar_1': 2850,
    'backup_unit_to_home_usage': 4120,
    'backup_unit_to_battery_1': 1500,
    'backup_unit_to_solar_2': 3200,
    'battery_1_to_backup_unit': 0
  };
  
  const flowKey = `${fromKey}_to_${toKey}`;
  return sampleFlows[flowKey] || 0;
};

// Helper function to get power data from WebSocket or fallback to sample data
const getPowerData = (componentKey, type) => {
  // Use WebSocket data if available
  if (powerData.value && powerData.value.components && powerData.value.components[componentKey]) {
    return powerData.value.components[componentKey];
  }
  
  // Fallback to sample data for testing (current power in W)
  // Remove this section when WebSocket is ready
  const sampleData = {
    'grid': { currentIn: 1250, currentOut: 0 },      // 1250W from grid, 0W to grid
    'backup_unit': { currentIn: 5050, currentOut: 4120 }, // 5050W in, 4120W out
    'solar_1': { currentOut: 2850 },                  // 2850W producing
    'solar_2': { currentOut: 3200 },                  // 3200W producing
    'solar_3': { currentOut: 0 },                     // 0W (night time)
    'home_usage': { currentIn: 4120 },                // 4120W consuming
    'battery_1': { currentIn: 1500 }   // 1500W charging, 0W discharging
  };
  
  return sampleData[componentKey] || {};
};

const formatSpecs = (specs) => {
  if (!specs) return '';
  return JSON.stringify(specs, null, 2);
};

const formatSpecsSummary = (specs) => {
  if (!specs) return '';
  
  // Format common spec patterns
  if (specs.maxPower) {
    return `${specs.maxPower}${specs.unit || 'W'}`;
  }
  if (specs.totalPower) {
    return `${specs.totalPower}${specs.unit || 'W'}`;
  }
  if (specs.units) {
    return `${specs.units}x ${specs.powerPerUnit}W`;
  }
  
  return '';
};

// Watch for view mode changes
watch(viewMode, () => {
  buildNodesAndEdges();
});
watch(() => powerData.value.batterySOC, (newSOC) => {
  console.log('🔋 batterySOC changed to:', newSOC);
});
// Watch for power data changes and update nodes without rebuilding
watch(powerData, () => {
  updateNodePowerData();
}, { deep: true });

// Function to update only power data in existing nodes
const updateNodePowerData = () => {
  nodes.value.forEach(node => {
    if (node.type === 'main' || node.type === 'group') {
      const componentKey = node.id;
      const newPowerData = getPowerData(componentKey);
      if (node.data) {
        node.data.powerData = newPowerData;
      }
    }
  });
  
  // Update edge labels with new flow data
  edges.value.forEach(edge => {
    const flowPower = getFlowPower(edge.source, edge.target);
    edge.label = flowPower > 0 ? formatPower(flowPower) : '';
  });
};
</script>

<style scoped>
.dynamic-system-diagram {
  width: 100%;
  background: #f8f9fa;
  border-radius: 12px;
  padding: 0.5rem 1rem 1rem 1rem; /* Reduced top padding */
  display: flex;
  flex-direction: column;
}

.diagram-controls {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.5rem; /* Reduced from 1rem */
}

.view-mode-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.mode-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #6b7280;
}

.vue-flow-container {
  border-radius: 0.5rem;
  border: 0px solid #e5e7eb;
  overflow: auto;
}

/* Location Container */
.location-container {
  border: 0px solid;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.location-header {
  padding: 0.75rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: #475569;
}

/* Main Node */
.main-node {
  width: 100%;
  height: 100%;
  padding: 0.5rem;
  border-radius: 8px;
  color: white;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* Group Node */
.group-node {
  width: 100%;
  height: 100%;
  min-height: 50px;
  padding: 0.4rem 0.5rem; /* Reduced vertical padding */
  border-radius: 8px;
  border: 2px solid;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.node-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
  color: #1e293b;
}

.main-node .node-label {
  color: white;
}

.node-id {
  font-size: 0.55rem;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 0.15rem;
  font-family: monospace;
}

.node-pos {
  font-size: 0.5rem;
  color: rgba(255, 255, 255, 0.5);
  font-family: monospace;
}

.node-id-small {
  font-size: 0.55rem;
  color: #9ca3af;
  margin-top: 0.15rem;
  font-family: monospace;
}

.devices-container {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.35rem;
}

.device-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.device-badge {
  padding: 0.15rem 0.35rem;
  background: #4a7c59;
  color: white;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 500;
  cursor: help;
}

.device-specs {
  font-size: 0.5rem;
  color: #6b7280;
  white-space: nowrap;
}

/* Power Data Styles */
.power-data-main {
  margin-top: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
  align-items: flex-start; /* Align to left */
}

.power-item-main {
  display: flex;
  justify-content: flex-start; /* Left align */
  gap: 0.5rem; /* Space between label and value */
  font-size: 0.6rem;
}

.power-label-main {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
  min-width: 2rem; /* Consistent label width */
}

.power-value-main {
  color: white;
  font-weight: 600;
}

.power-data {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.power-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
}

.power-label {
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
}

.power-value {
  color: white;
  font-weight: 600;
}

.power-data-group {
  margin-top: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
  align-items: flex-start; /* Align to left */
}

.power-item-small {
  display: flex;
  justify-content: flex-start; /* Left align */
  gap: 0.5rem; /* Space between label and value */
  font-size: 0.6rem;
}

.power-label-small {
  color: #4b5563;
  font-weight: 500;
  min-width: 2rem; /* Consistent label width */
}

.power-value-small {
  color: #1f2937;
  font-weight: 600;
}
</style>

<style>
/* Vue Flow global styles */
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';

/* Force edges to appear above everything */
.vue-flow__edges {
  z-index: 1000 !important;
}

.vue-flow__edge {
  z-index: 1000 !important;
}

.vue-flow__edge-path {
  z-index: 1000 !important;
}

/* Customize flow animation speed */
.vue-flow__edge.animated path {
  stroke-dasharray: 10 5;
  animation: dashdraw 1s linear infinite;
}

@keyframes dashdraw {
  to {
    stroke-dashoffset: -15;
  }
}

/* Stagger horizontal lines vertically */
.vue-flow__edge.edge-offset-10-up {
  transform: translateY(-6px);
}

.vue-flow__edge.edge-offset-20-up {
  transform: translateY(-12px);
}

.vue-flow__edge.edge-offset-30-up {
  transform: translateY(-18px);
}

.vue-flow__edge.edge-offset-40-up {
  transform: translateY(-24px);
}

/* Hide the connection handle dots */
.vue-flow__handle {
  opacity: 0;
  pointer-events: none;
}
</style>
/* Connection Banner Styles - NEW */
.connection-banner {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
}

.connection-banner.connected {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.connection-banner.disconnected {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: white;
}

.banner-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.status-dot.connected {
  background: white;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
  animation: pulse-dot 2s ease-in-out infinite;
}

.status-dot.disconnected {
  background: rgba(255, 255, 255, 0.6);
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.status-text {
  font-weight: 600;
  font-size: 0.95rem;
}

.live-badge {
  padding: 0.25rem 0.75rem;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.paused-badge {
  padding: 0.25rem 0.75rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.banner-actions {
  display: flex;
  gap: 0.5rem;
}

.banner-button {
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.banner-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.banner-button:active:not(:disabled) {
  transform: translateY(0);
}

.banner-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.banner-button.active {
  background: rgba(255, 255, 255, 0.35);
  border-color: rgba(255, 255, 255, 0.5);
}