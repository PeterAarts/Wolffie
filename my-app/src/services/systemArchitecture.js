// src/services/systemArchitecture.js
import api from './api';

/**
 * System Architecture Service
 * Fetches and manages system component configuration from database
 */

class SystemArchitectureService {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = null;
    this.cacheDuration = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Fetch system architecture configuration
   * Uses cache to avoid repeated database calls
   */
  async getArchitecture(forceRefresh = false) {
    // Check cache (skip if forceRefresh)
    if (!forceRefresh && this.cache && this.cacheTimestamp && 
        (Date.now() - this.cacheTimestamp < this.cacheDuration)) {
      console.log('📦 Returning cached architecture');
      return this.cache;
    }

    console.log('🔄 Fetching fresh architecture from API...');
    
    try {
      // Add timestamp to prevent browser caching
      const timestamp = Date.now();
      const response = await api.get(`/system/architecture?_t=${timestamp}`);
      
      console.log('✅ API Response received');
      console.log('📊 Response data:', JSON.stringify(response.data).substring(0, 200));
      
      if (response.data && response.data.levels && Array.isArray(response.data.levels)) {
        console.log(`✅ Valid data with ${response.data.levels.length} levels`);
        this.cache = response.data;
        this.cacheTimestamp = Date.now();
        return this.cache;
      }
      
      console.warn('⚠️ API returned invalid data structure');
      console.warn('⚠️ Data received:', response.data);
      // Fallback to default configuration
      return this.getDefaultArchitecture();
    } catch (error) {
      console.error('❌ Failed to fetch system architecture:', error);
      console.error('❌ Error details:', error.response?.data || error.message);
      return this.getDefaultArchitecture();
    }
  }

  /**
   * Get components by level
   */
  async getComponentsByLevel(level) {
    const architecture = await this.getArchitecture();
    const levelData = architecture.levels.find(l => l.level === level);
    return levelData ? levelData.components : [];
  }

  /**
   * Get component by key
   */
  async getComponent(componentKey) {
    const architecture = await this.getArchitecture();
    
    for (const level of architecture.levels) {
      const component = level.components.find(c => c.id === componentKey);
      if (component) return component;
      
      // Check sub-components
      for (const comp of level.components) {
        if (comp.subComponents) {
          const subComp = comp.subComponents.find(sc => sc.id === componentKey);
          if (subComp) return subComp;
        }
      }
    }
    
    return null;
  }

  /**
   * Get flow relationships for a component
   */
  async getComponentFlows(componentKey) {
    const architecture = await this.getArchitecture();
    const component = await this.getComponent(componentKey);
    
    if (!component) return { from: [], to: [] };
    
    return {
      from: component.flowFrom || [],
      to: component.flowTo || []
    };
  }

  /**
   * Get all components as flat array
   */
  async getAllComponents() {
    const architecture = await this.getArchitecture();
    const components = [];
    
    for (const level of architecture.levels) {
      for (const component of level.components) {
        components.push({
          ...component,
          level: level.level,
          levelName: level.name
        });
        
        // Add sub-components
        if (component.subComponents) {
          for (const subComp of component.subComponents) {
            components.push({
              ...subComp,
              level: level.level,
              levelName: level.name,
              parentId: component.id
            });
          }
        }
      }
    }
    
    return components;
  }

  /**
   * Get component specifications
   */
  async getComponentSpecs(componentKey) {
    const component = await this.getComponent(componentKey);
    return component?.specs || null;
  }

  /**
   * Calculate total capacity for a component
   */
  calculateTotalCapacity(specs) {
    if (!specs) return 0;
    
    if (specs.units && specs.powerPerUnit) {
      return specs.units * specs.powerPerUnit;
    }
    
    if (specs.units && specs.capacityPerUnit) {
      return specs.units * specs.capacityPerUnit;
    }
    
    if (specs.totalPower) {
      return specs.totalPower;
    }
    
    if (specs.totalCapacity) {
      return specs.totalCapacity;
    }
    
    return 0;
  }

  /**
   * Clear cache (useful after configuration updates)
   */
  clearCache() {
    this.cache = null;
    this.cacheTimestamp = null;
  }

  /**
   * Default architecture configuration (fallback)
   */
  getDefaultArchitecture() {
    return {
      levels: [
        {
          level: 1,
          name: 'external',
          label: 'External',
          components: [
            {
              id: 'grid',
              name: 'Grid',
              type: 'grid',
              icon: 'stat-grid.png',
              color: '#f97316',
              dataSource: 'grid.power',
              flowDirection: 'bidirectional'
            }
          ]
        },
        {
          level: 2,
          name: 'backup',
          label: 'Backup Unit',
          components: [
            {
              id: 'backup_unit',
              name: 'Backup Unit',
              type: 'backup',
              icon: 'pi-shield',
              color: '#8b5cf6',
              description: 'Transfer Switch'
            }
          ]
        },
        {
          level: 3,
          name: 'internal',
          label: 'Internal Systems',
          components: [
            {
              id: 'solar_system',
              name: 'Solar System',
              type: 'group',
              icon: 'stat-green.png',
              color: '#fbbf24',
              subComponents: [
                {
                  id: 'solar_panels',
                  name: 'Solar Panels',
                  type: 'generation',
                  specs: {
                    units: 9,
                    powerPerUnit: 395,
                    totalPower: 3555,
                    unit: 'W'
                  },
                  dataSource: 'pv.power'
                },
                {
                  id: 'solar_inverter',
                  name: 'Solar Inverter',
                  type: 'inverter',
                  specs: {
                    phases: 1,
                    maxPower: 3000,
                    unit: 'W'
                  },
                  dataSource: 'pv.power'
                }
              ],
              flowTo: ['home_load']
            },
            {
              id: 'home_load',
              name: 'Home Load',
              type: 'consumption',
              icon: 'stat-home.png',
              color: '#3b82f6',
              dataSource: 'load.power',
              flowFrom: ['solar_system', 'battery_system', 'grid']
            },
            {
              id: 'battery_system',
              name: 'Battery System',
              type: 'group',
              icon: 'stat-battery.png',
              color: '#10b981',
              subComponents: [
                {
                  id: 'battery_packs',
                  name: 'Battery Packs',
                  type: 'storage',
                  specs: {
                    units: 3,
                    capacityPerUnit: 3.4,
                    totalCapacity: 10.2,
                    unit: 'kWh'
                  },
                  dataSource: 'battery.soc'
                },
                {
                  id: 'battery_inverter',
                  name: 'Battery Inverter',
                  type: 'inverter',
                  specs: {
                    phases: 3,
                    maxPower: 10000,
                    unit: 'W'
                  },
                  dataSource: 'battery.power'
                }
              ],
              flowTo: ['home_load'],
              flowFrom: ['solar_system']
            }
          ]
        }
      ],
      flowRules: {
        priority: ['solar', 'battery', 'grid'],
        exportAllowed: true,
        gridChargeAllowed: false
      }
    };
  }

  /**
   * Update component configuration
   */
  async updateComponent(componentKey, updates) {
    try {
      const response = await api.put(`/system/architecture/component/${componentKey}`, updates);
      
      if (response.data) {
        this.clearCache();
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to update component:', error);
      throw error;
    }
  }

  /**
   * Update component specs
   */
  async updateComponentSpecs(componentKey, specs) {
    return this.updateComponent(componentKey, { specs });
  }
}

export const systemArchitectureService = new SystemArchitectureService();
export default systemArchitectureService;