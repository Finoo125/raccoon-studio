import DirectorWizard from '@/components/movie/director/DirectorWizard'
import AddonGuard from '@/components/addons/AddonGuard'

export default async function DirectorWizardPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return (
    <AddonGuard featureId="movie-maker">
      <DirectorWizard runId={runId} />
    </AddonGuard>
  )
}
