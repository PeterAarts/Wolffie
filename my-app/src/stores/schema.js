import { defineStore } from 'pinia';
import apiClient from '@/services/api';

export const useSchemaStore = defineStore('schema', {
  state: () => ({
    schemas: {},
    loading: false,
    loaded: false
  }),
  actions: {
    async initialize() {
      if (this.loaded) return;
      this.loading = true;
      try {
        const { data } = await apiClient.get('/system/schemas/active');
        if (data.success) {
          this.schemas = data.schemas;
          this.loaded = true;
        }
      } catch (e) {
        console.error("Failed to load schemas", e);
      } finally {
        this.loading = false;
      }
    }, // <--- THIS COMMA WAS MISSING

    // Helper to get schema for a specific device module
    resolveSchema(moduleName) {
      return this.schemas[moduleName] || null;
    },

    getSchemaForModule(moduleName) {
      const schema = this.schemas[moduleName];
      if (!schema) {
        console.warn(`[SchemaStore] No schema found for module: ${moduleName}`);
        return null;
      }
      return schema;
    }
  }
});