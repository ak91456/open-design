import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseByteRange, resolveProjectFilePath } from '../src/projects.js';

// ---------------------------------------------------------------------------
// parseByteRange — RFC 7233 unit tests
// ---------------------------------------------------------------------------

describe('parseByteRange', () => {
  it('returns null when header is undefined', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
  });

  it('returns null when header is an empty string', () => {
    expect(parseByteRange('', 1000)).toBeNull();
  });

  it('returns null for non-bytes unit', () => {
    expect(parseByteRange('none=0-100', 1000)).toBeNull();
  });

  it('returns null for multi-range (caller falls back to full 200)', () => {
    expect(parseByteRange('bytes=0-100, 200-300', 1000)).toBeNull();
  });

  it('parses a standard start-end range', () => {
    expect(parseByteRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('clamps an over-long end to fileSize - 1', () => {
    expect(parseByteRange('bytes=0-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('parses an open-ended range (bytes=N-)', () => {
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range (bytes=-N)', () => {
    expect(parseByteRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });

  it('clamps suffix larger than fileSize to the whole file', () => {
    expect(parseByteRange('bytes=-9999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('returns unsatisfiable when start equals fileSize', () => {
    expect(parseByteRange('bytes=1000-1999', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable when start exceeds fileSize', () => {
    expect(parseByteRange('bytes=5000-5999', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable for a zero-length suffix range (bytes=-0)', () => {
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });

  it('returns unsatisfiable for a negative suffix', () => {
    expect(parseByteRange('bytes=--1', 1000)).toBe('unsatisfiable');
  });

  it('returns null for non-integer start', () => {
    expect(parseByteRange('bytes=1.5-499', 1000)).toBeNull();
  });

  it('returns null for non-integer end', () => {
    expect(parseByteRange('bytes=0-499.9', 1000)).toBeNull();
  });

  it('returns null when end < start', () => {
    expect(parseByteRange('bytes=500-100', 1000)).toBeNull();
  });

  it('returns null for alphabetic range values', () => {
    expect(parseByteRange('bytes=abc-xyz', 1000)).toBeNull();
  });

  it('handles a single-byte range (bytes=0-0)', () => {
    expect(parseByteRange('bytes=0-0', 1000)).toEqual({ start: 0, end: 0 });
  });

  it('handles a range that exactly covers the last byte', () => {
    expect(parseByteRange('bytes=999-999', 1000)).toEqual({ start: 999, end: 999 });
  });
});

// ---------------------------------------------------------------------------
// resolveProjectFilePath — integration test (real temp files)
// ---------------------------------------------------------------------------

describe('resolveProjectFilePath', () => {
  let projectsRoot = '';
  const projectId = 'proj-range-test';

  beforeEach(async () => {
    projectsRoot = mkdtempSync(path.join(tmpdir(), 'od-range-'));
    const dir = path.join(projectsRoot, projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'clip.mp4'), Buffer.alloc(2048));
    await writeFile(path.join(dir, 'index.html'), '<html/>');
  });

  afterEach(() => {
    if (projectsRoot) rmSync(projectsRoot, { recursive: true, force: true });
  });

  it('returns the correct size and mime for a video file', async () => {
    const result = await resolveProjectFilePath(projectsRoot, projectId, 'clip.mp4');
    expect(result.size).toBe(2048);
    expect(result.mime).toBe('video/mp4');
    expect(result.kind).toBe('video');
    expect(path.isAbsolute(result.filePath)).toBe(true);
  });

  it('returns the correct mime for an html file', async () => {
    const result = await resolveProjectFilePath(projectsRoot, projectId, 'index.html');
    expect(result.mime).toBe('text/html; charset=utf-8');
  });

  it('throws ENOENT for a missing file', async () => {
    await expect(
      resolveProjectFilePath(projectsRoot, projectId, 'missing.mp4'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path traversal attempts', async () => {
    await expect(
      resolveProjectFilePath(projectsRoot, projectId, '../other-project/secret.mp4'),
    ).rejects.toThrow();
  });
});
