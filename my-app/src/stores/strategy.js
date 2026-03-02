import { defineStore } from 'pinia';
import socket from '@/services/websocket'; // Zorg dat je toegang hebt tot je socket instantie

export const useStrategyStore = defineStore('strategy', {
  state: () => ({
    activeStrategy: 'Initialiseert...',
    targetBufferSoc: null,
    targetBufferKwh: null,
    reasoning: 'Wachten op data...',
    isChargingFromGrid: false,
    isManualOverride: false, // Nieuw: houdt bij of de gebruiker handmatig ingrijpt
    lastUpdate: null,
    forecast: {
      todayKwh: 0,
      tomorrowKwh: 0,
      accuracy: 0
    }
  }),

  actions: {
    /**
     * Verwerkt updates die binnenkomen via WebSockets
     */
    updateFromSocket(data) {
      if (data.active_strategy) this.activeStrategy = data.active_strategy;
      if (data.target_buffer_soc !== undefined) this.targetBufferSoc = data.target_buffer_soc;
      if (data.target_buffer_kwh !== undefined) this.targetBufferKwh = data.target_buffer_kwh;
      if (data.reason) this.reasoning = data.reason;
      if (data.is_charging !== undefined) this.isChargingFromGrid = data.is_charging;
      if (data.is_manual !== undefined) this.isManualOverride = data.is_manual;
      
      this.lastUpdate = new Date();
    },

    /**
     * Handmatige override inschakelen of uitschakelen
     * Stuurt een commando naar de Node.js backend
     */
    async toggleManualOverride(status) {
      this.isManualOverride = status;
      // Stuur het commando via de websocket naar de StrategyManager op de server
      socket.emit('strategy_control', {
        command: status ? 'ENABLE_MANUAL' : 'DISABLE_MANUAL',
        timestamp: new Date()
      });
    },

    /**
     * Update de solar forecast data
     */
    updateForecast(data) {
      this.forecast.todayKwh = data.today_kwh || 0;
      this.forecast.tomorrowKwh = data.tomorrow_kwh || 0;
      this.forecast.accuracy = data.accuracy_pct || 0;
    }
  },

  getters: {
    isSystemControlled: (state) => state.isChargingFromGrid && !state.isManualOverride,
    
    formattedTargetBuffer: (state) => {
      if (state.targetBufferSoc === null) return 'N/A';
      return `${state.targetBufferSoc}% (${state.targetBufferKwh?.toFixed(1) || 0} kWh)`;
    },

    // Handig voor de UI: bepaal de kleur van de status-indicators
    statusColor: (state) => {
      if (state.isManualOverride) return '#ff9800'; // Oranje voor handmatig
      if (state.isChargingFromGrid) return '#4caf50'; // Groen voor actief laden
      return '#9e9e9e'; // Grijs voor idle
    }
  }
});