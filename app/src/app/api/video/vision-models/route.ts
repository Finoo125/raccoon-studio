import { NextResponse } from 'next/server'
import { listOllamaVisionModels } from '@/lib/director/ollama'

/** Ollama models that can see, for Edit's picture describer. */
export async function GET() {
  return NextResponse.json({ models: await listOllamaVisionModels() })
}
