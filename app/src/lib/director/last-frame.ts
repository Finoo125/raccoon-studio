/**
 * ffmpeg args to extract the final frame of a clip as a PNG.
 *
 * `-sseof -0.2` seeks to 0.2s before EOF (input-side seek = fast), then we grab a
 * single frame. `-update 1` lets a non-pattern .png filename be written. `-y`
 * overwrites so a retry re-extracts cleanly.
 */
export function buildLastFrameArgs(videoPath: string, outPath: string): string[] {
  return [
    '-y',
    '-sseof', '-0.2',
    '-i', videoPath,
    '-frames:v', '1',
    '-update', '1',
    outPath,
  ]
}
