import fs from 'fs/promises';
import path from 'path';
import { UnifiedSession, UnifiedMessage, AgentType } from './types.js';

// ─── Claude ────────────────────────────────────────────────────

export async function parseClaudeSession(filePath: string): Promise<UnifiedSession> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').map(l => JSON.parse(l));

  const messages: UnifiedMessage[] = [];
  let sessionId = '';
  let cwd = '';
  let model = '';
  let startTime = '';
  let lastUpdated = '';

  for (const line of lines) {
    if (!sessionId && line.sessionId) sessionId = line.sessionId;
    if (!cwd && line.cwd) cwd = line.cwd;

    if (line.type === 'user' && !line.isMeta) {
      const text = extractClaudeText(line.message?.content);
      if (text) {
        messages.push({
          role: 'user',
          text,
          timestamp: line.timestamp || ''
        });
        if (!startTime) startTime = line.timestamp || '';
        lastUpdated = line.timestamp || '';
      }
    }

    if (line.type === 'assistant') {
      const text = extractClaudeAssistantText(line.message?.content);
      if (text) {
        if (line.model) model = line.model;
        messages.push({
          role: 'assistant',
          text,
          timestamp: line.timestamp || ''
        });
        lastUpdated = line.timestamp || '';
      }
    }
  }

  return {
    id: sessionId || path.basename(filePath, '.jsonl'),
    agent: 'claude',
    cwd,
    messages,
    startTime,
    lastUpdated,
    model
  };
}

function extractClaudeText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

function extractClaudeAssistantText(content: any): string {
  if (!Array.isArray(content)) return '';

  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

// ─── Gemini ────────────────────────────────────────────────────

export async function parseGeminiSession(filePath: string): Promise<UnifiedSession> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  const messages: UnifiedMessage[] = [];
  let startTime = '';
  let lastUpdated = '';

  for (const msg of data.messages || []) {
    const timestamp = msg.timestamp || '';
    if (!startTime) startTime = timestamp;
    lastUpdated = timestamp;

    if (msg.type === 'user') {
      const text = extractGeminiUserText(msg.content);
      if (text) {
        messages.push({ role: 'user', text, timestamp });
      }
    }

    if (msg.type === 'gemini') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) {
        messages.push({ role: 'assistant', text, timestamp });
      }
    }
  }

  return {
    id: data.sessionId || path.basename(filePath, '.json'),
    agent: 'gemini',
    cwd: data.cwd || '',
    messages,
    startTime: data.startTime || startTime,
    lastUpdated: data.lastUpdated || lastUpdated,
    model: extractGeminiModel(data)
  };
}

function extractGeminiUserText(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block: any) => typeof block === 'object' && block.text)
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

function extractGeminiModel(data: any): string {
  for (const msg of data.messages || []) {
    if (msg.model) return msg.model;
  }
  return '';
}

// ─── Codex ─────────────────────────────────────────────────────

export async function parseCodexSession(filePath: string): Promise<UnifiedSession> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').map(l => JSON.parse(l));

  const messages: UnifiedMessage[] = [];
  let sessionId = '';
  let cwd = '';
  let model = '';
  let startTime = '';
  let lastUpdated = '';

  for (const line of lines) {
    if (line.type === 'session_meta') {
      sessionId = line.payload?.id || '';
      cwd = line.payload?.cwd || '';
      startTime = line.payload?.timestamp || '';
    }

    if (line.type === 'turn_context') {
      if (line.payload?.model) model = line.payload.model;
    }

    if (line.type === 'response_item') {
      const role = line.payload?.role;
      const contentBlocks = line.payload?.content || [];

      if (role === 'user') {
        const text = extractCodexText(contentBlocks, 'input_text');
        // Skip system/developer messages
        if (text && !isCodexSystemMessage(contentBlocks)) {
          messages.push({
            role: 'user',
            text,
            timestamp: line.timestamp || ''
          });
          lastUpdated = line.timestamp || '';
        }
      }

      if (role === 'assistant') {
        const text = extractCodexText(contentBlocks, 'output_text');
        if (text) {
          messages.push({
            role: 'assistant',
            text,
            timestamp: line.timestamp || ''
          });
          lastUpdated = line.timestamp || '';
        }
      }
    }
  }

  return {
    id: sessionId || path.basename(filePath, '.jsonl'),
    agent: 'codex',
    cwd,
    messages,
    startTime,
    lastUpdated,
    model
  };
}

function extractCodexText(content: any[], textType: string): string {
  return content
    .filter((block: any) => block.type === textType)
    .map((block: any) => block.text)
    .join('\n')
    .trim();
}

function isCodexSystemMessage(content: any[]): boolean {
  return content.some((block: any) =>
    block.type === 'input_text' && (
      block.text?.startsWith('<permissions') ||
      block.text?.startsWith('<app-context') ||
      block.text?.startsWith('<collaboration_mode') ||
      block.text?.startsWith('<skills_instructions') ||
      block.text?.startsWith('<environment_context')
    )
  );
}

// ─── Router ────────────────────────────────────────────────────

export async function parseSession(filePath: string, agent: AgentType): Promise<UnifiedSession> {
  switch (agent) {
    case 'claude': return parseClaudeSession(filePath);
    case 'gemini': return parseGeminiSession(filePath);
    case 'codex': return parseCodexSession(filePath);
  }
}
