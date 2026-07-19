import SettingsForm from '@/components/settings/SettingsForm'

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Connection config and paths. Env vars are the fallback defaults.</p>
      <div className="mt-6">
        <SettingsForm />
      </div>
    </div>
  )
}
