// modules/homewizard/index.js
import collector from './services/collector.js';
import routes from './routes/index.js';

export default {
  routes,
  collector,

  async initialize() {
    // manifest is attached by moduleLoader after import —
    // it's available as this.manifest at this point
    console.log(`Initializing module: ${this.manifest.name}`);
  },

  async collect() {
    return collector.collect();
  },

  getStatus() {
    return {
      ...this.manifest,
      collectorStatus: collector.getStatus()
    };
  }
};