import { describe, it, expect } from 'vitest'
import {
  tarCreateArgs,
  tarAppendArgs,
  tarExtractArgs,
  tarListArgs,
  tarReadFileArgs,
  countFileEntries,
  normalizeVerboseLine,
} from './tar'

describe('tar argv builders', () => {
  it('creates an archive with a single member from a working dir', () => {
    expect(tarCreateArgs('/out/backup.tar', '/tmp/stage', 'manifest.json')).toEqual([
      '-cf', '/out/backup.tar', '-C', '/tmp/stage', 'manifest.json',
    ])
  })

  it('appends a member verbosely for progress', () => {
    expect(tarAppendArgs('/out/backup.tar', '/data/output', 'images')).toEqual([
      '-rvf', '/out/backup.tar', '-C', '/data/output', 'images',
    ])
  })

  it('extracts a member into a destination, stripping the member prefix', () => {
    expect(tarExtractArgs('/in/backup.tar', '/data/output/images', 'images', 1)).toEqual([
      '-xvf', '/in/backup.tar', '-C', '/data/output/images', '--strip-components=1', 'images',
    ])
  })

  it('extracts a nested member with a matching strip depth', () => {
    expect(tarExtractArgs('/in/backup.tar', '/app/projects/movies', 'projects/movies', 2)).toEqual([
      '-xvf', '/in/backup.tar', '-C', '/app/projects/movies', '--strip-components=2', 'projects/movies',
    ])
  })

  it('lists names only', () => {
    expect(tarListArgs('/in/backup.tar')).toEqual(['-tf', '/in/backup.tar'])
  })

  it('reads a single member to stdout', () => {
    expect(tarReadFileArgs('/in/backup.tar', 'manifest.json')).toEqual([
      '-xOf', '/in/backup.tar', 'manifest.json',
    ])
  })
})

describe('countFileEntries', () => {
  it('counts files, ignoring directory entries and blank lines', () => {
    const out = ['images/', 'images/a.png', 'images/b.png', 'video/', 'video/c.mp4', ''].join('\n')
    expect(countFileEntries(out)).toBe(3)
  })

  it('is zero for an empty listing', () => {
    expect(countFileEntries('')).toBe(0)
  })
})

describe('normalizeVerboseLine', () => {
  it('passes through a GNU tar path', () => {
    expect(normalizeVerboseLine('images/a.png')).toBe('images/a.png')
  })

  it('strips the bsdtar "a " create prefix', () => {
    expect(normalizeVerboseLine('a images/a.png')).toBe('images/a.png')
  })

  it('strips the bsdtar "x " extract prefix', () => {
    expect(normalizeVerboseLine('x video/c.mp4')).toBe('video/c.mp4')
  })

  it('returns null for directory entries so progress counts files only', () => {
    expect(normalizeVerboseLine('images/')).toBeNull()
    expect(normalizeVerboseLine('a images/')).toBeNull()
  })

  it('returns null for blank lines', () => {
    expect(normalizeVerboseLine('')).toBeNull()
    expect(normalizeVerboseLine('   ')).toBeNull()
  })
})
