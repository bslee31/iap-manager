<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-2xl p-8">
    <div class="titlebar-drag h-8" />
    <h2 class="mb-6 text-2xl font-bold text-gray-100">{{ t('settings.title') }}</h2>

    <div class="border-divider bg-card space-y-4 rounded-xl border p-6">
      <div>
        <h3 class="text-sm font-medium text-gray-400">{{ t('settings.version') }}</h3>
        <p class="text-gray-200">1.0.0</p>
      </div>
      <div>
        <h3 class="text-sm font-medium text-gray-400">{{ t('settings.dataLocation') }}</h3>
        <p class="font-mono text-sm text-gray-200">~/.iap-manager/</p>
      </div>
    </div>
  </div>
</template>
