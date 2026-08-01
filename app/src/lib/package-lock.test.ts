import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Guards the two shipped files against each other. When they disagree, every
// user's `npm install` (both installers run it) rewrites the tracked lockfile,
// leaving a dirty working tree in an install nobody edited — and the next release
// that also touches the lockfile makes `git pull` abort with "your local changes
// would be overwritten by merge", killing the Update button for good.
//
// That shipped in v1.0.18–v1.0.34: `engines` landed in package.json alone, so npm
// wrote it into packages[""] on every machine. Cheap to prevent, expensive to
// find. Regenerate with `npm install` in app/ and commit both files together.
const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'))

// The manifest fields npm mirrors into the lockfile's root entry. Listed rather
// than derived: npm ignores the rest (scripts, private), so comparing every key
// would fail on files that are perfectly in sync.
const MIRRORED = [
  'name', 'version', 'license', 'engines', 'bin', 'os', 'cpu', 'workspaces',
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'bundleDependencies',
]

describe('the shipped package-lock.json', () => {
  const pkg = read('package.json')
  const lock = read('package-lock.json')
  const root = lock.packages['']

  it.each(MIRRORED)('mirrors %s from package.json', (field) => {
    expect(root[field]).toEqual(pkg[field])
  })

  it('has a resolved entry for every declared dependency', () => {
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(declared.filter((name) => !lock.packages[`node_modules/${name}`])).toEqual([])
  })
})
