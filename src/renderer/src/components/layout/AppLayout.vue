<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import ToastContainer from '../common/ToastContainer.vue'
import { ref, provide } from 'vue'

const createProjectTrigger = ref(0)
provide('createProjectTrigger', createProjectTrigger)

function onCreateProject() {
  createProjectTrigger.value++
}
</script>

<template>
  <div class="flex h-screen">
    <AppSidebar @create-project="onCreateProject" />
    <main class="flex-1 overflow-y-auto">
      <router-view />
    </main>
    <ToastContainer />
  </div>
</template>
