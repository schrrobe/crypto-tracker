<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/dashboard" />
        </ion-buttons>
        <ion-title>{{ survey?.title ?? $t('surveys.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div v-if="loadError" class="ion-padding ion-text-center" data-testid="survey-error">
        <p style="color: var(--ion-color-danger)">{{ loadError }}</p>
        <ion-button fill="outline" router-link="/tabs/dashboard">{{ $t('common.back') }}</ion-button>
      </div>
      <LoadingSkeleton v-else-if="loading" />

      <template v-else-if="submitted">
        <ion-card data-testid="survey-thanks">
          <ion-card-content class="ion-text-center">
            <ion-icon :icon="checkmarkCircleOutline" size="large" color="success" />
            <p>{{ $t('surveys.thanks') }}</p>
            <ion-button fill="outline" router-link="/tabs/dashboard">{{ $t('common.back') }}</ion-button>
          </ion-card-content>
        </ion-card>
      </template>

      <template v-else-if="survey">
        <div class="ion-padding-horizontal ion-padding-top">
          <ion-note v-if="survey.anonymous" class="survey-anonymous" data-testid="survey-anonymous-badge">
            <ion-icon :icon="lockClosedOutline" aria-hidden="true" />
            <span>{{ $t('surveys.anonymousNote') }}</span>
          </ion-note>
          <ion-note v-else class="survey-anonymous" data-testid="survey-identified-badge">
            <ion-icon :icon="personCircleOutline" aria-hidden="true" />
            <span>{{ $t('surveys.identifiedNote') }}</span>
          </ion-note>
        </div>

        <p v-if="survey.description" class="ion-padding-horizontal ion-padding-top">{{ survey.description }}</p>

        <!-- empty state: a loaded survey with no questions -->
        <div
          v-if="survey.questions.length === 0"
          class="ion-padding ion-text-center"
          data-testid="survey-empty"
        >
          <ion-icon :icon="documentTextOutline" size="large" color="medium" />
          <p>{{ $t('surveys.empty') }}</p>
          <ion-button fill="outline" router-link="/tabs/dashboard">{{ $t('common.back') }}</ion-button>
        </div>

        <template v-else>
        <div class="ion-padding-horizontal ion-padding-top" data-testid="survey-progress">
          <ion-label class="survey-progress-label">
            {{ $t('surveys.progress', { answered: answeredCount, total: survey.questions.length }) }}
          </ion-label>
          <ion-progress-bar :value="progressValue" />
          <ion-label class="survey-optional-hint" data-testid="survey-optional-hint">
            {{ $t('surveys.optionalHint') }}
          </ion-label>
        </div>

        <ion-list>
          <template v-for="q in survey.questions" :key="q.id">
            <ion-item-divider>
              <ion-label class="ion-text-wrap">{{ q.prompt }}</ion-label>
            </ion-item-divider>

            <!-- free text -->
            <ion-item v-if="q.type === 'FREE_TEXT'">
              <ion-textarea
                :auto-grow="true"
                :rows="2"
                data-testid="survey-freetext"
                :placeholder="$t('surveys.freeTextPlaceholder')"
                :value="answers[q.id]?.text"
                @ionInput="setText(q.id, $event.target.value ?? '')"
              />
            </ion-item>

            <!-- single choice -->
            <ion-radio-group
              v-else-if="q.type === 'SINGLE_CHOICE'"
              data-testid="survey-single-group"
              :value="answers[q.id]?.optionIds[0] ?? null"
              @ionChange="setOptionIds(q.id, $event.detail.value ? [$event.detail.value] : [])"
            >
              <ion-item v-for="o in q.options" :key="o.id">
                <ion-radio :value="o.id">{{ o.label }}</ion-radio>
              </ion-item>
            </ion-radio-group>

            <!-- multi choice -->
            <template v-else>
              <ion-item v-for="o in q.options" :key="o.id">
                <ion-checkbox
                  :checked="answers[q.id]?.optionIds.includes(o.id)"
                  @ionChange="toggleOption(q.id, o.id, $event.detail.checked)"
                >
                  {{ o.label }}
                </ion-checkbox>
              </ion-item>
            </template>
          </template>
        </ion-list>

        <div class="ion-padding">
          <p v-if="validationError" style="color: var(--ion-color-warning)" data-testid="survey-validation-error">
            {{ validationError }}
          </p>
          <p v-if="submitError" class="ion-color-danger" style="color: var(--ion-color-danger)" data-testid="survey-submit-error">
            {{ submitError }}
          </p>
          <ion-button expand="block" :disabled="submitting" data-testid="survey-submit" @click="submit">
            {{ $t('surveys.submit') }}
          </ion-button>
        </div>
        </template>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onIonViewWillEnter } from '@ionic/vue'
import { useI18n } from 'vue-i18n'
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonNote,
  IonTextarea,
  IonRadioGroup,
  IonRadio,
  IonCheckbox,
  IonButton,
  IonCard,
  IonCardContent,
  IonIcon,
  IonProgressBar,
} from '@ionic/vue'
import { checkmarkCircleOutline, lockClosedOutline, documentTextOutline, personCircleOutline } from 'ionicons/icons'
import { useRoute } from 'vue-router'
import type { SurveyDto } from '@crypto-tracker/shared'
import { useSurveysStore } from '../../stores/surveys.store'
import { ApiError } from '../../services/api.client'
import { apiErrorMessage } from '../../services/errors'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'

const route = useRoute()
const surveys = useSurveysStore()
const { t } = useI18n()

const survey = ref<SurveyDto | null>(null)
const answers = reactive<Record<string, { text: string; optionIds: string[] }>>({})
const loading = ref(true)
const submitting = ref(false)
const submitted = ref(false)
const loadError = ref('')
const submitError = ref('')
const validationError = ref('')

// A question counts as answered when it has non-empty free text or at least one selected option.
function isAnswered(questionId: string): boolean {
  const a = answers[questionId]
  if (!a) return false
  return a.text.trim().length > 0 || a.optionIds.length > 0
}

const answeredCount = computed(() =>
  (survey.value?.questions ?? []).filter((q) => isAnswered(q.id)).length,
)

const progressValue = computed(() => {
  const total = survey.value?.questions.length ?? 0
  return total === 0 ? 0 : answeredCount.value / total
})

function setText(questionId: string, text: string) {
  const a = answers[questionId]
  if (a) a.text = text
}

function setOptionIds(questionId: string, optionIds: string[]) {
  const a = answers[questionId]
  if (a) a.optionIds = optionIds
}

function toggleOption(questionId: string, optionId: string, checked: boolean) {
  const a = answers[questionId]
  if (!a) return
  const cur = a.optionIds
  a.optionIds = checked ? [...cur, optionId] : cur.filter((id) => id !== optionId)
}

onIonViewWillEnter(async () => {
  loading.value = true
  loadError.value = ''
  submitError.value = ''
  validationError.value = ''
  submitted.value = false
  try {
    const s = await surveys.getSurvey(route.params.id as string)
    survey.value = s
    for (const q of s.questions) answers[q.id] = { text: '', optionIds: [] }
  } catch (e) {
    loadError.value = apiErrorMessage(e, 'common.loadFailed')
  } finally {
    loading.value = false
  }
})

async function submit() {
  if (!survey.value) return
  submitError.value = ''
  validationError.value = ''
  // Gentle inline guard: avoid an opaque server error when nothing was answered.
  if (answeredCount.value === 0) {
    validationError.value = t('surveys.noAnswers')
    return
  }
  submitting.value = true
  try {
    const payload = {
      // Only send answered questions. Questions are optional, so serializing skipped
      // ones would persist empty SurveyAnswer rows and muddy the per-question
      // answeredCount analytics (skipped recorded alongside real answers).
      answers: survey.value.questions
        .filter((q) => isAnswered(q.id))
        .map((q) => ({
          questionId: q.id,
          text: q.type === 'FREE_TEXT' ? (answers[q.id]?.text ?? '') : undefined,
          optionIds: q.type === 'FREE_TEXT' ? undefined : (answers[q.id]?.optionIds ?? []),
        })),
    }
    await surveys.submit(survey.value.id, payload)
    submitted.value = true
  } catch (e) {
    // A duplicate submission is a friendly, expected case — show a clear message
    // instead of the generic submit-error text used for everything else.
    if (e instanceof ApiError && e.code === 'SURVEY_ALREADY_SUBMITTED') {
      submitError.value = t('surveys.alreadySubmitted')
    } else {
      submitError.value = apiErrorMessage(e, 'surveys.submitFailed')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.survey-anonymous {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
}
.survey-progress-label {
  display: block;
  font-size: 0.8125rem;
  color: var(--ion-color-medium);
  margin-bottom: 6px;
}
.survey-optional-hint {
  display: block;
  font-size: 0.8125rem;
  color: var(--ion-color-medium);
  margin-top: 6px;
}
</style>
