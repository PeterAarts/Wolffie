// src/routes/system.js - FIXED FOR YOUR DATABASE STRUCTURE
import express from 'express';
import db from '../config/database.js';

const router = express.Router();

console.log('✔ System routes module loaded');

/**
 * GET /api/system/architecture
 * Returns complete system architecture configuration
 */
router.get('/architecture', async (req, res) => {
  try {
    console.log('📊 Fetching system architecture...');
    
    // Get all components from database
    const [components] = await db.query(`
      SELECT 
        id,
        component_key,
        name,
        type,
        category,
        location_type,
        location_label,
        parent_id,
        level_depth,
        display_order,
        is_optional,
        specs,
        data_source
      FROM system_components
      WHERE is_optional = 0 OR is_optional IS NULL
      ORDER BY level_depth ASC, display_order ASC
    `);

    console.log(`✔ Found ${components.length} components`);

    // Get all flows (joining to get component_keys)
    const [flows] = await db.query(`
      SELECT 
        cf.from_component_id,
        cf.to_component_id,
        cf.flow_type,
        cf.flow_direction,
        cf.arrow_color,
        cf.priority,
        c1.component_key as from_key,
        c2.component_key as to_key
      FROM component_flows cf
      LEFT JOIN system_components c1 ON cf.from_component_id = c1.id
      LEFT JOIN system_components c2 ON cf.to_component_id = c2.id
      WHERE cf.is_visible = 1
      ORDER BY cf.priority ASC
    `);

    console.log(`✔ Found ${flows.length} flows`);

    // Build architecture structure
    const architecture = buildArchitecture(components, flows);
    
    console.log(`✔ Built architecture with ${architecture.levels.length} levels`);
    
    res.json(architecture);
  } catch (error) {
    console.error('✗ Error fetching system architecture:', error);
    res.status(500).json({ 
      error: 'Failed to fetch system architecture',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});


/**
 * Build architecture from components
 */
function buildArchitecture(components, flows) {
  // Create lookup maps
  const byId = {};
  const byKey = {};
  
  components.forEach(comp => {
    byId[comp.id] = comp;
    byKey[comp.component_key] = comp;
  });
  
  console.log(`📊 Building from ${components.length} components`);
  
  // Group by location_type
  const locations = {};
  
  // First pass: identify locations from components with location_type
  components.forEach(comp => {
    if (comp.location_type) {
      const locKey = comp.location_type;
      
      if (!locations[locKey]) {
        locations[locKey] = {
          type: comp.location_type,
          label: comp.location_label,
          components: []
        };
      }
    }
  });
  
  console.log(`  Found ${Object.keys(locations).length} locations`);
  
  // Second pass: add components to locations
  components.forEach(comp => {
    if (comp.location_type && locations[comp.location_type]) {
      locations[comp.location_type].components.push(comp);
    }
  });
  
  // Build levels array from locations
  const levels = Object.entries(locations).map(([key, loc]) => ({
    type: loc.type,
    label: loc.label,
    components: loc.components.map(comp => buildComponent(comp, byId))
  }));
  
  // Build flows array
  const flowsArray = flows.map(flow => ({
    from: flow.from_key,
    to: flow.to_key,
    type: flow.flow_type,
    direction: flow.flow_direction,
    color: flow.arrow_color,
    priority: flow.priority
  }));
  
  return {
    levels,
    flows: flowsArray
  };
}

/**
 * Build component object with subcomponents
 */
function buildComponent(comp, byId) {
  const component = {
    id: comp.id,
    component_key: comp.component_key,
    name: comp.name,
    type: comp.type,
    category: comp.category,
    specs: parseSpecs(comp.specs),
    data_source: comp.data_source
  };
  
  // Find child components (where parent_id matches this component's id)
  const allComponents = Object.values(byId);
  const children = allComponents.filter(c => c.parent_id === comp.id);
  
  if (children.length > 0) {
    // Group children by category
    const groups = children.filter(c => c.category === 'group');
    
    if (groups.length > 0) {
      component.subComponents = groups.map(group => buildGroup(group, allComponents));
      console.log(`  └─ ${comp.name}: ${groups.length} groups`);
    } else {
      // Direct device children
      component.subComponents = children.map(child => ({
        id: child.id,
        component_key: child.component_key,
        name: child.name,
        type: child.type,
        category: child.category,
        specs: parseSpecs(child.specs)
      }));
      console.log(`  └─ ${comp.name}: ${children.length} devices`);
    }
  }
  
  return component;
}

/**
 * Build group with its devices
 */
function buildGroup(group, allComponents) {
  const groupData = {
    id: group.id,  // Use integer ID
    component_key: group.component_key,
    name: group.name,
    type: group.type,
    category: group.category,
    specs: parseSpecs(group.specs),
    subComponents: []
  };
  
  // Get devices for this group
  const devices = allComponents.filter(c => c.parent_id === group.id && c.category === 'device');
  
  devices.forEach(device => {
    groupData.subComponents.push({
      id: device.id,  // Use integer ID
      component_key: device.component_key,
      name: device.name,
      type: device.type,
      category: device.category,
      specs: parseSpecs(device.specs)
    });
  });
  
  console.log(`    └─ ${group.name}: ${devices.length} devices`);
  
  return groupData;
}

/**
 * Parse JSON specs safely
 */
function parseSpecs(specs) {
  if (!specs) return null;
  if (typeof specs === 'object') return specs;
  try {
    return JSON.parse(specs);
  } catch {
    return null;
  }
}

/**
 * Find component by key in array
 */
function findInComponents(components, key) {
  for (const comp of components) {
    if (comp.component_key === key || comp.id === key) return comp;
    if (comp.subComponents) {
      const found = findInComponents(comp.subComponents, key);
      if (found) return found;
    }
  }
  return null;
}

export default router;