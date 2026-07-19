import { NextResponse } from 'next/server'
import { listOllamaModels } from '@/lib/director/ollama'
import { assertEntitled } from '@/lib/addons/guard'

export async function GET() {
  const denied = await assertEntitled('prompt-builder')
  if (denied) return denied
  return NextResponse.json({ models: await listOllamaModels() })
}
