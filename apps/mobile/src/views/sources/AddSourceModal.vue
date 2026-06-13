<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('sources.connectSource') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="source-modal-cancel" @click="$emit('close')">{{
            $t('common.cancel')
          }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Schritt 1: Typ -->
      <ion-segment :value="type" @ionChange="type = $event.detail.value as SourceKind">
        <ion-segment-button value="EXCHANGE" data-testid="source-type-exchange">
          <ion-label>{{ $t('sources.typeExchange') }}</ion-label>
        </ion-segment-button>
        <ion-segment-button value="WALLET" data-testid="source-type-wallet">
          <ion-label>{{ $t('sources.typeWallet') }}</ion-label>
        </ion-segment-button>
        <ion-segment-button value="MANUAL" data-testid="source-type-manual">
          <ion-label>{{ $t('sources.typeManual') }}</ion-label>
        </ion-segment-button>
      </ion-segment>

      <ion-list inset>
        <!-- Provider-Wahl -->
        <ion-item v-if="type === 'EXCHANGE'">
          <ion-select
            :label="$t('sources.exchange')"
            interface="popover"
            :value="exchangeProvider"
            data-testid="exchange-provider"
            @ionChange="exchangeProvider = $event.detail.value"
          >
            <ion-select-option v-for="p in EXCHANGE_PROVIDERS" :key="p" :value="p">
              {{ PROVIDER_LABELS[p] }}
            </ion-select-option>
          </ion-select>
        </ion-item>
        <!-- Schritt-Anleitung: Read-only-Key beim jeweiligen Anbieter erstellen -->
        <ion-accordion-group v-if="type === 'EXCHANGE'">
          <ion-accordion value="guide">
            <ion-item slot="header" lines="none">
              <ion-label color="medium">{{ $t('sources.keyGuideTitle') }}</ion-label>
            </ion-item>
            <div slot="content" class="guide" data-testid="key-guide">
              <p class="guide-steps">{{ $t(`sources.keyGuide${exchangeProvider}`) }}</p>
              <a
                href="#"
                data-testid="key-guide-link"
                @click.prevent="openExternal(GUIDE_URLS[exchangeProvider])"
              >
                {{ $t('sources.keyGuideLink', { provider: PROVIDER_LABELS[exchangeProvider] }) }}
              </a>
            </div>
          </ion-accordion>
        </ion-accordion-group>

        <ion-item v-if="type === 'WALLET'">
          <ion-select
            :label="$t('sources.network')"
            interface="popover"
            :value="walletProvider"
            data-testid="wallet-provider"
            @ionChange="walletProvider = $event.detail.value"
          >
            <ion-select-option v-for="p in WALLET_PROVIDERS" :key="p" :value="p">
              {{ PROVIDER_LABELS[p] }}
            </ion-select-option>
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-input
            v-model="label"
            :label="$t('sources.label')"
            label-placement="floating"
            :placeholder="labelPlaceholder"
            data-testid="source-label"
          />
        </ion-item>

        <!-- Exchange: read-only API-Key -->
        <template v-if="type === 'EXCHANGE'">
          <ion-item>
            <ion-input
              v-model="apiKey"
              :label="$t('sources.apiKey')"
              label-placement="floating"
              data-testid="source-api-key"
            />
          </ion-item>
          <ion-item v-if="exchangeProvider === 'COINBASE'">
            <ion-textarea
              v-model="apiSecret"
              :label="$t('sources.privateKey')"
              label-placement="floating"
              :rows="4"
              data-testid="source-api-secret"
            />
          </ion-item>
          <ion-item v-else-if="exchangeProvider !== 'BITPANDA'">
            <ion-input
              v-model="apiSecret"
              :label="$t('sources.apiSecret')"
              label-placement="floating"
              type="password"
              data-testid="source-api-secret"
            />
          </ion-item>
          <!-- OKX/KuCoin verlangen zusätzlich die API-Passphrase -->
          <ion-item v-if="needsPassphrase">
            <ion-input
              v-model="passphrase"
              :label="$t('sources.passphrase')"
              label-placement="floating"
              type="password"
              data-testid="source-passphrase"
            />
          </ion-item>
        </template>

        <!-- Wallet: öffentliche Adresse -->
        <ion-item v-if="type === 'WALLET'">
          <ion-input
            v-model="address"
            :label="$t('sources.address')"
            label-placement="floating"
            data-testid="source-address"
          />
        </ion-item>

        <!-- Solana: Spam-Mints sind häufig — unbekannte Tokens nur auf Wunsch -->
        <ion-item v-if="type === 'WALLET' && walletProvider === 'SOLANA'">
          <ion-toggle
            :checked="includeUnknownTokens"
            data-testid="source-include-unknown"
            @ionChange="includeUnknownTokens = $event.detail.checked"
          >
            {{ $t('sources.includeUnknownTokens') }}
          </ion-toggle>
        </ion-item>
      </ion-list>

      <ion-text v-if="type === 'EXCHANGE'" color="medium">
        <p class="hint">{{ $t('sources.readOnlyHint') }}</p>
      </ion-text>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="source-error">{{ error }}</p>
      </ion-text>

      <ion-button
        expand="block"
        :disabled="saving || !valid"
        data-testid="source-save"
        @click="save"
      >
        <ion-spinner v-if="saving" name="crescent" />
        <span v-else>{{ $t('sources.connect') }}</span>
      </ion-button>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonAccordion,
  IonAccordionGroup,
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
  IonToggle,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { computed, ref, watch } from 'vue'
import {
  EXCHANGE_PROVIDERS,
  PASSPHRASE_REQUIRED_PROVIDERS,
  WALLET_PROVIDERS,
  type CreateSourceInput,
} from '@crypto-tracker/shared'
import { apiErrorMessage } from '../../services/errors'
import { openExternal } from '../../services/external-link'
import { t } from '../../i18n'
import { useSourcesStore } from '../../stores/sources.store'

type SourceKind = 'EXCHANGE' | 'WALLET' | 'MANUAL'

// Direktlinks zu den API-Key-Seiten der Anbieter (nicht übersetzt)
const GUIDE_URLS: Record<string, string> = {
  KRAKEN: 'https://pro.kraken.com/app/settings/api',
  BITVAVO: 'https://account.bitvavo.com/user/api',
  COINBASE: 'https://portal.cdp.coinbase.com/access/api',
  BITPANDA: 'https://web.bitpanda.com/apikey',
  BINANCE: 'https://www.binance.com/en/my/settings/api-management',
  OKX: 'https://www.okx.com/account/my-api',
  BYBIT: 'https://www.bybit.com/app/user/api-management',
  KUCOIN: 'https://www.kucoin.com/account/api',
  BITSTAMP: 'https://www.bitstamp.net/account/security/api/',
  GATEIO: 'https://www.gate.io/myaccount/api_key_manage',
  CRYPTOCOM: 'https://exchange.crypto.com/settings/api-management',
}

const PROVIDER_LABELS: Record<string, string> = {
  COINBASE: 'Coinbase',
  KRAKEN: 'Kraken',
  BITVAVO: 'Bitvavo',
  BITPANDA: 'Bitpanda',
  BINANCE: 'Binance',
  OKX: 'OKX',
  BYBIT: 'Bybit',
  KUCOIN: 'KuCoin',
  BITSTAMP: 'Bitstamp',
  GATEIO: 'Gate.io',
  CRYPTOCOM: 'Crypto.com',
  BITCOIN: 'Bitcoin',
  SOLANA: 'Solana',
  ETHEREUM: 'Ethereum',
  POLYGON: 'Polygon',
  ARBITRUM: 'Arbitrum',
  BASE: 'Base',
  BSC: 'BNB Smart Chain',
  LITECOIN: 'Litecoin',
  DOGECOIN: 'Dogecoin',
  CARDANO: 'Cardano',
  XRP: 'XRP Ledger',
  TRON: 'Tron',
  COSMOS: 'Cosmos Hub',
}

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; created: [] }>()

const sourcesStore = useSourcesStore()

const type = ref<SourceKind>('EXCHANGE')
const exchangeProvider = ref<(typeof EXCHANGE_PROVIDERS)[number]>('KRAKEN')
const walletProvider = ref<(typeof WALLET_PROVIDERS)[number]>('BITCOIN')
const label = ref('')
const apiKey = ref('')
const apiSecret = ref('')
const passphrase = ref('')
const address = ref('')
const includeUnknownTokens = ref(false)
const error = ref('')
const saving = ref(false)

const labelPlaceholder = computed(() =>
  type.value === 'EXCHANGE'
    ? t('sources.labelPlaceholderExchange')
    : type.value === 'WALLET'
      ? t('sources.labelPlaceholderWallet')
      : t('sources.labelPlaceholderManual'),
)

const needsPassphrase = computed(() =>
  (PASSPHRASE_REQUIRED_PROVIDERS as readonly string[]).includes(exchangeProvider.value),
)

const valid = computed(() => {
  if (!label.value.trim()) return false
  if (type.value === 'EXCHANGE') {
    const secretOk = exchangeProvider.value === 'BITPANDA' || apiSecret.value.trim().length >= 4
    const passphraseOk = !needsPassphrase.value || passphrase.value.trim().length > 0
    return apiKey.value.trim().length >= 4 && secretOk && passphraseOk
  }
  if (type.value === 'WALLET') return address.value.trim().length >= 10
  return true
})

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    error.value = ''
    saving.value = false
    label.value = ''
    apiKey.value = ''
    apiSecret.value = ''
    passphrase.value = ''
    address.value = ''
    includeUnknownTokens.value = false
  },
)

function buildInput(): CreateSourceInput {
  if (type.value === 'EXCHANGE') {
    return {
      type: 'EXCHANGE',
      provider: exchangeProvider.value,
      label: label.value.trim(),
      apiKey: apiKey.value.trim(),
      apiSecret: apiSecret.value.trim() || undefined,
      passphrase: needsPassphrase.value ? passphrase.value.trim() : undefined,
    }
  }
  if (type.value === 'WALLET') {
    return {
      type: 'WALLET',
      provider: walletProvider.value,
      label: label.value.trim(),
      address: address.value.trim(),
      includeUnknownTokens: includeUnknownTokens.value,
    }
  }
  return { type: 'MANUAL', label: label.value.trim() }
}

async function save() {
  error.value = ''
  saving.value = true
  try {
    await sourcesStore.create(buildInput())
    emit('created')
    emit('close')
  } catch (e) {
    error.value = apiErrorMessage(e, 'sources.connectFailed')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.hint,
.error {
  margin: 8px 16px;
  font-size: 0.9em;
}
.guide {
  padding: 0 16px 12px;
  font-size: 0.9em;
}
.guide-steps {
  white-space: pre-line;
  margin: 0 0 8px;
  color: var(--ion-color-medium);
}
</style>
