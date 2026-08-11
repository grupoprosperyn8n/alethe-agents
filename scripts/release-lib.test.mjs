import { describe, it, expect } from 'vitest'
import { CRATE_RE, findCrateVersion, computeNextVersion, validateSources } from './release-lib.mjs'

describe('findCrateVersion', () => {
  it('matches the renamed crate block in Cargo.lock', () => {
    const lock =
      'name = "some-dep"\nversion = "9.9.9"\n\nname = "so-multi-agente"\nversion = "0.1.0"\ndependencies = [\n "base64 0.22.1",\n]\n'
    expect(findCrateVersion(lock)).toBe('0.1.0')
  })

  it('returns null when only the legacy alethe block exists', () => {
    const lock = 'name = "alethe"\nversion = "0.1.0"\n'
    expect(findCrateVersion(lock)).toBeNull()
  })

  it('returns null when the crate is missing entirely', () => {
    const lock = 'name = "other"\nversion = "1.0.0"\n'
    expect(findCrateVersion(lock)).toBeNull()
  })

  it('tolerates CRLF line endings', () => {
    const lock = 'name = "so-multi-agente"\r\nversion = "1.4.2"\r\n'
    expect(CRATE_RE.test(lock)).toBe(true)
    expect(findCrateVersion(lock)).toBe('1.4.2')
  })
})

describe('computeNextVersion', () => {
  it('bumps patch by default', () => {
    expect(computeNextVersion('1.2.0', 'patch')).toBe('1.2.1')
  })

  it('bumps minor and resets patch', () => {
    expect(computeNextVersion('1.2.9', 'minor')).toBe('1.3.0')
  })

  it('bumps major and resets minor/patch', () => {
    expect(computeNextVersion('1.2.9', 'major')).toBe('2.0.0')
  })

  it('accepts an explicit version', () => {
    expect(computeNextVersion('1.2.0', '1.5.0')).toBe('1.5.0')
  })

  it('throws on an invalid bump kind', () => {
    expect(() => computeNextVersion('1.2.0', 'banana')).toThrow(/patch|minor|major/)
  })

  it('throws on a malformed current version', () => {
    expect(() => computeNextVersion('not-a-version', 'patch')).toThrow(/Invalid current version/)
  })
})

describe('validateSources', () => {
  const sources = {
    pkg: '{\n  "name": "so-multi-agente",\n  "version": "0.1.0"\n}',
    tauri: '{\n  "productName": "SO Multi Agente",\n  "version": "0.1.0"\n}',
    cargo: '[package]\nname = "so-multi-agente"\nversion = "0.1.0"\n',
    lock: 'name = "so-multi-agente"\nversion = "0.1.0"\ndependencies = []\n',
  }

  it('accepts all four sources with the renamed crate', () => {
    expect(() => validateSources(sources)).not.toThrow()
  })

  it('throws with a Cargo.lock message when the crate block is missing', () => {
    expect(() => validateSources({ ...sources, lock: 'name = "alethe"\nversion = "0.1.0"\n' })).toThrow(
      /Cargo\.lock/,
    )
  })

  it('throws when package.json lacks a version', () => {
    expect(() => validateSources({ ...sources, pkg: '{\n  "name": "so-multi-agente"\n}' })).toThrow(
      /package\.json/,
    )
  })

  it('throws when tauri.conf.json lacks a version', () => {
    expect(() => validateSources({ ...sources, tauri: '{\n  "productName": "x"\n}' })).toThrow(
      /tauri\.conf\.json/,
    )
  })

  it('throws when Cargo.toml lacks a version', () => {
    expect(() => validateSources({ ...sources, cargo: '[package]\nname = "x"\n' })).toThrow(
      /Cargo\.toml/,
    )
  })
})
