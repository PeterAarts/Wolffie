<template>
  <div class="user-settings-view flex flex-col h-full ">
    <header class="mb-6  flex-shrink-0 flex justify-between items-center bg-white">
      <div>
        <p class="text-sm text-gray-500">{{ t('settings.users.description') }}</p>
      </div>
      <button class="btn btn--primary" @click="openAddUser">
        <i class="fa-duotone fa-user-plus mr-2" /> {{ t('settings.users.addUser') }}
      </button>
    </header>

    <div class="flex-1 overflow-hidden ">
      <AppTable
        :items="users"
        :columns="columns"
        :loading="loading"
        @row-click="editUser"
      >
        <template #toolbar-left>
        </template>

        <template #role="{ value }">
          <span :class="['status-badge', `status-badge--${value.role.toLowerCase()}`]">
            {{ value.role }}
          </span>
        </template>

        <template #_actions="{ value }">
          <div class="flex gap-2">
            <button class="icon-btn text-slate-400 hover:text-blue-600" @click.stop="editUser(value)">
              <i class="fa-duotone fa-pencil" />
            </button>
            <button class="icon-btn text-slate-400 hover:text-red-600" @click.stop="confirmDelete(value)">
              <i class="fa-duotone fa-trash" />
            </button>
          </div>
        </template>
      </AppTable>
    </div>

    <AppDrawer 
      v-model:visible="drawerOpen" 
      :title="isEdit ? t('settings.users.editTitle') : t('settings.users.addTitle')"
    >
      <div class="flex flex-col gap-4">
        <div class="form-group">
          <label class="form-label">{{ t('settings.users.name') }}</label>
          <input v-model="formData.username" type="text" class="form-input" :placeholder="t('settings.users.namePlaceholder')" />
        </div>
        
        <div class="form-group">
          <label class="form-label">{{ t('settings.users.email') }}</label>
          <input v-model="formData.email" type="email" class="form-input" placeholder="user@example.com" />
        </div>

        <div class="form-group">
          <label class="form-label">{{ t('settings.users.role') }}</label>
          <select v-model="formData.role" class="form-select">
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
        </div>

        <div v-if="!isEdit" class="form-group">
          <label class="form-label">{{ t('settings.users.password') }}</label>
          <input v-model="formData.password" type="password" class="form-input" />
        </div>
      </div>

      <template #footer>
        <button class="btn" @click="drawerOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn btn--primary" :disabled="saving" @click="saveUser">
          <i v-if="saving" class="fa-duotone fa-spinner-third fa-spin mr-2" />
          {{ t('common.confirm') }}
        </button>
      </template>
    </AppDrawer>

    <AppModal
      v-model:visible="deleteModalOpen"
      :message="t('settings.users.confirmRemove', { name: userToDelete?.username })"
      destructive
      :busy="deleting"
      @confirm="executeDelete"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '@/services/api';
import AppTable from '@/components/common/AppTable.vue';
import AppDrawer from '@/components/common/AppDrawer.vue';
import AppModal from '@/components/common/AppModal.vue';
import { useToastStore } from '@/stores/toast';

const { t } = useI18n();
const toast = useToastStore();

const users = ref([]);
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);

const drawerOpen = ref(false);
const isEdit = ref(false);
const deleteModalOpen = ref(false);
const userToDelete = ref(null);

const formData = reactive({ username: '', email: '', role: 'user', password: '' });

// Column definitions using i18n keys
const columns = [
  { field: 'username', title: t('settings.users.name'), sortable: true },
  { field: 'full_name', title: t('settings.users.full_name'), sortable: true },
  { field: 'email', title: t('settings.users.email'), sortable: true },
  { field: 'role', title: t('settings.users.role') },
  { field: 'is_active', title: t('settings.users.is_active'), sortable: true, formatter: value => value.is_active ? t('common.yes') : t('common.no') },
  { field: "last_password_update", title: t('settings.users.last_password_update'), sortable: true },
  { field: '_actions', title: '', width: '100px', sortable: false }
];

async function fetchUsers() {
  loading.value = true;
  try {
    const response = await apiClient.get('/settings/users/list');
    // Extract the array correctly so items.length works in AppTable
    if (response.data && response.data.data) {
      users.value = response.data.data;
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: t('common.error'), detail: err.message });
  } finally {
    loading.value = false;
  }
}

function openAddUser() {
  isEdit.value = false;
  Object.assign(formData, { username: '', email: '', role: 'user', password: '' });
  drawerOpen.value = true;
}

function editUser(user) {
  isEdit.value = true;
  Object.assign(formData, user);
  drawerOpen.value = true;
}

function confirmDelete(user) {
  userToDelete.value = user;
  deleteModalOpen.value = true;
}

async function saveUser() {
  saving.value = true;
  try {
    const method = isEdit.value ? 'put' : 'post';
    const url = isEdit.value ? `/settings/users/${formData.id}` : '/settings/users/create';
    
    // MUST await this so the DB is updated before we refetch
    await apiClient[method](url, formData); 
    
    toast.add({ severity: 'success', summary: 'Success', detail: t('common.saved') });
    drawerOpen.value = false;
    
    // Now fetch the fresh data
    await fetchUsers(); 
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Error', detail: t('common.error') });
  } finally {
    saving.value = false;
  }
}

async function executeDelete() {
  deleting.value = true;
  try {
    await apiClient.delete(`/settings/users/${userToDelete.value.id}`);
    deleteModalOpen.value = false;
    fetchUsers();
  } finally {
    deleting.value = false;
  }
}

onMounted(fetchUsers);
</script>