import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { UnifiedSession } from '../transfer/types.js';
import { appendToSession } from '../transfer/writers.js';
import { parseClaudeSession, parseGeminiSession, parseCodexSession } from '../transfer/parsers.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-append-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

function makeSourceSession(startHour: number): UnifiedSession {
  return {
    id: 'source',
    agent: 'gemini',
    cwd: '/test',
    startTime: `2026-04-16T${startHour}:00:00Z`,
    lastUpdated: `2026-04-16T${startHour + 1}:00:00Z`,
    model: 'gemini-3',
    messages: [
      { role: 'user', text: 'old question', timestamp: `2026-04-16T${startHour}:00:00Z` },
      { role: 'assistant', text: 'old answer', timestamp: `2026-04-16T${startHour}:00:05Z` },
      { role: 'user', text: 'new question', timestamp: `2026-04-16T${startHour + 1}:00:00Z` },
      { role: 'assistant', text: 'new answer', timestamp: `2026-04-16T${startHour + 1}:00:05Z` },
    ]
  };
}

describe('appendToSession - Claude', () => {
  it('appends only messages newer than target', async () => {
    // Create a Claude session that ends at 11:00
    const filePath = path.join(tmpDir, 'claude-append.jsonl');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'target-1' }),
      JSON.stringify({
        type: 'user', isMeta: false,
        message: { role: 'user', content: 'first question' },
        timestamp: '2026-04-16T10:00:00Z', sessionId: 'target-1'
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
        timestamp: '2026-04-16T11:00:00Z', sessionId: 'target-1'
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    // Source session: messages at 10:00, 10:05, 11:00, 11:05
    const source = makeSourceSession(10);

    const { appended } = await appendToSession(source, filePath, 'claude');

    // Only 11:00:05 should be appended (11:00:00 is not > 11:00:00)
    expect(appended).toBe(1);

    const parsed = await parseClaudeSession(filePath);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[2].text).toBe('new answer');
  });

  it('returns 0 when source is older', async () => {
    const filePath = path.join(tmpDir, 'claude-noappend.jsonl');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'target-2' }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'late answer' }] },
        timestamp: '2026-04-16T23:00:00Z', sessionId: 'target-2'
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const source = makeSourceSession(10);
    const { appended } = await appendToSession(source, filePath, 'claude');
    expect(appended).toBe(0);
  });
});

describe('appendToSession - Gemini', () => {
  it('appends only newer messages to Gemini JSON', async () => {
    const filePath = path.join(tmpDir, 'gemini-append.json');
    const data = {
      sessionId: 'gem-target',
      startTime: '2026-04-16T10:00:00Z',
      lastUpdated: '2026-04-16T11:00:00Z',
      messages: [
        { id: 'm1', timestamp: '2026-04-16T10:00:00Z', type: 'user', content: [{ text: 'first' }] },
        { id: 'm2', timestamp: '2026-04-16T11:00:00Z', type: 'gemini', content: 'first answer' },
      ]
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const source = makeSourceSession(10);
    const { appended } = await appendToSession(source, filePath, 'gemini');

    expect(appended).toBe(1);

    const parsed = await parseGeminiSession(filePath);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[2].text).toBe('new answer');
  });
});

describe('appendToSession - Codex', () => {
  it('appends only newer messages to Codex JSONL', async () => {
    const filePath = path.join(tmpDir, 'codex-append.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2026-04-16T10:00:00Z', type: 'session_meta', payload: { id: 'cx-1', cwd: '/test' } }),
      JSON.stringify({ timestamp: '2026-04-16T10:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first' }] } }),
      JSON.stringify({ timestamp: '2026-04-16T11:00:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first answer' }] } }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const source = makeSourceSession(10);
    const { appended } = await appendToSession(source, filePath, 'codex');

    expect(appended).toBe(1);

    const parsed = await parseCodexSession(filePath);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[2].text).toBe('new answer');
  });
});
