import { describe, it, expect } from 'vitest'
import { defaultBackupName } from './native-dialog'

describe('defaultBackupName', () => {
  it('formats a zero-padded timestamped .tar filename', () => {
    const name = defaultBackupName(new Date(2026, 6, 1, 9, 5, 3)) // 2026-07-01 09:05:03
    expect(name).toBe('raccoon-backup-20260701-090503.tar')
  })
})
