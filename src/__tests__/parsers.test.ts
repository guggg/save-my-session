import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { parseClaudeSession, parseGeminiSession, parseCodexSession } from '../transfer/parsers.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe('parseClaudeSession', () => {
  it('extracts user and assistant text messages', async () => {
    const filePath = path.join(tmpDir, 'claude.jsonl');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 'test-123' }),
      JSON.stringify({
        type: 'user', isMeta: false,
        message: { role: 'user', content: 'Hello Claude' },
        timestamp: '2026-04-16T10:00:00Z', cwd: '/test', sessionId: 'test-123'
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
        timestamp: '2026-04-16T10:00:05Z', sessionId: 'test-123'
      })
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const session = await parseClaudeSession(filePath);

    expect(session.agent).toBe('claude');
    expect(session.id).toBe('test-123');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: 'user', text: 'Hello Claude', timestamp: '2026-04-16T10:00:00Z' });
    expect(session.messages[1]).toEqual({ role: 'assistant', text: 'Hi there!', timestamp: '2026-04-16T10:00:05Z' });
  });

  it('skips meta user messages', async () => {
    const filePath = path.join(tmpDir, 'claude-meta.jsonl');
    const lines = [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 's1' }),
      JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'system stuff' }, timestamp: '2026-04-16T10:00:00Z', sessionId: 's1' }),
      JSON.stringify({ type: 'user', isMeta: false, message: { role: 'user', content: 'real question' }, timestamp: '2026-04-16T10:00:01Z', sessionId: 's1' }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const session = await parseClaudeSession(filePath);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].text).toBe('real question');
  });

  it('skips tool_use blocks, keeps text only', async () => {
    const filePath = path.join(tmpDir, 'claude-tools.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm...' },
            { type: 'text', text: 'The answer is 42' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: {} }
          ]
        },
        timestamp: '2026-04-16T10:00:00Z', sessionId: 's1'
      })
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const session = await parseClaudeSession(filePath);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].text).toBe('The answer is 42');
  });
});

describe('parseGeminiSession', () => {
  it('extracts user and gemini messages', async () => {
    const filePath = path.join(tmpDir, 'gemini.json');
    const data = {
      sessionId: 'gem-123',
      startTime: '2026-04-16T10:00:00Z',
      lastUpdated: '2026-04-16T10:05:00Z',
      messages: [
        { id: 'm1', timestamp: '2026-04-16T10:00:00Z', type: 'user', content: [{ text: 'Hello Gemini' }] },
        { id: 'm2', timestamp: '2026-04-16T10:00:05Z', type: 'gemini', content: 'Hi from Gemini!', thoughts: [], tokens: {}, model: 'gemini-3-flash' }
      ]
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const session = await parseGeminiSession(filePath);

    expect(session.agent).toBe('gemini');
    expect(session.id).toBe('gem-123');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: 'user', text: 'Hello Gemini', timestamp: '2026-04-16T10:00:00Z' });
    expect(session.messages[1]).toEqual({ role: 'assistant', text: 'Hi from Gemini!', timestamp: '2026-04-16T10:00:05Z' });
    expect(session.model).toBe('gemini-3-flash');
  });

  it('skips info messages', async () => {
    const filePath = path.join(tmpDir, 'gemini-info.json');
    const data = {
      sessionId: 'gem-456',
      messages: [
        { id: 'm1', timestamp: '2026-04-16T10:00:00Z', type: 'user', content: [{ text: 'question' }] },
        { id: 'm2', timestamp: '2026-04-16T10:00:01Z', type: 'info', content: 'tool output' },
        { id: 'm3', timestamp: '2026-04-16T10:00:05Z', type: 'gemini', content: 'answer' }
      ]
    };
    await fs.writeFile(filePath, JSON.stringify(data));

    const session = await parseGeminiSession(filePath);
    expect(session.messages).toHaveLength(2);
  });
});

describe('parseCodexSession', () => {
  it('extracts user and assistant messages', async () => {
    const filePath = path.join(tmpDir, 'codex.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2026-04-10T01:00:00Z', type: 'session_meta', payload: { id: 'codex-123', cwd: '/test', timestamp: '2026-04-10T01:00:00Z' } }),
      JSON.stringify({ timestamp: '2026-04-10T01:00:01Z', type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5.3-codex' } }),
      JSON.stringify({ timestamp: '2026-04-10T01:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello Codex' }] } }),
      JSON.stringify({ timestamp: '2026-04-10T01:00:05Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi from Codex!' }] } }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const session = await parseCodexSession(filePath);

    expect(session.agent).toBe('codex');
    expect(session.id).toBe('codex-123');
    expect(session.cwd).toBe('/test');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: 'user', text: 'Hello Codex', timestamp: '2026-04-10T01:00:02Z' });
    expect(session.messages[1]).toEqual({ role: 'assistant', text: 'Hi from Codex!', timestamp: '2026-04-10T01:00:05Z' });
    expect(session.model).toBe('gpt-5.3-codex');
  });

  it('skips system/developer messages', async () => {
    const filePath = path.join(tmpDir, 'codex-sys.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2026-04-10T01:00:00Z', type: 'session_meta', payload: { id: 'c2', cwd: '/test' } }),
      JSON.stringify({ timestamp: '2026-04-10T01:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<permissions instructions>sandbox</permissions instructions>' }] } }),
      JSON.stringify({ timestamp: '2026-04-10T01:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'actual question' }] } }),
    ];
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const session = await parseCodexSession(filePath);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].text).toBe('actual question');
  });
});
