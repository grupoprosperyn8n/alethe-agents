// Pure release helpers for release.mjs — no side effects, unit-testable.
// Version sources: package.json · tauri.conf.json · Cargo.toml · Cargo.lock.

// Cargo.lock stores each package as a block; the app crate block is:
//   name = "so-multi-agente"
//   version = "x.y.z"
export const CRATE_RE = /name = "so-multi-agente"\r?\nversion = "(\d+\.\d+\.\d+)"/;

/**
 * Extract the app crate version from Cargo.lock content, or null when the
 * `so-multi-agente` block is absent (legacy `alethe` blocks no longer match).
 */
export function findCrateVersion(lockContent) {
  const m = lockContent.match(CRATE_RE);
  return m ? m[1] : null;
}

/**
 * Compute the next version from `current` ("x.y.z") and a bump kind
 * (patch | minor | major) or an explicit "x.y.z". Throws on invalid input.
 */
export function computeNextVersion(current, bump) {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid current version: "${current}"`);
  const [, major, minor, patch] = m.map(Number);
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Invalid bump: "${bump}". Use: patch | minor | major | X.Y.Z`);
}

/**
 * Pre-flight validation of all four version sources. Throws with an explicit
 * per-file message so release.mjs can abort BEFORE rewriting any file.
 */
export function validateSources({ pkg, tauri, cargo, lock }) {
  if (!pkg.match(/"version":\s*"(\d+\.\d+\.\d+)"/)) {
    throw new Error(`Version not found in package.json`);
  }
  if (!tauri.match(/"version":\s*"(\d+\.\d+\.\d+)"/)) {
    throw new Error(`Version not found in tauri.conf.json`);
  }
  if (!cargo.match(/version\s*=\s*"(\d+\.\d+\.\d+)"/)) {
    throw new Error(`Version not found in Cargo.toml`);
  }
  if (!lock || findCrateVersion(lock) === null) {
    throw new Error(`Crate "so-multi-agente" not found in Cargo.lock`);
  }
}
