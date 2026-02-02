// src/stores/history.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { historyService } from '../services/history';

export const useHistoryStore = defineStore('history', () => {
  const last24Hours = ref([]);
  const dailySummary = ref([]);
  const todaySummary = ref({});
  const isLoading = ref(false);
  const error = ref(null);

  async function fetchLast24Hours() {
    try {
      isLoading.value = true;
      error.value = null;
      last24Hours.value = await historyService.getLast24Hours();
    } catch (err) {
      error.value = err.message;
      console.error('Error fetching 24h data:', err);
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchDailySummary(startDate, endDate) {
    try {
      isLoading.value = true;
      error.value = null;
      dailySummary.value = await historyService.getDailySummary(startDate, endDate);
    } catch (err) {
      error.value = err.message;
      console.error('Error fetching daily summary:', err);
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchTodaySummary() {
    try {
      todaySummary.value = await historyService.getToday();
    } catch (err) {
      console.error('Error fetching today summary:', err);
    }
  }

  return {
    last24Hours,
    dailySummary,
    todaySummary,
    isLoading,
    error,
    fetchLast24Hours,
    fetchDailySummary,
    fetchTodaySummary,
  };
});