import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { UnifiedSession } from '../transfer/types.js';
import { TRANSFER_MARKER } from '../transfer/writers.js';
import { parseClaudeSession, parseGeminiSession, parseCodexSession } from '../transfer/parsers.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-writer-'));
  // Set env vars so writers use tmp dirs
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

const mockSession: UnifiedSession = {
  id: 'test-session',
  agent: 'claude',
  cwd: '/Users/test/project',
  startTime: '2026-04-16T10:00:00Z',
  lastUpdated: '2026-04-16T10:05:00Z',
  model: 'test-model',
  messages: [
    { role: 'user', text: 'Hello', timestamp: '2026-04-16T10:00:00Z' },
    { role: 'assistant', text: 'Hi there!', timestamp: '2026-04-16T10:00:05Z' },
    { role: 'user', text: 'Do something', timestamp: '2026-04-16T10:01:00Z' },
    { role: 'assistant', text: 'Done!', timestamp: '2026-04-16T10:01:05Z' },
  ]
};

describe('writeClaudeSession', () => {
  it('writes valid Claude JSONL with transfer marker', async () => {
    const { writeClaudeSession } = await import('../transfer/writers.js');
    const filePath = await writeClaudeSession(mockSession, '/Users/test/project');

    expect(filePath).toContain('.jsonl');

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    // First line: transfer marker
    expect(lines[0].type).toBe(TRANSFER_MARKER);
    expect(lines[0].source_agent).toBe('claude');

    // Second line: permission mode
    expect(lines[1].type).toBe('permission-mode');

    // Messages — first assistant line is the handoff notice
    const userLines = lines.filter(l => l.type === 'user');
    const assistantLines = lines.filter(l => l.type === 'assistant');
    expect(userLines).toHaveLength(2);
    expect(assistantLines).toHaveLength(3); // 1 notice + 2 real
    expect(assistantLines[0].message.content[0].text).toContain('transferred from');
    expect(userLines[0].message.content).toBe('Hello');
    expect(assistantLines[1].message.content[0].text).toBe('Hi there!');
  });

  it('roundtrips correctly through parse', async () => {
    const { writeClaudeSession } = await import('../transfer/writers.js');
    const filePath = await writeClaudeSession(mockSession, '/Users/test/project');
    const parsed = await parseClaudeSession(filePath);

    // +1 for handoff notice
    expect(parsed.messages).toHaveLength(5);
    expect(parsed.messages[0].text).toContain('transferred from');
    expect(parsed.messages[1].text).toBe('Hello');
    expect(parsed.messages[2].text).toBe('Hi there!');
    expect(parsed.messages[3].text).toBe('Do something');
    expect(parsed.messages[4].text).toBe('Done!');
  });
});

describe('writeGeminiSession', () => {
  it('writes valid Gemini JSONL with transfer marker on metadata line', async () => {
    // Create projects.json
    const geminiHome = path.join(tmpDir, '.gemini');
    await fs.mkdir(geminiHome, { recursive: true });
    await fs.writeFile(path.join(geminiHome, 'projects.json'), JSON.stringify({ projects: {} }));

    const { writeGeminiSession } = await import('../transfer/writers.js');
    const filePath = await writeGeminiSession(mockSession, '/Users/test/project');

    expect(filePath).toContain('.jsonl');

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    // Line 0: metadata with transfer marker
    const meta = lines[0];
    expect(meta[TRANSFER_MARKER]).toBeDefined();
    expect(meta[TRANSFER_MARKER].source_agent).toBe('claude');

    // Following lines: notice + messages
    const msgs = lines.slice(1);
    expect(msgs).toHaveLength(5); // 1 notice + 4 real
    expect(msgs[0].type).toBe('gemini');
    expect(msgs[0].content).toContain('transferred from');
    expect(msgs[1].type).toBe('user');
    expect(msgs[1].content[0].text).toBe('Hello');
    expect(msgs[2].type).toBe('gemini');
    expect(msgs[2].content).toBe('Hi there!');
  });

  it('roundtrips correctly through parse', async () => {
    const { writeGeminiSession } = await import('../transfer/writers.js');
    const filePath = await writeGeminiSession(mockSession, '/Users/test/project');
    const parsed = await parseGeminiSession(filePath);

    expect(parsed.messages).toHaveLength(5); // 1 notice + 4 real
    expect(parsed.messages[0].text).toContain('transferred from');
    expect(parsed.messages[1].text).toBe('Hello');
    expect(parsed.messages[4].text).toBe('Done!');
  });
});

describe('writeCodexSession', () => {
  it('writes valid Codex JSONL with transfer marker', async () => {
    const codexHome = path.join(tmpDir, '.codex');
    await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });

    const { writeCodexSession } = await import('../transfer/writers.js');
    const filePath = await writeCodexSession(mockSession, '/Users/test/project');

    expect(filePath).toContain('.jsonl');

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));

    // First line: session_meta (Codex /resume requires this as line 1)
    expect(lines[0].type).toBe('session_meta');
    expect(lines[0].payload.cwd).toBe('/Users/test/project');

    // Transfer marker is embedded inside the payload
    expect(lines[0].payload[TRANSFER_MARKER]).toBeDefined();
    expect(lines[0].payload[TRANSFER_MARKER].source_agent).toBe('claude');

    // Check user/assistant messages — first assistant is handoff notice
    const userItems = lines.filter(l => l.type === 'response_item' && l.payload?.role === 'user');
    const assistantItems = lines.filter(l => l.type === 'response_item' && l.payload?.role === 'assistant');
    expect(userItems).toHaveLength(2);
    expect(assistantItems).toHaveLength(3); // 1 notice + 2 real
    expect(assistantItems[0].payload.content[0].text).toContain('transferred from');
  });

  it('roundtrips correctly through parse', async () => {
    const { writeCodexSession } = await import('../transfer/writers.js');
    const filePath = await writeCodexSession(mockSession, '/Users/test/project');
    const parsed = await parseCodexSession(filePath);

    expect(parsed.messages).toHaveLength(5); // 1 notice + 4 real
    expect(parsed.messages[0].text).toContain('transferred from');
    expect(parsed.messages[1].text).toBe('Hello');
    expect(parsed.messages[4].text).toBe('Done!');
  });
});
