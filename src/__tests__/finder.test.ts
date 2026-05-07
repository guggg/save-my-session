import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TRANSFER_MARKER } from '../transfer/writers.js';
import { findLatestSession, findAllSessions } from '../transfer/finder.js';
import { claudeProjectSlug } from '../transfer/types.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-finder-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, '.claude');
  process.env.GEMINI_CLI_HOME = path.join(tmpDir, '.gemini');
  process.env.CODEX_HOME = path.join(tmpDir, '.codex');
});

afterAll(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.GEMINI_CLI_HOME;
  delete process.env.CODEX_HOME;
  await fs.rm(tmpDir, { recursive: true });
});

describe('Claude finder', () => {
  const projectCwd = '/Users/test/myproject';

  beforeAll(async () => {
    const slug = claudeProjectSlug(projectCwd);
    const projectDir = path.join(tmpDir, '.claude', 'projects', slug);
    await fs.mkdir(projectDir, { recursive: true });

    // Native session (older)
    const native = [
      JSON.stringify({ type: 'permission-mode', sessionId: 'native-1' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'hi' }, timestamp: '2026-04-16T10:00:00Z', sessionId: 'native-1' }),
    ];
    await fs.writeFile(path.join(projectDir, 'native-1.jsonl'), native.join('\n') + '\n');

    // Wait to ensure different mtime
    await new Promise(r => setTimeout(r, 50));

    // Transferred but untouched — every message older than transferred_at.
    const transferredAt = '2026-04-18T00:00:00Z';
    const untouched = [
      JSON.stringify({ type: TRANSFER_MARKER, source_agent: 'gemini', transferred_at: transferredAt }),
      JSON.stringify({ type: 'permission-mode', sessionId: 'transferred-untouched' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'from gemini' }, timestamp: '2026-04-17T10:00:00Z', sessionId: 'transferred-untouched' }),
    ];
    await fs.writeFile(path.join(projectDir, 'transferred-untouched.jsonl'), untouched.join('\n') + '\n');

    await new Promise(r => setTimeout(r, 50));

    // Transferred and continued — has a message newer than transferred_at,
    // so user clearly kept chatting after /resume.
    const continued = [
      JSON.stringify({ type: TRANSFER_MARKER, source_agent: 'gemini', transferred_at: transferredAt }),
      JSON.stringify({ type: 'permission-mode', sessionId: 'transferred-continued' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'from gemini' }, timestamp: '2026-04-17T10:00:00Z', sessionId: 'transferred-continued' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'new chat after resume' }, timestamp: '2026-04-19T10:00:00Z', sessionId: 'transferred-continued' }),
    ];
    await fs.writeFile(path.join(projectDir, 'transferred-continued.jsonl'), continued.join('\n') + '\n');
  });

  it('skips untouched transferred sessions, keeps continued ones', async () => {
    const all = await findAllSessions(projectCwd, 'claude');
    const names = all.map(s => path.basename(s.filePath)).sort();
    expect(names).toEqual(['native-1.jsonl', 'transferred-continued.jsonl']);
  });

  it('latest picks the most-recently-modified kept session', async () => {
    const found = await findLatestSession(projectCwd, 'claude');
    expect(found).not.toBeNull();
    // transferred-continued was written last, so it has the newest mtime.
    expect(found!.filePath).toContain('transferred-continued.jsonl');
  });

  it('returns null for nonexistent project', async () => {
    const found = await findLatestSession('/no/such/project', 'claude');
    expect(found).toBeNull();
  });

  it('finds sessions for paths with non-alphanumeric chars (e.g. &)', async () => {
    const specialCwd = '/Users/test/ETL&GIS/sub';
    const slug = claudeProjectSlug(specialCwd);
    expect(slug).toBe('-Users-test-ETL-GIS-sub');

    const projectDir = path.join(tmpDir, '.claude', 'projects', slug);
    await fs.mkdir(projectDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'permission-mode', sessionId: 'special-1' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'hi' }, timestamp: '2026-04-16T10:00:00Z', sessionId: 'special-1' }),
    ];
    await fs.writeFile(path.join(projectDir, 'special-1.jsonl'), lines.join('\n') + '\n');

    const found = await findLatestSession(specialCwd, 'claude');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('special-1.jsonl');
  });
});

describe('Gemini finder', () => {
  const projectCwd = '/Users/test/gemproject';

  beforeAll(async () => {
    const geminiHome = path.join(tmpDir, '.gemini');
    await fs.mkdir(geminiHome, { recursive: true });
    await fs.writeFile(
      path.join(geminiHome, 'projects.json'),
      JSON.stringify({ projects: { [projectCwd]: 'gemproject' } })
    );

    const chatsDir = path.join(geminiHome, 'tmp', 'gemproject', 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Native session
    await fs.writeFile(
      path.join(chatsDir, 'session-native.json'),
      JSON.stringify({ sessionId: 'g1', messages: [{ id: 'm1', type: 'user', content: [{ text: 'hi' }], timestamp: '2026-04-16T10:00:00Z' }] })
    );

    await new Promise(r => setTimeout(r, 50));

    // Transferred session, untouched (lastUpdated == transferred_at)
    await fs.writeFile(
      path.join(chatsDir, 'session-transferred.json'),
      JSON.stringify({
        sessionId: 'g2',
        lastUpdated: '2026-04-16T11:00:00Z',
        [TRANSFER_MARKER]: { source_agent: 'claude', transferred_at: '2026-04-16T11:00:00Z' },
        messages: []
      })
    );

    await new Promise(r => setTimeout(r, 50));

    // Transferred session that the user continued chatting in
    // (lastUpdated > transferred_at) — should be treated as a real session
    await fs.writeFile(
      path.join(chatsDir, 'session-continued.json'),
      JSON.stringify({
        sessionId: 'g3',
        lastUpdated: '2026-04-16T13:00:00Z',
        [TRANSFER_MARKER]: { source_agent: 'claude', transferred_at: '2026-04-16T11:00:00Z' },
        messages: [
          { id: 'x', timestamp: '2026-04-16T13:00:00Z', type: 'user', content: [{ text: 'continued' }] }
        ]
      })
    );
  });

  it('skips untouched transferred sessions but keeps continued ones', async () => {
    const all = await findAllSessions(projectCwd, 'gemini');
    const names = all.map(s => path.basename(s.filePath)).sort();
    expect(names).toEqual(['session-continued.json', 'session-native.json']);
  });

  it('latest picks the most recent non-untouched session', async () => {
    const found = await findLatestSession(projectCwd, 'gemini');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('session-continued.json');
  });
});

describe('Codex finder', () => {
  const projectCwd = '/Users/test/codexproject';

  beforeAll(async () => {
    const dayDir = path.join(tmpDir, '.codex', 'sessions', '2026', '04', '16');
    await fs.mkdir(dayDir, { recursive: true });

    // Native session
    const native = [
      JSON.stringify({ timestamp: '2026-04-16T10:00:00Z', type: 'session_meta', payload: { id: 'cx1', cwd: projectCwd } }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-native.jsonl'), native.join('\n') + '\n');

    await new Promise(r => setTimeout(r, 50));

    // Transferred session — marker embedded in session_meta payload
    const transferred = [
      JSON.stringify({
        timestamp: '2026-04-16T11:00:00Z',
        type: 'session_meta',
        payload: {
          id: 'cx2',
          cwd: projectCwd,
          [TRANSFER_MARKER]: { source_agent: 'claude', transferred_at: '2026-04-16T11:00:00Z' }
        }
      }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-transferred.jsonl'), transferred.join('\n') + '\n');

    // Legacy transferred session — standalone marker line 1, session_meta line 2.
    // Codex /resume cannot load this layout, so finder should skip it.
    const legacyTransferred = [
      JSON.stringify({ type: TRANSFER_MARKER, source_agent: 'claude' }),
      JSON.stringify({ timestamp: '2026-04-16T11:30:00Z', type: 'session_meta', payload: { id: 'cx-legacy', cwd: projectCwd } }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-legacy-transferred.jsonl'), legacyTransferred.join('\n') + '\n');

    // Session for different project
    const other = [
      JSON.stringify({ timestamp: '2026-04-16T12:00:00Z', type: 'session_meta', payload: { id: 'cx3', cwd: '/other/project' } }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-other.jsonl'), other.join('\n') + '\n');
  });

  it('includes embedded-marker transfers, skips legacy-marker files, filters wrong projects', async () => {
    // The newest non-legacy file (embedded marker) should come first
    const found = await findLatestSession(projectCwd, 'codex');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('rollout-transferred.jsonl');
  });

  it('findAllSessions keeps native + embedded-marker transfers, skips legacy-marker', async () => {
    const all = await findAllSessions(projectCwd, 'codex');
    const names = all.map(s => path.basename(s.filePath)).sort();
    expect(names).toEqual(['rollout-native.jsonl', 'rollout-transferred.jsonl']);
  });
});
