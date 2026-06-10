<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Einstellungen</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-list inset>
        <ion-item>
          <ion-select
            label="Erscheinungsbild"
            interface="popover"
            :value="theme"
            @ionChange="onThemeChange($event.detail.value)"
          >
            <ion-select-option value="system">System</ion-select-option>
            <ion-select-option value="light">Hell</ion-select-option>
            <ion-select-option value="dark">Dunkel</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonContent,
  IonHeader,
  IonItem,
  IonList,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref } from 'vue'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../services/theme.service'

const theme = ref<ThemePreference>(getThemePreference())

function onThemeChange(value: ThemePreference) {
  theme.value = value
  setThemePreference(value)
}
</script>
