import { NextResponse } from 'next/server'
import { listOllamaModels } from '@/lib/director/ollama'

// Video generation is core (not an add-on), so unlike the director/prompt-builder
// twins this route carries no entitlement guard.
export async function GET() {
  return NextResponse.json({ models: await listOllamaModels() })
}
