/**
 * Pure argv builders + output parsers for the system `tar` binary. Kept free of
 * any spawning so the flag construction and stdout parsing are unit-testable
 * without touching the filesystem or a real tar. The flags used here
 * (`-cf/-rvf/-xvf/-tf/-xOf`, `-C`, `--strip-components`) are shared by GNU tar
 * (Linux) and bsdtar (Windows `tar.exe`), which is what lets a backup made on
 * one OS restore on the other.
 */

/** `tar -cf <archive> -C <cwd> <member>` — create a new archive with one member. */
export function tarCreateArgs(archivePath: string, cwd: string, member: string): string[] {
  return ['-cf', archivePath, '-C', cwd, member]
}

/** `tar -rvf <archive> -C <cwd> <member>` — append a member (verbose → progress). */
export function tarAppendArgs(archivePath: string, cwd: string, member: string): string[] {
  return ['-rvf', archivePath, '-C', cwd, member]
}

/**
 * `tar -xvf <archive> -C <destDir> --strip-components=<strip> <member>` — extract
 * a member's contents into `destDir`, stripping the member's own path segments so
 * the payload lands in a destination whose absolute path may differ from the
 * machine the backup was taken on.
 */
export function tarExtractArgs(
  archivePath: string,
  destDir: string,
  member: string,
  strip: number,
): string[] {
  return ['-xvf', archivePath, '-C', destDir, `--strip-components=${strip}`, member]
}

/** `tar -tf <archive>` — list member names only. */
export function tarListArgs(archivePath: string): string[] {
  return ['-tf', archivePath]
}

/** `tar -xOf <archive> <member>` — write a single member to stdout. */
export function tarReadFileArgs(archivePath: string, member: string): string[] {
  return ['-xOf', archivePath, member]
}

/** Count file entries (not directories) in `tar -tf` output. */
export function countFileEntries(listOutput: string): number {
  return listOutput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.endsWith('/')).length
}

/**
 * Normalise one line of `tar -v` output to the member path, or null for lines
 * that should not count toward progress. bsdtar prefixes create/extract lines
 * with `a `/`x `. GNU tar marks directory entries with a trailing slash
 * (dropped here); Windows bsdtar does NOT in -v mode, so on Windows this count
 * includes directories — treat it as progress-only, never as an authoritative
 * file count (`tar -tf` + countFileEntries is authoritative: -t mode marks
 * directories on both tars).
 */
export function normalizeVerboseLine(line: string): string | null {
  const stripped = line.replace(/^[ax] /, '').trim()
  if (stripped.length === 0 || stripped.endsWith('/')) return null
  return stripped
}
