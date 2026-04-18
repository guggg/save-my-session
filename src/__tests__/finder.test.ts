import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TRANSFER_MARKER } from '../transfer/writers.js';
import { findLatestSession, findAllSessions } from '../transfer/finder.js';

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
    const slug = projectCwd.replace(/\//g, '-');
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

    // Transferred session (newer mtime)
    const transferred = [
      JSON.stringify({ type: TRANSFER_MARKER, source_agent: 'gemini' }),
      JSON.stringify({ type: 'permission-mode', sessionId: 'transferred-1' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'from gemini' }, timestamp: '2026-04-17T10:00:00Z', sessionId: 'transferred-1' }),
    ];
    await fs.writeFile(path.join(projectDir, 'transferred-1.jsonl'), transferred.join('\n') + '\n');
  });

  it('skips transferred sessions', async () => {
    const found = await findLatestSession(projectCwd, 'claude');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('native-1.jsonl');
  });

  it('findAllSessions excludes transferred', async () => {
    const all = await findAllSessions(projectCwd, 'claude');
    expect(all).toHaveLength(1);
    expect(all[0].filePath).toContain('native-1.jsonl');
  });

  it('returns null for nonexistent project', async () => {
    const found = await findLatestSession('/no/such/project', 'claude');
    expect(found).toBeNull();
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

    // Transferred session (newer)
    await fs.writeFile(
      path.join(chatsDir, 'session-transferred.json'),
      JSON.stringify({ sessionId: 'g2', [TRANSFER_MARKER]: { source_agent: 'claude' }, messages: [] })
    );
  });

  it('skips transferred sessions', async () => {
    const found = await findLatestSession(projectCwd, 'gemini');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('session-native.json');
  });

  it('findAllSessions excludes transferred', async () => {
    const all = await findAllSessions(projectCwd, 'gemini');
    expect(all).toHaveLength(1);
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

    // Transferred session
    const transferred = [
      JSON.stringify({ type: TRANSFER_MARKER, source_agent: 'claude' }),
      JSON.stringify({ timestamp: '2026-04-16T11:00:00Z', type: 'session_meta', payload: { id: 'cx2', cwd: projectCwd } }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-transferred.jsonl'), transferred.join('\n') + '\n');

    // Session for different project
    const other = [
      JSON.stringify({ timestamp: '2026-04-16T12:00:00Z', type: 'session_meta', payload: { id: 'cx3', cwd: '/other/project' } }),
    ];
    await fs.writeFile(path.join(dayDir, 'rollout-other.jsonl'), other.join('\n') + '\n');
  });

  it('skips transferred sessions and wrong projects', async () => {
    const found = await findLatestSession(projectCwd, 'codex');
    expect(found).not.toBeNull();
    expect(found!.filePath).toContain('rollout-native.jsonl');
  });

  it('findAllSessions filters correctly', async () => {
    const all = await findAllSessions(projectCwd, 'codex');
    expect(all).toHaveLength(1);
    expect(all[0].filePath).toContain('rollout-native.jsonl');
  });
});
