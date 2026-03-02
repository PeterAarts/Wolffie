<template>
  <div v-if="field.visible !== false" class="flex flex-col gap-1.5 w-full">
    <label 
      v-if="field.label && !['checkbox', 'switch'].includes(field.component)" 
      :for="field.key" 
      class="text-xs  text-gray-500  tracking-wider ml-1"
    >
      {{ field.label }}
      <span v-if="field.required" class="text-red-500 ml-1">*</span>
    </label>

    <div class="relative group">
      <template v-if="['text', 'password', 'email', 'number', 'url'].includes(field.component)">
        <div class="relative flex items-center">
          <div v-if="field.icon" class="absolute left-4 text-gray-400 group-focus-within:text-blue-500 transition-colors">
            <i :class="['fa-duotone', field.icon]"></i>
          </div>

          <input
            :id="field.key"
            :type="field.component"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            :placeholder="field.placeholder"
            :disabled="field.editable === false || disabled"
            :required="field.required"
            :min="field.validation?.min"
            :max="field.validation?.max"
            :step="field.validation?.step"
            class="w-full bg-white p-2 text-gray-900 transition-all focus:ring-2 focus:ring-gray-500/20 focus:border-gray-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
            :class="[field.icon ? 'pl-11' : 'pl-4', validationError ? 'border-red-500 ring-red-500/10' : '']"
          />
        </div>
      </template>

      <textarea
        v-else-if="field.component === 'textarea'"
        :id="field.key"
        :value="modelValue"
        @input="emit('update:modelValue', $event.target.value)"
        :placeholder="field.placeholder"
        :disabled="field.editable === false || disabled"
        rows="4"
        class="w-full bg-white  p-2 text-gray-900 transition-all focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:bg-gray-50"
      ></textarea>

      <select
        v-else-if="field.component === 'select' || field.component === 'dropdown'"
        :id="field.key"
        :value="modelValue"
        @change="emit('update:modelValue', $event.target.value)"
        :disabled="field.editable === false || disabled"
        class="w-full bg-white p-2 text-gray-900 appearance-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
      >
        <option v-if="field.placeholder" value="" disabled selected>{{ field.placeholder }}</option>
        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <div v-else-if="['switch', 'boolean'].includes(field.component)">
        <div class="flex flex-col gap-1 py-1 pt-4">
          <label class="inline-flex switch-toggle items-center cursor-pointer group">
            <div class="relative">
              <input 
                type="checkbox" 
                :id="field.key"
                :checked="!!modelValue" 
                @change="emit('update:modelValue', $event.target.checked)"
                :disabled="field.editable === false || disabled"
                class="sr-only peer"
              >
              <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-0 peer-focus:ring-brand-soft rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-700"></div>
            </div>
            <div class="flex flex-col switch-toggle-content">
              <span class="select-none text-sm font-normal text-gray-700 group-hover:text-gray-900 transition-colors">
                {{ field.label }}
              </span>
            </div>
          </label>
          
          <p v-if="field.description" class="text-xs text-gray-400 italic ml-12">
            <i class="fa-duotone fa-circle-info mr-1"></i>
            {{ field.description }}
          </p>
        </div>
      </div>
      <div v-else-if="field.component === 'color'" class="flex items-center gap-3 p-2 bg-white border border-gray-200  shadow-sm">
        <input 
          type="color" 
          :value="modelValue" 
          @input="emit('update:modelValue', $event.target.value)"
          class="h-10 w-20 rounded cursor-pointer border-none bg-transparent"
        />
        <span class="text-sm font-mono text-gray-600 uppercase">{{ modelValue }}</span>
      </div>

      <div v-if="field.description && field.component !== 'switch'" class="mt-1.5 px-1">
        <p class="text-xs text-gray-400 italic">
          <i class="fa-duotone fa-circle-info mr-1"></i>
          {{ field.description }}
        </p>
      </div>

      <div v-if="validationError" class="mt-1 px-1 flex items-center gap-1.5 text-red-600">
        <i class="fa-duotone fa-triangle-exclamation text-[10px]"></i>
        <small class="text-[11px] font-bold tracking-wide uppercase">{{ validationError }}</small>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  field:            { type: Object, required: true },
  modelValue:       { type: [String, Number, Boolean, Array, Object], default: null },
  disabled:         { type: Boolean, default: false },
  validationError:  { type: String, default: null }
});

const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
/* Remove default arrow for custom styled select if needed */
select {
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  padding-right: 2.5rem;
}
</style>