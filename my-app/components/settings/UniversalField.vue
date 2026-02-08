<!-- src/components/settings/UniversalField.vue -->
<template>
  <div v-if="field.visible !== false" class="universal-field">
    <label v-if="field.label && !['checkbox', 'switch'].includes(field.component)" 
           :for="field.key" 
           class="field-label">
      {{ field.label }}
      <span v-if="field.required" class="required-indicator">*</span>
    </label>

    <!-- TEXT INPUT -->
    <InputText
      v-if="field.component === 'text'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :required="field.required"
      class="w-full"
    />

    <!-- NUMBER INPUT -->
    <InputNumber
      v-else-if="field.component === 'number'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :required="field.required"
      :min="field.validation?.min"
      :max="field.validation?.max"
      :step="field.validation?.step"
      :suffix="field.suffix"
      :prefix="field.prefix"
      :minFractionDigits="field.decimals || 0"
      :maxFractionDigits="field.decimals || 2"
      class="w-full"
    />

    <!-- PASSWORD INPUT -->
    <Password
      v-else-if="field.component === 'password'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :feedback="field.showStrength !== false"
      :toggleMask="true"
      class="w-full"
    />

    <!-- TEXTAREA -->
    <Textarea
      v-else-if="field.component === 'textarea'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :rows="field.rows || 3"
      :autoResize="field.autoResize !== false"
      class="w-full"
    />

    <!-- SELECT / DROPDOWN -->
    <Dropdown
      v-else-if="field.component === 'select' || field.component === 'dropdown'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :options="field.options"
      :optionLabel="field.optionLabel || 'label'"
      :optionValue="field.optionValue || 'value'"
      :placeholder="field.placeholder || 'Select...'"
      :disabled="field.editable === false || disabled"
      :showClear="!field.required"
      class="w-full"
    />

    <!-- CHECKBOX -->
    <div v-else-if="field.component === 'checkbox'" class="flex align-items-center gap-2">
      <Checkbox
        :id="field.key"
        :modelValue="modelValue"
        @update:modelValue="emit('update:modelValue', $event)"
        :disabled="field.editable === false || disabled"
        :binary="true"
      />
      <label :for="field.key" class="cursor-pointer">
        {{ field.label }}
        <span v-if="field.required" class="required-indicator">*</span>
      </label>
    </div>

    <!-- SWITCH / TOGGLE -->
    <div v-else-if="field.component === 'switch'" class="flex align-items-center gap-2">
      <InputSwitch
        :id="field.key"
        :modelValue="modelValue"
        @update:modelValue="emit('update:modelValue', $event)"
        :disabled="field.editable === false || disabled"
      />
      <label :for="field.key" class="cursor-pointer">
        {{ field.label }}
        <span v-if="field.required" class="required-indicator">*</span>
      </label>
    </div>

    <!-- COLOR PICKER -->
    <ColorPicker
      v-else-if="field.component === 'color'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :disabled="field.editable === false || disabled"
    />

    <!-- EMAIL INPUT -->
    <InputText
      v-else-if="field.component === 'email'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      type="email"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :required="field.required"
      class="w-full"
    />

    <!-- URL INPUT -->
    <InputText
      v-else-if="field.component === 'url'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      type="url"
      :placeholder="field.placeholder"
      :disabled="field.editable === false || disabled"
      :required="field.required"
      class="w-full"
    />

    <!-- MULTI-SELECT -->
    <MultiSelect
      v-else-if="field.component === 'multiselect'"
      :id="field.key"
      :modelValue="modelValue"
      @update:modelValue="emit('update:modelValue', $event)"
      :options="field.options"
      :optionLabel="field.optionLabel || 'label'"
      :optionValue="field.optionValue || 'value'"
      :placeholder="field.placeholder || 'Select...'"
      :disabled="field.editable === false || disabled"
      :maxSelectedLabels="field.maxSelectedLabels || 3"
      class="w-full"
    />

    <!-- SLIDER -->
    <div v-else-if="field.component === 'slider'" class="flex flex-column gap-2">
      <Slider
        :id="field.key"
        :modelValue="modelValue"
        @update:modelValue="emit('update:modelValue', $event)"
        :min="field.validation?.min || 0"
        :max="field.validation?.max || 100"
        :step="field.validation?.step || 1"
        :disabled="field.editable === false || disabled"
      />
      <div class="flex justify-content-between text-sm text-600">
        <span>{{ field.validation?.min || 0 }}</span>
        <span class="font-bold">{{ modelValue }}</span>
        <span>{{ field.validation?.max || 100 }}</span>
      </div>
    </div>

    <!-- HELP TEXT -->
    <small v-if="field.helpText" class="help-text">
      {{ field.helpText }}
    </small>

    <!-- VALIDATION ERROR -->
    <small v-if="validationError" class="error-text">
      {{ validationError }}
    </small>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Password from 'primevue/password';
import Textarea from 'primevue/textarea';
import Dropdown from 'primevue/dropdown';
import MultiSelect from 'primevue/multiselect';
import Checkbox from 'primevue/checkbox';
import InputSwitch from 'primevue/inputswitch';
import ColorPicker from 'primevue/colorpicker';
import Slider from 'primevue/slider';

const props = defineProps({
  field: {
    type: Object,
    required: true
  },
  modelValue: {
    type: [String, Number, Boolean, Array, Object],
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  validationError: {
    type: String,
    default: null
  }
});

const emit = defineEmits(['update:modelValue']);
</script>

<style scoped>
.universal-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-weight: 600;
  color: #374151;
  font-size: 0.95rem;
}

.required-indicator {
  color: #ef4444;
  margin-left: 0.25rem;
}

.help-text {
  color: #6b7280;
  font-size: 0.875rem;
  line-height: 1.4;
  display: block;
  margin-top: -0.25rem;
}

.error-text {
  color: #ef4444;
  font-size: 0.875rem;
  display: block;
  margin-top: -0.25rem;
}
</style>