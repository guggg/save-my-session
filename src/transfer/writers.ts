import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { UnifiedSession, AgentType, claudeProjectSlug } from './types.js';

export const TRANSFER_MARKER = '_transferred_by_save_my_session';

// ─── Claude Writer ─────────────────────────────────────────────

export async function writeClaudeSession(session: UnifiedSession, projectCwd: string): Promise<string> {
  const homeDir = os.homedir();
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

  const projectSlug = claudeProjectSlug(projectCwd);
  const projectDir = path.join(configDir, 'projects', projectSlug);
  await fs.mkdir(projectDir, { recursive: true });

  const sessionId = crypto.randomUUID();
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);

  const lines: string[] = [];

  // Transfer marker (so finder skips this file)
  lines.push(JSON.stringify({
    type: TRANSFER_MARKER,
    source_agent: session.agent,
    transferred_at: new Date().toISOString()
  }));

  // Permission mode line
  lines.push(JSON.stringify({
    type: 'permission-mode',
    permissionMode: 'default',
    sessionId
  }));

  // Convert messages
  let prevUuid: string | null = null;
  for (const msg of session.messages) {
    const uuid = crypto.randomUUID();
    if (msg.role === 'user') {
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: msg.text },
        uuid,
        timestamp: msg.timestamp,
        userType: 'external',
        cwd: projectCwd,
        sessionId
      }));
    } else if (msg.role === 'assistant') {
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: msg.text }] },
        uuid,
        timestamp: msg.timestamp,
        sessionId
      }));
    }
    prevUuid = uuid;
  }

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

// ─── Gemini Writer ─────────────────────────────────────────────

export async function writeGeminiSession(session: UnifiedSession, projectCwd: string): Promise<string> {
  const homeDir = os.homedir();
  const geminiHome = process.env.GEMINI_CLI_HOME || path.join(homeDir, '.gemini');

  // Get or create project slug from projects.json
  const slug = await getOrCreateGeminiSlug(geminiHome, projectCwd);
  const chatsDir = path.join(geminiHome, 'tmp', slug, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  const sessionId = crypto.randomUUID().split('-')[4]; // short uuid
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `session-${timestamp}-${sessionId}.json`;
  const filePath = path.join(chatsDir, fileName);

  const messages: any[] = [];

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      messages.push({
        id: crypto.randomUUID(),
        timestamp: msg.timestamp,
        type: 'user',
        content: [{ text: msg.text }]
      });
    }

    if (msg.role === 'assistant') {
      messages.push({
        id: crypto.randomUUID(),
        timestamp: msg.timestamp,
        type: 'gemini',
        content: msg.text,
        thoughts: [],
        tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0, total: 0 },
        model: session.model || 'unknown'
      });
    }
  }

  const geminiSession = {
    sessionId: crypto.randomUUID(),
    startTime: session.startTime,
    lastUpdated: session.lastUpdated,
    [TRANSFER_MARKER]: { source_agent: session.agent, transferred_at: new Date().toISOString() },
    messages
  };

  await fs.writeFile(filePath, JSON.stringify(geminiSession, null, 2), 'utf-8');
  return filePath;
}

async function getOrCreateGeminiSlug(geminiHome: string, projectCwd: string): Promise<string> {
  const projectsPath = path.join(geminiHome, 'projects.json');

  let projects: { projects: Record<string, string> } = { projects: {} };
  try {
    const content = await fs.readFile(projectsPath, 'utf-8');
    projects = JSON.parse(content);
    if (!projects.projects) projects.projects = {};
  } catch {
    // File doesn't exist
  }

  if (projects.projects[projectCwd]) {
    return projects.projects[projectCwd];
  }

  const base = path.basename(projectCwd).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const existing = new Set(Object.values(projects.projects));
  let slug = base;
  let suffix = 1;
  while (existing.has(slug)) {
    slug = `${base}-${suffix++}`;
  }

  projects.projects[projectCwd] = slug;
  await fs.writeFile(projectsPath, JSON.stringify(projects, null, 4), 'utf-8');

  return slug;
}

// ─── Codex Writer ──────────────────────────────────────────────

export async function writeCodexSession(session: UnifiedSession, projectCwd: string): Promise<string> {
  const homeDir = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');

  // Codex organizes by date: sessions/YYYY/MM/DD/
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const sessionDir = path.join(codexHome, 'sessions', year, month, day);
  await fs.mkdir(sessionDir, { recursive: true });

  const sessionId = crypto.randomUUID();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `rollout-${timestamp}-${sessionId}.jsonl`;
  const filePath = path.join(sessionDir, fileName);

  const lines: string[] = [];

  // Transfer marker
  lines.push(JSON.stringify({
    type: TRANSFER_MARKER,
    source_agent: session.agent,
    transferred_at: now.toISOString()
  }));

  // Session meta
  lines.push(JSON.stringify({
    timestamp: now.toISOString(),
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: session.startTime,
      cwd: projectCwd,
      originator: 'save-my-session',
      source: 'cli'
    }
  }));

  // Convert messages
  let turnId = crypto.randomUUID();

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      turnId = crypto.randomUUID();

      // Turn context
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'turn_context',
        payload: {
          turn_id: turnId,
          cwd: projectCwd,
          current_date: msg.timestamp.slice(0, 10),
          model: session.model || 'unknown'
        }
      }));

      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: msg.text }]
        }
      }));
    }

    if (msg.role === 'assistant') {
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.text }]
        }
      }));
    }
  }

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

// ─── Append ────────────────────────────────────────────────────

export async function appendToSession(
  sourceSession: UnifiedSession,
  targetFilePath: string,
  targetAgent: AgentType,
  force = false
): Promise<{ appended: number }> {
  const { parseSession } = await import('./parsers.js');
  const existing = await parseSession(targetFilePath, targetAgent);

  // Dedup by content (role + text) instead of timestamp. Timestamps get
  // rewritten on every transfer, so a message can ping-pong between agents
  // and end up with a different timestamp than when it was first authored —
  // a timestamp-only filter then fails in both directions (missing appends
  // when the target looks newer, duplicate appends when it looks older).
  const existingSignatures = new Set(
    existing.messages.map(m => `${m.role}\u0000${m.text.trim()}`)
  );

  const newMessages = force
    ? sourceSession.messages
    : sourceSession.messages.filter(m => {
        const sig = `${m.role}\u0000${m.text.trim()}`;
        if (existingSignatures.has(sig)) return false;
        existingSignatures.add(sig);
        return true;
      });

  if (newMessages.length === 0) {
    return { appended: 0 };
  }

  switch (targetAgent) {
    case 'claude':
      await appendToClaude(newMessages, targetFilePath, existing.id);
      break;
    case 'gemini':
      await appendToGemini(newMessages, targetFilePath, sourceSession.model);
      break;
    case 'codex':
      // Preserve the target session's cwd — that's the project it belongs to.
      await appendToCodex(newMessages, targetFilePath, existing.cwd, sourceSession.model);
      break;
  }

  return { appended: newMessages.length };
}

async function appendToClaude(
  messages: UnifiedSession['messages'],
  filePath: string,
  sessionId: string
): Promise<void> {
  // Find the uuid of the last message in the target file so we can chain
  // parentUuid correctly — otherwise /resume won't show the appended messages.
  const content = await fs.readFile(filePath, 'utf-8');
  const existingLines = content.trim().split('\n').filter(Boolean);
  let prevUuid: string | null = null;
  for (let i = existingLines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(existingLines[i]);
      if (parsed.uuid) { prevUuid = parsed.uuid; break; }
    } catch { continue; }
  }

  const lines: string[] = [];
  for (const msg of messages) {
    const uuid = crypto.randomUUID();
    if (msg.role === 'user') {
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: msg.text },
        uuid,
        timestamp: msg.timestamp,
        userType: 'external',
        sessionId
      }));
    } else if (msg.role === 'assistant') {
      lines.push(JSON.stringify({
        parentUuid: prevUuid,
        isSidechain: false,
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: msg.text }] },
        uuid,
        timestamp: msg.timestamp,
        sessionId
      }));
    }
    prevUuid = uuid;
  }

  await fs.appendFile(filePath, '\n' + lines.join('\n') + '\n', 'utf-8');
}

async function appendToGemini(
  messages: UnifiedSession['messages'],
  filePath: string,
  model?: string
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  for (const msg of messages) {
    if (msg.role === 'user') {
      data.messages.push({
        id: crypto.randomUUID(),
        timestamp: msg.timestamp,
        type: 'user',
        content: [{ text: msg.text }]
      });
    }
    if (msg.role === 'assistant') {
      data.messages.push({
        id: crypto.randomUUID(),
        timestamp: msg.timestamp,
        type: 'gemini',
        content: msg.text,
        thoughts: [],
        tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0, total: 0 },
        model: model || 'unknown'
      });
    }
  }

  data.lastUpdated = messages[messages.length - 1].timestamp;

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function appendToCodex(
  messages: UnifiedSession['messages'],
  filePath: string,
  cwd: string,
  model?: string
): Promise<void> {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const turnId = crypto.randomUUID();
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'turn_context',
        payload: {
          turn_id: turnId,
          cwd,
          current_date: msg.timestamp.slice(0, 10),
          model: model || 'unknown'
        }
      }));
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: msg.text }]
        }
      }));
    }
    if (msg.role === 'assistant') {
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.text }]
        }
      }));
    }
  }

  await fs.appendFile(filePath, '\n' + lines.join('\n') + '\n', 'utf-8');
}

// ─── Router ────────────────────────────────────────────────────

export async function writeSession(session: UnifiedSession, targetAgent: AgentType, projectCwd: string): Promise<string> {
  switch (targetAgent) {
    case 'claude': return writeClaudeSession(session, projectCwd);
    case 'gemini': return writeGeminiSession(session, projectCwd);
    case 'codex': return writeCodexSession(session, projectCwd);
  }
}
