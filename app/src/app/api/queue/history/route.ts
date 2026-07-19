import { NextRequest, NextResponse } from 'next/server'
import { readHistory, appendHistory, removeHistory, clearCompletedHistory, type JobRecord } from '@/lib/queue/history'

export async function GET() {
  return NextResponse.json({ jobs: readHistory() })
}

export async function POST(req: NextRequest) {
  let rec: JobRecord
  try {
    rec = (await req.json()) as JobRecord
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!rec?.id || !rec?.promptId) {
    return NextResponse.json({ error: 'Missing id/promptId' }, { status: 400 })
  }
  return NextResponse.json({ jobs: appendHistory(rec) })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  return NextResponse.json({ jobs: id ? removeHistory(id) : clearCompletedHistory() })
}
