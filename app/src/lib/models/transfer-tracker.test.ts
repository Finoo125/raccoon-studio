import { describe, it, expect, vi } from 'vitest'
import { createTransferTracker } from './transfer-tracker'

const tracker = () => {
  const onSettled = vi.fn()
  return { onSettled, t: createTransferTracker(onSettled) }
}

describe('createTransferTracker', () => {
  it('prompts once after a bulk run, not per file', () => {
    const { onSettled, t } = tracker()
    for (let i = 0; i < 8; i++) t.begin()
    for (let i = 0; i < 8; i++) {
      t.end(true)
      expect(onSettled).toHaveBeenCalledTimes(i === 7 ? 1 : 0)
    }
  })

  it('stays quiet when nothing new landed', () => {
    const { onSettled, t } = tracker()
    t.begin(); t.begin()
    t.end(false) // cancelled
    t.end(false) // already on disk
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('prompts when any one of a mixed run wrote a file', () => {
    const { onSettled, t } = tracker()
    t.begin(); t.begin()
    t.end(false)
    t.end(true)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not re-prompt on a later run that wrote nothing', () => {
    const { onSettled, t } = tracker()
    t.begin(); t.end(true)
    t.begin(); t.end(false)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('keeps working after a stray end', () => {
    const { onSettled, t } = tracker()
    t.end(false) // never began — must not push the count negative
    t.begin(); t.end(true)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })
})
