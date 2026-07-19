import { NextResponse } from 'next/server'
import { pickOpenTar } from '@/lib/backup/native-dialog'

export const runtime = 'nodejs'

export async function POST() {
  try {
    return NextResponse.json({ path: await pickOpenTar() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
