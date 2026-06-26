<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/settings" />
        </ion-buttons>
        <ion-title>{{ $t('tax.title') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            v-if="report && report.disposals.length > 0"
            data-testid="tax-export-csv"
            @click="exportCsv"
          >
            <ion-icon :icon="downloadOutline" slot="start" />
            {{ $t('tax.exportCsv') }}
          </ion-button>
          <ion-button v-if="report" data-testid="tax-export-pdf" @click="exportPdf">
            <ion-icon :icon="documentOutline" slot="start" />
            {{ $t('tax.exportPdf') }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <PortfolioSwitcher variant="banner" @switched="loadData" />
      <ion-list inset>
        <ion-item>
          <ion-select
            :label="$t('tax.year')"
            interface="popover"
            :value="store.year"
            data-testid="tax-year"
            @ionChange="onYearChange($event.detail.value)"
          >
            <ion-select-option v-for="y in years" :key="y" :value="y">{{ y }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select
            :label="$t('tax.country')"
            interface="popover"
            :value="store.country"
            data-testid="tax-country"
            @ionChange="onCountryChange($event.detail.value)"
          >
            <ion-select-option value="DE">{{ $t('tax.countryDE') }}</ion-select-option>
            <ion-select-option value="AT">{{ $t('tax.countryAT') }}</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>

      <ion-card color="warning" class="disclaimer">
        <ion-card-header>
          <ion-card-title>{{ $t('tax.disclaimerTitle') }}</ion-card-title>
        </ion-card-header>
        <ion-card-content data-testid="tax-disclaimer">{{ $t('tax.disclaimer') }}</ion-card-content>
      </ion-card>

      <ion-item v-if="store.backfilling" lines="none" data-testid="tax-backfilling">
        <ion-spinner slot="start" name="dots" />
        <ion-label>{{ $t('tax.backfillingPrices') }}</ion-label>
      </ion-item>

      <LoadingSkeleton v-if="pageLoading" />
      <ErrorState v-else-if="pageError" @retry="loadData" />

      <template v-else-if="report">
        <ion-card data-testid="tax-totals">
          <ion-card-content>
            <div class="total-row">
              <span>{{ $t('tax.totalGain') }}</span>
              <strong data-testid="tax-total-gain">{{ money(report.totals.totalGainEur) }}</strong>
            </div>
            <div class="total-row">
              <span>{{ $t('tax.taxFreeGain') }}</span>
              <span>{{ money(report.totals.taxFreeGainEur) }}</span>
            </div>
            <div class="total-row">
              <span>{{ $t('tax.taxableGain') }}</span>
              <span>{{ money(report.totals.taxableGainEur) }}</span>
            </div>
            <div v-if="report.totals.thresholdEur" class="total-row threshold">
              <span>{{ $t('tax.threshold') }} ({{ money(report.totals.thresholdEur) }})</span>
              <span>{{
                report.totals.thresholdApplied ? $t('tax.thresholdApplied') : $t('tax.thresholdNotApplied')
              }}</span>
            </div>
            <div class="total-row main">
              <span>{{ $t('tax.taxableAfterThreshold') }}</span>
              <strong data-testid="tax-taxable-final">{{ money(report.totals.taxableAfterThresholdEur) }}</strong>
            </div>
            <div v-if="report.totals.atNeuvermoegenGainEur !== undefined" class="total-row">
              <span>{{ $t('tax.neuvermoegenGain') }}</span>
              <span data-testid="tax-neuvermoegen">{{ money(report.totals.atNeuvermoegenGainEur) }}</span>
            </div>
            <div v-if="report.totals.atNeuvermoegenTaxEur !== undefined" class="total-row threshold">
              <span>{{ $t('tax.neuvermoegenTax') }}</span>
              <span data-testid="tax-neuvermoegen-tax">{{ money(report.totals.atNeuvermoegenTaxEur) }}</span>
            </div>
            <template v-if="report.totals.stakingIncomeEur !== undefined">
              <div class="total-row">
                <span>{{ $t('tax.stakingIncome') }}</span>
                <span data-testid="tax-staking-income">{{ money(report.totals.stakingIncomeEur) }}</span>
              </div>
              <div v-if="report.totals.stakingThresholdEur" class="total-row threshold">
                <span>{{ $t('tax.stakingThreshold') }} ({{ money(report.totals.stakingThresholdEur) }})</span>
                <span>{{ $t('tax.stakingTaxable') }}: {{ money(report.totals.stakingTaxableEur ?? '0') }}</span>
              </div>
            </template>
          </ion-card-content>
        </ion-card>

        <ion-card v-if="report.warnings.length > 0" data-testid="tax-warnings">
          <ion-card-header>
            <ion-card-title>{{ $t('tax.warningsTitle') }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p v-for="(w, i) in report.warnings" :key="i" class="warning-line">
              {{ warningText(w) }}
            </p>
          </ion-card-content>
        </ion-card>

        <ion-card v-if="report.uncoveredSources.length > 0" data-testid="tax-uncovered">
          <ion-card-header>
            <ion-card-title>{{ $t('tax.uncoveredTitle') }}</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p>{{ $t('tax.uncoveredHint') }}</p>
            <p v-for="s in report.uncoveredSources" :key="s.id">— {{ s.label }}</p>
          </ion-card-content>
        </ion-card>

        <ion-list v-if="report.disposals.length > 0" inset>
          <ion-list-header>
            <ion-label>{{ $t('tax.disposals') }}</ion-label>
          </ion-list-header>
          <ion-item
            v-for="(d, i) in visibleDisposals"
            :key="i"
            :data-testid="`tax-disposal-${d.assetSymbol}`"
          >
            <ion-label>
              <h3>
                {{ d.assetSymbol }} · {{ formatQuantity(d.quantity) }}
                <ion-badge :color="d.taxable ? 'danger' : 'success'">
                  {{ d.taxable ? $t('tax.taxableYes') : $t('tax.taxableNo') }}
                </ion-badge>
                <ion-badge color="medium">{{ $t(`tax.regime${d.regime}`) }}</ion-badge>
                <ion-badge v-if="d.priceQuality === 'BACKFILLED'" color="tertiary">{{
                  $t('tax.priceBackfilled')
                }}</ion-badge>
                <ion-badge v-else-if="d.priceQuality === 'MISSING'" color="warning">{{
                  $t('tax.priceMissing')
                }}</ion-badge>
              </h3>
              <p>
                {{ $t('tax.acquired') }}:
                {{ d.acquiredAt ? formatDate(d.acquiredAt) : $t('tax.unknownAcquisition') }}
                → {{ formatDate(d.disposedAt) }}
                <template v-if="d.sourceLabel"> · {{ d.sourceLabel }}</template>
              </p>
              <p>
                {{ money(d.costBasisEur) }} → {{ money(d.proceedsEur) }} ·
                <strong>{{ money(d.gainEur) }}</strong>
              </p>
            </ion-label>
          </ion-item>
          <ion-infinite-scroll
            v-if="report.disposals.length > visibleCount"
            @ionInfinite="loadMore"
          >
            <ion-infinite-scroll-content />
          </ion-infinite-scroll>
        </ion-list>
        <p v-else class="empty" data-testid="tax-no-disposals">{{ $t('tax.noDisposals') }}</p>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import type { InfiniteScrollCustomEvent } from '@ionic/vue'
import { documentOutline, downloadOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import type { TaxCountry, TaxWarningDto } from '@crypto-tracker/shared'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'
import ErrorState from '../../components/ErrorState.vue'
import PortfolioSwitcher from '../../components/PortfolioSwitcher.vue'
import { useTaxStore } from '../../stores/tax.store'
import { formatCurrency, formatQuantity, intlLocale } from '../../services/format'
import { downloadCsv } from '../../services/download'
import { downloadTaxReportPdf } from '../../services/pdf'
import { t } from '../../i18n'

const store = useTaxStore()
const report = computed(() => store.report)

const pageLoading = ref(false)
const pageError = ref(false)

// Render disposals incrementally — heavy traders can have thousands of rows;
// mounting them all at once janks the page. Grow the window on scroll.
const PAGE_SIZE = 50
const visibleCount = ref(PAGE_SIZE)
const visibleDisposals = computed(() => report.value?.disposals.slice(0, visibleCount.value) ?? [])

function loadMore(ev: InfiniteScrollCustomEvent) {
  visibleCount.value += PAGE_SIZE
  void ev.target.complete()
}

// Tax years: current year back to 2015
const years = Array.from({ length: new Date().getFullYear() - 2014 }, (_, i) => new Date().getFullYear() - i)

function money(value: string): string {
  return formatCurrency(value, 'EUR')
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(iso))
}

function warningText(w: TaxWarningDto): string {
  return t(`tax.warnings.${w.code}`, { symbol: w.assetSymbol ?? '', count: w.count ?? 1 })
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await store.load()
    visibleCount.value = PAGE_SIZE
  } catch {
    pageError.value = true
    return
  } finally {
    pageLoading.value = false
  }
  // First report is painted; if the price-lookup cap left daily prices open,
  // keep topping them up in the background (store.backfilling drives the hint).
  void store.loadWithBackfill()
}

async function onYearChange(year: number) {
  store.year = year
  await loadData()
}

async function onCountryChange(country: TaxCountry) {
  store.setCountry(country)
  await loadData()
}

// German/Austrian decimal notation: comma separator (Excel DE/AT parses
// "1234,56" as a number, "1234.56" as text). EUR values arrive already rounded
// to 2 places from the server; quantities are trimmed to 8 fractional digits.
function de(value: string): string {
  return value.replace('.', ',')
}

function trimQty(q: string): string {
  const dot = q.indexOf('.')
  if (dot === -1) return q
  const int = q.slice(0, dot)
  const cut = q.slice(dot + 1).slice(0, 8).replace(/0+$/, '')
  return cut ? `${int},${cut}` : int
}

// Filesystem-safe slug of the tax entity name for export filenames
function entitySlug(label: string): string {
  return (
    label
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'portfolio'
  )
}

async function exportCsv() {
  if (!report.value) return
  const r = report.value
  const rows: Array<Array<string>> = r.disposals.map((d) => [
    d.assetSymbol,
    trimQty(d.quantity),
    d.acquiredAt ? d.acquiredAt.slice(0, 10) : '',
    d.disposedAt.slice(0, 10),
    de(d.costBasisEur),
    de(d.proceedsEur),
    de(d.gainEur),
    d.taxable ? 'ja' : 'nein',
    d.regime,
    d.priceQuality,
  ])
  // Summary rows so the export ties out to the totals shown on screen
  rows.push([])
  rows.push([t('portfolios.activeEntity'), r.portfolioLabel, '', '', '', '', '', '', '', ''])
  rows.push(['Summe Gewinn/Verlust', '', '', '', '', '', de(r.totals.totalGainEur), '', '', ''])
  rows.push([
    'Steuerpflichtig nach Freigrenze',
    '',
    '',
    '',
    '',
    '',
    de(r.totals.taxableAfterThresholdEur),
    '',
    '',
    '',
  ])
  await downloadCsv(
    `steuerreport-${entitySlug(r.portfolioLabel)}-${r.country}-${r.year}.csv`,
    [
      'Asset',
      'Menge',
      'Anschaffung',
      'Veraeusserung',
      'Anschaffungskosten EUR',
      'Erloes EUR',
      'Gewinn/Verlust EUR',
      'Steuerpflichtig',
      'Regime',
      'Kursqualitaet',
    ],
    rows,
  )
}

async function exportPdf() {
  if (report.value) await downloadTaxReportPdf(report.value)
}

onIonViewWillEnter(() => {
  // Drop the session cache on (re-)entry so newly imported transactions show up;
  // the cache only short-circuits year/country toggles within the open report.
  store.clearCache()
  loadData()
})
</script>

<style scoped>
.disclaimer ion-card-title {
  font-size: 1em;
}
.total-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}
.total-row.main {
  border-top: 1px solid var(--ion-color-medium);
  margin-top: 6px;
  padding-top: 6px;
}
.total-row.threshold {
  color: var(--ion-color-medium);
  font-size: 0.9em;
}
.warning-line {
  margin: 4px 0;
}
.empty {
  text-align: center;
  margin-top: 32px;
  color: var(--ion-color-medium);
}
</style>
