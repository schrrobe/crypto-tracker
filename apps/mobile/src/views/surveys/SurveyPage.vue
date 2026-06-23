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
        <p v-if="survey.description" class="ion-padding-horizontal ion-padding-top">{{ survey.description }}</p>

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
                :placeholder="$t('surveys.freeTextPlaceholder')"
                :value="answers[q.id]?.text"
                @ionInput="setText(q.id, $event.target.value ?? '')"
              />
            </ion-item>

            <!-- single choice -->
            <ion-radio-group
              v-else-if="q.type === 'SINGLE_CHOICE'"
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
          <p v-if="submitError" class="ion-color-danger" style="color: var(--ion-color-danger)" data-testid="survey-submit-error">
            {{ submitError }}
          </p>
          <ion-button expand="block" :disabled="submitting" data-testid="survey-submit" @click="submit">
            {{ $t('surveys.submit') }}
          </ion-button>
        </div>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onIonViewWillEnter } from '@ionic/vue'
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
  IonTextarea,
  IonRadioGroup,
  IonRadio,
  IonCheckbox,
  IonButton,
  IonCard,
  IonCardContent,
  IonIcon,
} from '@ionic/vue'
import { checkmarkCircleOutline } from 'ionicons/icons'
import { useRoute } from 'vue-router'
import type { SurveyDto } from '@crypto-tracker/shared'
import { useSurveysStore } from '../../stores/surveys.store'
import { apiErrorMessage } from '../../services/errors'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'

const route = useRoute()
const surveys = useSurveysStore()

const survey = ref<SurveyDto | null>(null)
const answers = reactive<Record<string, { text: string; optionIds: string[] }>>({})
const loading = ref(true)
const submitting = ref(false)
const submitted = ref(false)
const loadError = ref('')
const submitError = ref('')

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
  submitting.value = true
  submitError.value = ''
  try {
    const payload = {
      answers: survey.value.questions.map((q) => ({
        questionId: q.id,
        text: q.type === 'FREE_TEXT' ? (answers[q.id]?.text ?? '') : undefined,
        optionIds: q.type === 'FREE_TEXT' ? undefined : (answers[q.id]?.optionIds ?? []),
      })),
    }
    await surveys.submit(survey.value.id, payload)
    submitted.value = true
  } catch (e) {
    submitError.value = apiErrorMessage(e, 'surveys.submitFailed')
  } finally {
    submitting.value = false
  }
}
</script>
