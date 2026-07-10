// Notification dispatch abstraction.
//
// BLOCKED CHANNELS: real push delivery depends on Milestone 9 (Capacitor native
// builds) which is not done, and no email transport exists in this project yet.
// Until one lands, the live in-app channel is the dashboard "pending surveys"
// banner (apps/mobile) — re-surfaced automatically by GET /surveys/pending.
//
// `remindNonResponders` therefore computes WHO should be nudged and records the
// intent (audit log + lastRemindedAt cooldown). This interface is the single seam
// where a real channel plugs in later — swap the registered channel, no caller
// changes. Keeping the seam explicit avoids a parallel reminder system being bolted
// on when push finally ships.

export interface SurveyReminderTarget {
  id: string
  title: string
}

export interface NotificationChannel {
  notifySurveyReminder(userIds: string[], survey: SurveyReminderTarget): Promise<void>
}

// Default no-op-but-logged channel. Logs intent so reminders are observable; does not
// deliver out-of-band messages (see BLOCKED CHANNELS above).
export const inAppNotificationChannel: NotificationChannel = {
  async notifySurveyReminder(userIds, survey) {
    // Structured line matching the worker.ts logging style.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'survey_reminder_queued',
        surveyId: survey.id,
        recipientCount: userIds.length,
        note: 'in-app banner only; push/email channel not yet available',
      }),
    )
  },
}

let channel: NotificationChannel = inAppNotificationChannel

// Swap the active channel (tests inject a spy; a real push/email channel registers here
// once Milestone 9 lands).
export function setNotificationChannel(next: NotificationChannel): void {
  channel = next
}

export function getNotificationChannel(): NotificationChannel {
  return channel
}
