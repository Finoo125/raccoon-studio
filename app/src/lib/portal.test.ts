import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUIDES, GUIDE_TITLES, PORTAL_URL, guideFor, guideHref, guideUrl } from './portal'

const WIKI = path.resolve(__dirname, '../../../docs/wiki')

describe('the Guide button', () => {
  it('opens the guide of the page you are on, sub-pages included', () => {
    expect(guideUrl('/generate', 'https://p')).toBe('https://p/#/studio/generate-image')
    expect(guideUrl('/generate-videos', 'https://p')).toBe('https://p/#/studio/generate-video')
    expect(guideUrl('/add-ons', 'https://p')).toBe('https://p/#/studio/supporters')
    expect(guideFor('/gallery/whatever')).toBe('gallery')
  })
  it('a page without its own guide gets "Getting around"', () => {
    expect(guideFor('/movie')).toBe('getting-around')
    expect(guideFor('/')).toBe('getting-around')
  })
  it('shows nothing while the Portal address is empty', () => {
    expect(guideUrl('/generate', '')).toBeNull()
  })
  it('the address carries no trailing slash (links are built as `${PORTAL_URL}/#/…`)', () => {
    expect(PORTAL_URL.endsWith('/')).toBe(false)
  })
  // docs/ is not in the public repo, so this only runs where the wiki lives
  it.runIf(fs.existsSync(WIKI))('every guide it opens is a real wiki page', () => {
    for (const slug of new Set([...Object.values(GUIDES), guideFor('/nowhere'), ...Object.keys(GUIDE_TITLES)])) {
      expect(fs.existsSync(path.join(WIKI, `${slug}.md`)), slug).toBe(true)
    }
  })
  it.runIf(fs.existsSync(WIKI))("the chips and invitations name each guide by its own title", () => {
    for (const [slug, title] of Object.entries(GUIDE_TITLES)) {
      const front = fs.readFileSync(path.join(WIKI, `${slug}.md`), 'utf8').match(/^title:\s*(.+)$/m)?.[1].trim()
      expect(title, slug).toBe(front)
    }
  })
  it('a guide by name: its address, or nothing while the address is empty', () => {
    expect(guideHref('better-pictures', 'https://p')).toBe('https://p/#/studio/better-pictures')
    expect(guideHref('better-pictures', '')).toBeNull()
  })
})
