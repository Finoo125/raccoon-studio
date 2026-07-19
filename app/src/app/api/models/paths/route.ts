import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    modelsDir: process.env.COMFYUI_MODELS_DIR ?? null,
    outputDir: process.env.COMFYUI_OUTPUT_DIR ?? null,
  })
}
