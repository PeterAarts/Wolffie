// src/composables/useDeviceChartData.js
//
// Fetches smart device time-series (for chart) and daily kWh totals (for stats)
// in parallel. Both requests share the same date + granularity props.
//
// Used by SmartDeviceFlowGraph.vue.

import { ref, watch } from 'vue'
import apiClient from '@/services/api.js'

// Colour palette distinct from EnergyFlowGraph (blue/orange/teal/red/grey/dashed)
const PALETTE = [
  '#7c3aed', '#db2777', '#059669', '#d97706',
  '#0284c7', '#9333ea', '#16a34a', '#dc2626',
  '#0891b2', '#65a30d',
]

export function useDeviceChartData(dateRef, granularityRef) {
  const devices     = ref([])   // raw API response — [{ device_id, device_name, data }]
  const deviceStats = ref([])   // daily totals  — [{ device_id, device_name, daily_kwh }]
  const datasets    = ref([])   // Chart.js datasets
  const labels      = ref([])   // shared x-axis HH:MM labels
  const loading     = ref(false)
  const error       = ref(null)

  async function fetchData() {
    const date        = dateRef.value
    const granularity = granularityRef?.value ?? 5

    if (!date) return

    loading.value = true
    error.value   = null

    try {
      // Parallel: chart time-series + daily kWh totals
      const [chartRes, dailyRes] = await Promise.all([
        apiClient.get('/system/devices-chart', { params: { date, granularity } }),
        apiClient.get('/system/devices-daily', { params: { date } }),
      ])

      const rawDevices = chartRes.data.devices  ?? []
      const rawDaily   = dailyRes.data.devices  ?? []

      devices.value     = rawDevices
      // Only expose devices that actually had usage today
      deviceStats.value = rawDaily.filter(d => d.daily_kwh > 0)

      if (rawDevices.length === 0) {
        datasets.value = []
        labels.value   = []
        return
      }

      // Build unified x-axis from all buckets across all devices
      const allBuckets = new Set()
      for (const d of rawDevices) {
        for (const pt of d.data) allBuckets.add(pt.bucket)
      }
      const sortedBuckets = [...allBuckets].sort()

      // HH:MM labels — local arithmetic, no toLocaleTimeString (locale/OS variance)
      labels.value = sortedBuckets.map(b => {
        // bucket format: '2026-04-20 14:05'
        const parts = b.split(' ')
        return parts[1] ? parts[1].slice(0, 5) : b
      })

      // One Chart.js dataset per device
      datasets.value = rawDevices.map((device, idx) => {
        const byBucket = new Map(device.data.map(pt => [pt.bucket, pt.avg_power]))
        const color    = PALETTE[idx % PALETTE.length]
        return {
          label:           device.device_name,
          data:            sortedBuckets.map(b => byBucket.get(b) ?? null),
          borderColor:     color,
          backgroundColor: color + '18',   // 9% opacity fill
          borderWidth:     1.5,
          fill:            false,
          tension:         0.3,
          pointRadius:     0,
          spanGaps:        false,           // gaps = device had zero power → correct
        }
      })

    } catch (e) {
      console.error('[useDeviceChartData]', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  watch(
    () => [dateRef.value, granularityRef?.value],
    fetchData,
    { immediate: true }
  )

  return { devices, deviceStats, datasets, labels, loading, error, fetchData }
}