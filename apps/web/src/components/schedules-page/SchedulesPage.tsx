import { NotificationSetting } from '@/components/notification-setting'
import { PageHeading } from '@/components/page-heading'
import { ScheduleList } from '@/components/schedule-list'

export const SchedulesPage = () => (
  <main className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
    <PageHeading
      title="Schedules"
      description="Reminders, and anything else Familiar does at a time."
    />
    <NotificationSetting />
    <ScheduleList />
  </main>
)
