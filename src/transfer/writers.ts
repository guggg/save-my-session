import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { UnifiedSession, AgentType, claudeProjectSlug } from './types.js';

export const TRANSFER_MARKER = '_transferred_by_save_my_session';

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex'
};

function handoffNotice(sourceAgent: string, startTime: string): { text: string; timestamp: string } {
  const label = AGENT_LABELS[sourceAgent] || sourceAgent;
  const text = `[This conversation was transferred from ${label} using save-my-session. The history below is from the previous session — just pick up naturally from where things left off.]`;
  // Place the notice 1ms before the first message so it sorts first.
  const ts = startTime
    ? new Date(new Date(startTime).getTime() - 1).toISOString()
    : new Date().toISOString();
  return { text, timestamp: ts };
}

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

  // Handoff notice — tells the agent this history came from another session.
  const notice = handoffNotice(session.agent, session.startTime);
  const noticeUuid = crypto.randomUUID();
  lines.push(JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: notice.text }] },
    uuid: noticeUuid,
    timestamp: notice.timestamp,
    sessionId
  }));

  // Convert messages
  let prevUuid: string | null = noticeUuid;
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
  // Gemini CLI switched to .jsonl: metadata on line 1, one message per line.
  const fileName = `session-${timestamp}-${sessionId}.jsonl`;
  const filePath = path.join(chatsDir, fileName);

  const messages: any[] = [];

  // Handoff notice as a gemini (assistant) message before the real history.
  const notice = handoffNotice(session.agent, session.startTime);
  messages.push({
    id: crypto.randomUUID(),
    timestamp: notice.timestamp,
    type: 'gemini',
    content: notice.text,
    thoughts: [],
    tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0, total: 0 },
    model: session.model || 'unknown'
  });

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

  // projectHash is sha256 of the absolute cwd — Gemini uses this to bind
  // a session to a project; /resume won't show the session without it.
  const projectHash = crypto.createHash('sha256').update(projectCwd).digest('hex');

  const meta = {
    sessionId: crypto.randomUUID(),
    projectHash,
    startTime: session.startTime,
    lastUpdated: session.lastUpdated,
    kind: 'main',
    [TRANSFER_MARKER]: { source_agent: session.agent, transferred_at: new Date().toISOString() }
  };

  const lines = [JSON.stringify(meta), ...messages.map(m => JSON.stringify(m))];
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
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

  // Codex uses UUIDv7 (time-ordered) rather than v4. /resume won't list
  // sessions whose id format it doesn't recognise.
  const sessionId = uuidV7(now);
  // Filename uses local time, matching native Codex sessions.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const localTs =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T` +
    `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  const fileName = `rollout-${localTs}-${sessionId}.jsonl`;
  const filePath = path.join(sessionDir, fileName);

  const lines: string[] = [];

  // Session meta (Codex requires this to be the first line for /resume to
  // recognize the session). We embed the transfer marker inside the payload
  // so the file is still identifiable but stays structurally valid.
  lines.push(JSON.stringify({
    timestamp: now.toISOString(),
    type: 'session_meta',
    payload: {
      id: sessionId,
      timestamp: session.startTime,
      cwd: projectCwd,
      originator: 'codex-tui',
      cli_version: '0.128.0',
      instructions: null,
      source: 'cli',
      model_provider: 'openai',
      [TRANSFER_MARKER]: {
        source_agent: session.agent,
        transferred_at: now.toISOString()
      }
    }
  }));

  // event_msg / task_started — native Codex sessions have this on line 2.
  // Some Codex versions may use it as a marker for a "real" session.
  lines.push(JSON.stringify({
    timestamp: now.toISOString(),
    type: 'event_msg',
    payload: {
      type: 'task_started',
      turn_id: crypto.randomUUID(),
      started_at: Math.floor(now.getTime() / 1000),
      model_context_window: 258400,
      collaboration_mode_kind: 'default'
    }
  }));

  // Handoff notice as agent_message + response_item before the real history.
  const notice = handoffNotice(session.agent, session.startTime);
  lines.push(JSON.stringify({
    timestamp: notice.timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: notice.text }]
    }
  }));
  lines.push(JSON.stringify({
    timestamp: notice.timestamp,
    type: 'event_msg',
    payload: { type: 'agent_message', message: notice.text, phase: null, memory_citation: null }
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

      // Codex indexes title / first_user_message from event_msg user_message,
      // not from response_item role=user. Without this, /resume picker hides
      // the session (picker filters on first_user_message <> '').
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: msg.text,
          images: [],
          local_images: [],
          text_elements: []
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

      // Codex UI re-plays assistant messages from event_msg agent_message
      // during /resume. Without this, the assistant replies disappear from
      // history (even though response_item is still there for the model).
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: msg.text,
          phase: null,
          memory_citation: null
        }
      }));
    }
  }

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

  // Pick the first substantive user message for title/first_user_message.
  // Skip synthetic/command messages injected by agents (<command-name>, <local-command-stdout>, etc.)
  const isSynthetic = (text: string) =>
    /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)/i.test(text.trim()) ||
    text.trim().length === 0;
  const firstRealUser = session.messages.find(m => m.role === 'user' && !isSynthetic(m.text));
  const firstUserMessage = (firstRealUser?.text || session.messages.find(m => m.role === 'user')?.text || '').replace(/\s+/g, ' ').trim();
  const title = firstUserMessage.slice(0, 60) || 'Transferred session';

  // Register in session_index.jsonl (older Codex versions read this).
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  const indexEntry = JSON.stringify({ id: sessionId, thread_name: title, updated_at: now.toISOString() });
  try {
    await fs.appendFile(indexPath, indexEntry + '\n', 'utf-8');
  } catch {
    await fs.writeFile(indexPath, indexEntry + '\n', 'utf-8');
  }

  // Register in state_5.sqlite — this is what /resume actually reads.
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  const nowSec = Math.floor(now.getTime() / 1000);
  const sandboxPolicy = JSON.stringify({
    type: 'workspace-write',
    writable_roots: [path.join(codexHome, 'memories')],
    network_access: false,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false
  });
  try {
    // Escape single quotes for SQL literals. No newlines in our values
    // because we already collapsed whitespace above.
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const truncatedFirstUser = firstUserMessage.slice(0, 200);
    const sql = `INSERT OR IGNORE INTO threads (
  id, rollout_path, created_at, updated_at, source, model_provider,
  cwd, title, sandbox_policy, approval_mode, tokens_used, has_user_event,
  archived, git_sha, git_branch, git_origin_url, cli_version,
  first_user_message, memory_mode
) VALUES (
  ${q(sessionId)}, ${q(filePath)}, ${nowSec}, ${nowSec}, 'cli', 'openai',
  ${q(projectCwd)}, ${q(title)}, ${q(sandboxPolicy)},
  'on-request', 0, 1, 0, '', '', '', '0.128.0',
  ${q(truncatedFirstUser)}, 'enabled'
);`;
    execSync(`sqlite3 ${JSON.stringify(dbPath)}`, { input: sql, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch {
    // sqlite3 CLI might not be available or schema may have changed — not fatal.
  }

  return filePath;
}

// Generate a UUIDv7 (time-ordered 128-bit). Codex expects this format.
function uuidV7(now: Date): string {
  const ts = BigInt(now.getTime()); // 48-bit unix ms
  const rand = crypto.randomBytes(10);
  const bytes = Buffer.alloc(16);
  // 48-bit timestamp
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  // Copy 10 random bytes
  rand.copy(bytes, 6);
  // Version 7 in byte 6 high nibble
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 10xx in byte 8 high 2 bits
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  const newMessages: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      newMessages.push({
        id: crypto.randomUUID(),
        timestamp: msg.timestamp,
        type: 'user',
        content: [{ text: msg.text }]
      });
    }
    if (msg.role === 'assistant') {
      newMessages.push({
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
  const newLastUpdated = messages[messages.length - 1].timestamp;

  if (filePath.endsWith('.jsonl')) {
    // Update line 1 metadata's lastUpdated, then append messages as new lines.
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      try {
        const meta = JSON.parse(lines[0]);
        meta.lastUpdated = newLastUpdated;
        lines[0] = JSON.stringify(meta);
      } catch {
        // malformed metadata — leave as is
      }
    }
    const appended = [...lines, ...newMessages.map(m => JSON.stringify(m))];
    await fs.writeFile(filePath, appended.join('\n') + '\n', 'utf-8');
  } else {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    data.messages.push(...newMessages);
    data.lastUpdated = newLastUpdated;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
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

      // Codex UI re-plays user messages from event_msg user_message during
      // /resume — without this, appended user turns disappear from history.
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: msg.text,
          images: [],
          local_images: [],
          text_elements: []
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

      // Codex UI re-plays assistant messages from event_msg agent_message
      // during /resume. Without this, the assistant replies disappear from
      // history (even though response_item is still there for the model).
      lines.push(JSON.stringify({
        timestamp: msg.timestamp,
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: msg.text,
          phase: null,
          memory_citation: null
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
