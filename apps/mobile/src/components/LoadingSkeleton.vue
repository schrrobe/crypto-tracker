<template>
  <ion-list inset data-testid="loading-skeleton">
    <ion-item v-for="i in count" :key="i">
      <ion-label>
        <h3><ion-skeleton-text :animated="true" style="width: 40%" /></h3>
        <p><ion-skeleton-text :animated="true" style="width: 65%" /></p>
      </ion-label>
    </ion-item>
  </ion-list>
</template>

<script setup lang="ts">
import { IonItem, IonLabel, IonList, IonSkeletonText } from '@ionic/vue'

withDefaults(defineProps<{ count?: number }>(), { count: 3 })
</script>
