<!-- src/components/common/StatusCard.vue -->
<template>
  <Card :class="['status-card', cardClass]">
    <template #content>
      <div class="card-header">
        <div class="card-icon-wrapper">
          <img v-if="icon" :src="icon" :alt="title" class="card-icon-img" />
          <i v-else-if="iconClass" :class="iconClass"></i>
        </div>
        <h3 class="card-title" :class="titleClass">{{ title }}</h3>
      </div>
      <div class="card-body">
        <slot name="stats">
          <div v-for="stat in stats" :key="stat.label" class="stat-row">
            <span class="stat-label">{{ stat.label }}</span>
            <span class="stat-value">
              {{ stat.value }} 
              <span v-if="stat.unit" class="stat-unit">{{ stat.unit }}</span>
            </span>
          </div>
        </slot>
      </div>
    </template>
  </Card>
</template>

<script setup>
import Card from 'primevue/card';

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    default: null
  },
  iconClass: {
    type: String,
    default: null
  },
  titleClass: {
    type: String,
    default: ''
  },
  cardClass: {
    type: String,
    default: ''
  },
  stats: {
    type: Array,
    default: () => []
  }
});
</script>

<style scoped>
.status-card {
  background: white;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0.5rem;
}

.card-header {
  text-align: center;

}

.card-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0rem;
  transition: all 0.3s ease;
}

.card-icon-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.status-card:hover .card-icon-wrapper {
  transform: scale(1.1);
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  text-align: center;
}



.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f3f4f6;
}

.stat-row:last-child {
  border-bottom: none;
}

.stat-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
}

.stat-unit {
  font-size: 0.875rem;
  font-weight: 400;
  color: #9ca3af;
  margin-left: 0.25rem;
}

/* Color variants */
.blue-text { color: #3b82f6; }
.green-text { color: #10b981; }
.orange-text { color: #f59e0b; }
</style>