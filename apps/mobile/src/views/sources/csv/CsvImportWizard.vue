<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('csv.title') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="csv-cancel" @click="$emit('close')">
            {{ step === 'result' ? $t('common.close') : $t('common.cancel') }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Schritt 1: Upload -->
      <template v-if="step === 'upload'">
        <p class="hint">{{ $t('csv.intro') }}</p>
        <ion-text color="warning">
          <p class="hint" data-testid="csv-double-count-hint">⚠ {{ $t('csv.doubleCountHint') }}</p>
        </ion-text>
        <ion-segment :value="kind" @ionChange="kind = $event.detail.value as ImportKind">
          <ion-segment-button value="BALANCES" data-testid="csv-kind-balances">
            <ion-label>{{ $t('csv.kindBalances') }}</ion-label>
          </ion-segment-button>
          <ion-segment-button value="TRANSACTIONS" data-testid="csv-kind-transactions">
            <ion-label>{{ $t('csv.kindTransactions') }}</ion-label>
          </ion-segment-button>
        </ion-segment>
        <ion-item>
          <ion-input
            v-model="label"
            :label="$t('csv.labelOptional')"
            label-placement="floating"
            :placeholder="$t('csv.labelPlaceholder')"
            data-testid="csv-label"
          />
        </ion-item>
        <!-- Optionale Börse → aktive Doppel-Erkennung gegen vorhandene API-Quellen -->
        <ion-item>
          <ion-select
            :label="$t('csv.exchangeOptional')"
            interface="popover"
            :value="exchange"
            data-testid="csv-exchange"
            @ionChange="exchange = $event.detail.value"
          >
            <ion-select-option value="">{{ $t('csv.exchangeNone') }}</ion-select-option>
            <ion-select-option v-for="p in EXCHANGE_PROVIDERS" :key="p" :value="p">
              {{ PROVIDER_LABELS[p] }}
            </ion-select-option>
          </ion-select>
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
          <span v-else>{{ $t('csv.upload') }}</span>
        </ion-button>
      </template>

      <!-- Schritt 2: Mapping bestätigen -->
      <template v-else-if="step === 'mapping'">
        <p class="hint" data-testid="csv-row-count">
          {{ $t('csv.rowsDetected', { n: uploadResult?.import.totalRows }) }}
        </p>
        <p v-if="uploadResult?.preset" class="hint preset" data-testid="csv-preset">
          {{ $t('csv.presetDetected', { provider: presetName(uploadResult.preset) }) }}
        </p>
        <ion-text v-if="uploadResult?.duplicateExchangeSource" color="danger">
          <p class="hint" data-testid="csv-duplicate-warning">
            ⚠
            {{
              $t('csv.duplicateExchange', {
                provider: PROVIDER_LABELS[uploadResult.duplicateExchangeProvider ?? ''] ?? '',
                source: uploadResult.duplicateExchangeSource,
              })
            }}
          </p>
        </ion-text>
        <ion-list inset>
          <ion-item>
            <ion-select
              :label="$t('csv.symbolColumn')"
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
              :label="$t('csv.quantityColumn')"
              interface="popover"
              :value="mappingQuantity"
              data-testid="mapping-quantity"
              @ionChange="mappingQuantity = $event.detail.value"
            >
              <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
            </ion-select>
          </ion-item>
          <template v-if="kind === 'TRANSACTIONS'">
            <ion-item>
              <ion-select
                :label="$t('csv.typeColumn')"
                interface="popover"
                :value="mappingType"
                data-testid="mapping-type"
                @ionChange="mappingType = $event.detail.value"
              >
                <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item>
              <ion-select
                :label="$t('csv.timestampColumn')"
                interface="popover"
                :value="mappingTimestamp"
                data-testid="mapping-timestamp"
                @ionChange="mappingTimestamp = $event.detail.value"
              >
                <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item>
              <ion-select
                :label="$t('csv.priceColumn')"
                interface="popover"
                :value="mappingPrice"
                data-testid="mapping-price"
                @ionChange="mappingPrice = $event.detail.value"
              >
                <ion-select-option :value="''">{{ $t('csv.noColumn') }}</ion-select-option>
                <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item>
              <ion-select
                :label="$t('csv.currencyColumn')"
                interface="popover"
                :value="mappingCurrency"
                data-testid="mapping-currency"
                @ionChange="mappingCurrency = $event.detail.value"
              >
                <ion-select-option :value="''">{{ $t('csv.noColumn') }}</ion-select-option>
                <ion-select-option v-for="h in uploadResult?.headers" :key="h" :value="h">{{ h }}</ion-select-option>
              </ion-select>
            </ion-item>
          </template>
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
          :disabled="!mappingSymbol || !mappingQuantity || (kind === 'TRANSACTIONS' && (!mappingType || !mappingTimestamp)) || importing"
          data-testid="csv-import-run"
          @click="doImport"
        >
          <ion-spinner v-if="importing" name="crescent" />
          <span v-else>{{ $t('csv.run') }}</span>
        </ion-button>
      </template>

      <!-- Schritt 3: Ergebnis -->
      <template v-else>
        <ion-text :color="result?.status === 'COMPLETED' ? 'success' : 'danger'">
          <h2 data-testid="csv-result">
            {{ $t('csv.result', { imported: result?.importedRows, total: result?.totalRows }) }}
          </h2>
        </ion-text>

        <template v-if="(result?.errorRows.length ?? 0) > 0">
          <p class="hint">{{ $t('csv.errorRowsTitle') }}</p>
          <ion-list inset data-testid="csv-error-rows">
            <ion-item v-for="row in result?.errorRows" :key="row.line">
              <ion-label>
                <h3>{{ $t('csv.errorLine', { line: row.line, error: row.error }) }}</h3>
                <p>{{ row.raw }}</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </template>

        <ion-button expand="block" data-testid="csv-done" @click="finish">{{ $t('common.done') }}</ion-button>
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
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref, watch } from 'vue'
import { EXCHANGE_PROVIDERS, type CsvImportDto, type CsvUploadResponse } from '@crypto-tracker/shared'
import { apiErrorMessage } from '../../../services/errors'
import { PROVIDER_LABELS } from '../../../services/provider-labels'
import { useImportsStore } from '../../../stores/imports.store'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; done: [] }>()

const importsStore = useImportsStore()

type ImportKind = 'BALANCES' | 'TRANSACTIONS'

const step = ref<'upload' | 'mapping' | 'result'>('upload')
const kind = ref<ImportKind>('BALANCES')
const file = ref<File | null>(null)
const label = ref('')
const exchange = ref('')
const uploadResult = ref<CsvUploadResponse | null>(null)
const mappingSymbol = ref<string | null>(null)
const mappingQuantity = ref<string | null>(null)
const mappingType = ref<string | null>(null)
const mappingTimestamp = ref<string | null>(null)
const mappingPrice = ref<string>('')
const mappingCurrency = ref<string>('')
const result = ref<CsvImportDto | null>(null)
const error = ref('')
const uploading = ref(false)
const importing = ref(false)

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    step.value = 'upload'
    kind.value = 'BALANCES'
    file.value = null
    label.value = ''
    exchange.value = ''
    uploadResult.value = null
    result.value = null
    error.value = ''
  },
)

function onFileSelected(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function presetName(preset: 'KRAKEN' | 'BITPANDA' | null): string {
  return preset === 'KRAKEN' ? 'Kraken' : preset === 'BITPANDA' ? 'Bitpanda' : ''
}

async function doUpload() {
  if (!file.value) return
  error.value = ''
  uploading.value = true
  try {
    uploadResult.value = await importsStore.upload(
      file.value,
      label.value,
      kind.value,
      exchange.value || undefined,
    )
    const suggestion = uploadResult.value.suggestedMapping
    mappingSymbol.value = suggestion.symbol
    mappingQuantity.value = suggestion.quantity
    mappingType.value = suggestion.type
    mappingTimestamp.value = suggestion.timestamp
    mappingPrice.value = suggestion.price ?? ''
    mappingCurrency.value = suggestion.currency ?? ''
    step.value = 'mapping'
  } catch (e) {
    error.value = apiErrorMessage(e, 'csv.uploadFailed')
  } finally {
    uploading.value = false
  }
}

async function doImport() {
  if (!uploadResult.value || !mappingSymbol.value || !mappingQuantity.value) return
  error.value = ''
  importing.value = true
  try {
    const mapping: Record<string, string> = {
      symbol: mappingSymbol.value,
      quantity: mappingQuantity.value,
    }
    if (kind.value === 'TRANSACTIONS') {
      if (mappingType.value) mapping.type = mappingType.value
      if (mappingTimestamp.value) mapping.timestamp = mappingTimestamp.value
      if (mappingPrice.value) mapping.price = mappingPrice.value
      if (mappingCurrency.value) mapping.currency = mappingCurrency.value
    }
    result.value = await importsStore.confirmMapping(uploadResult.value.import.id, mapping)
    step.value = 'result'
  } catch (e) {
    error.value = apiErrorMessage(e, 'csv.importFailed')
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
