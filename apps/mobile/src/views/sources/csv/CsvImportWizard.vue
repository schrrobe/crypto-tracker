<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>CSV-Import</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="csv-cancel" @click="$emit('close')">
            {{ step === 'result' ? 'Schließen' : 'Abbrechen' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Schritt 1: Upload -->
      <template v-if="step === 'upload'">
        <p class="hint">
          Lade eine CSV mit deinen Beständen hoch (Spalten z.B. „Coin" und „Menge"). Im nächsten
          Schritt bestätigst du die Spalten-Zuordnung.
        </p>
        <ion-item>
          <ion-input
            v-model="label"
            label="Bezeichnung (optional)"
            label-placement="floating"
            placeholder="z.B. Export Bitpanda"
            data-testid="csv-label"
          />
        </ion-item>
        <input
          type="file"
          accept=".csv,text/csv"
          class="file-input"
          data-testid="csv-file"
          @change="onFileSelected"
        />
        <ion-text v-if="error" color="danger"><p class="error" data-testid="csv-error">{{ error }}</p></ion-text>
        <ion-button
          expand="block"
          :disabled="!file || uploading"
          data-testid="csv-upload"
          @click="doUpload"
        >
          <ion-spinner v-if="uploading" name="crescent" />
          <span v-else>Hochladen</span>
        </ion-button>
      </template>

      <!-- Schritt 2: Mapping bestätigen -->
      <template v-else-if="step === 'mapping'">
        <p class="hint" data-testid="csv-row-count">
          {{ uploadResult?.import.totalRows }} Zeilen erkannt — ordne die Spalten zu:
        </p>
        <ion-list inset>
          <ion-item>
            <ion-select
              label="Symbol-Spalte"
              interface="popover"
              :value="mappingSymbol"
              data-testid="mapping-symbol"
              @ionChange="mappingSymbol = $event.detail.value"
            >
              <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-select
              label="Mengen-Spalte"
              interface="popover"
              :value="mappingQuantity"
              data-testid="mapping-quantity"
              @ionChange="mappingQuantity = $event.detail.value"
            >
              <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
            </ion-select>
          </ion-item>
        </ion-list>

        <div class="preview-wrap">
          <table class="preview">
            <thead>
              <tr><th v-for="h in uploadResult?.headers" :key="h">{{ h }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in (uploadResult?.preview ?? []).slice(0, 5)" :key="i">
                <td v-for="h in uploadResult?.headers" :key="h">{{ row[h] }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ion-text v-if="error" color="danger"><p class="error" data-testid="csv-error">{{ error }}</p></ion-text>
        <ion-button
          expand="block"
          :disabled="!mappingSymbol || !mappingQuantity || importing"
          data-testid="csv-import-run"
          @click="doImport"
        >
          <ion-spinner v-if="importing" name="crescent" />
          <span v-else>Importieren</span>
        </ion-button>
      </template>

      <!-- Schritt 3: Ergebnis -->
      <template v-else>
        <ion-text :color="result?.status === 'COMPLETED' ? 'success' : 'danger'">
          <h2 data-testid="csv-result">
            {{ result?.importedRows }} von {{ result?.totalRows }} Zeilen importiert
          </h2>
        </ion-text>

        <template v-if="(result?.errorRows.length ?? 0) > 0">
          <p class="hint">Fehlerhafte Zeilen (nicht importiert):</p>
          <ion-list inset data-testid="csv-error-rows">
            <ion-item v-for="row in result?.errorRows" :key="row.line">
              <ion-label>
                <h3>Zeile {{ row.line }}: {{ row.error }}</h3>
                <p>{{ row.raw }}</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </template>

        <ion-button expand="block" data-testid="csv-done" @click="finish">Fertig</ion-button>
      </template>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref, watch } from 'vue'
import type { CsvImportDto, CsvUploadResponse } from '@crypto-tracker/shared'
import { ApiError } from '../../../services/api.client'
import { useImportsStore } from '../../../stores/imports.store'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; done: [] }>()

const importsStore = useImportsStore()

const step = ref<'upload' | 'mapping' | 'result'>('upload')
const file = ref<File | null>(null)
const label = ref('')
const uploadResult = ref<CsvUploadResponse | null>(null)
const mappingSymbol = ref<string | null>(null)
const mappingQuantity = ref<string | null>(null)
const result = ref<CsvImportDto | null>(null)
const error = ref('')
const uploading = ref(false)
const importing = ref(false)

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    step.value = 'upload'
    file.value = null
    label.value = ''
    uploadResult.value = null
    result.value = null
    error.value = ''
  },
)

function onFileSelected(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function doUpload() {
  if (!file.value) return
  error.value = ''
  uploading.value = true
  try {
    uploadResult.value = await importsStore.upload(file.value, label.value)
    mappingSymbol.value = uploadResult.value.suggestedMapping.symbol
    mappingQuantity.value = uploadResult.value.suggestedMapping.quantity
    step.value = 'mapping'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Upload fehlgeschlagen'
  } finally {
    uploading.value = false
  }
}

async function doImport() {
  if (!uploadResult.value || !mappingSymbol.value || !mappingQuantity.value) return
  error.value = ''
  importing.value = true
  try {
    result.value = await importsStore.confirmMapping(uploadResult.value.import.id, {
      symbol: mappingSymbol.value,
      quantity: mappingQuantity.value,
    })
    step.value = 'result'
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Import fehlgeschlagen'
  } finally {
    importing.value = false
  }
}

function finish() {
  emit('done')
  emit('close')
}
</script>

<style scoped>
.hint {
  color: var(--ion-color-medium);
  font-size: 0.9em;
  margin: 8px 4px;
}
.error {
  margin: 8px 4px;
  font-size: 0.9em;
}
.file-input {
  display: block;
  margin: 16px 4px;
}
.preview-wrap {
  overflow-x: auto;
  margin: 12px 0;
}
.preview {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
}
.preview th,
.preview td {
  border: 1px solid var(--ion-color-step-200, #ccc);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}
</style>
