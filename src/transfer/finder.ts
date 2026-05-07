import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AgentType, claudeProjectSlug } from './types.js';
import { TRANSFER_MARKER } from './writers.js';

export interface FoundSession {
  agent: AgentType;
  filePath: string;
  hash: string;      // first 7 chars of sha1(filePath) — stable short ID
  lastModified: Date;
}

export function sessionHash(filePath: string): string {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 7);
}

/** Resolve a --session / --append value that may be a 7-char hash or a full path. */
export async function resolveSessionPath(
  hashOrPath: string,
  agent: AgentType,
  cwd: string
): Promise<string> {
  // Full path — use directly.
  if (hashOrPath.includes('/') || hashOrPath.includes('\\')) return hashOrPath;

  // Short hash — look it up in the session list.
  const all = await findAllSessions(cwd, agent);
  const match = all.find(s => s.hash === hashOrPath);
  if (!match) {
    throw new Error(`No session found with hash "${hashOrPath}". Run \`save-my-session list --from <agent>\` to see available sessions.`);
  }
  return match.filePath;
}

export async function findLatestSession(projectCwd: string, agent: AgentType): Promise<FoundSession | null> {
  const all = await findAllSessions(projectCwd, agent);
  return all.length > 0 ? all[0] : null;
}

export async function findAllSessions(projectCwd: string, agent: AgentType): Promise<FoundSession[]> {
  let sessions: FoundSession[];
  switch (agent) {
    case 'claude': sessions = await findAllClaudeSessions(projectCwd); break;
    case 'gemini': sessions = await findAllGeminiSessions(projectCwd); break;
    case 'codex': sessions = await findAllCodexSessions(projectCwd); break;
  }
  // Sort newest first
  return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

async function findAllClaudeSessions(projectCwd: string): Promise<FoundSession[]> {
  const homeDir = os.homedir();
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
  const projectSlug = claudeProjectSlug(projectCwd);
  const projectDir = path.join(configDir, 'projects', projectSlug);

  const results: FoundSession[] = [];
  try {
    const entries = await fs.readdir(projectDir);
    for (const file of entries.filter(f => f.endsWith('.jsonl'))) {
      const filePath = path.join(projectDir, file);
      // Skip a transferred session only if nothing has happened since the
      // transfer. If the user continued the conversation (via /resume +
      // chat), treat it as a real Claude session.
      if (await isUntouchedTransferredClaudeSession(filePath)) continue;
      const stat = await fs.stat(filePath);
      results.push({ agent: 'claude', filePath, hash: sessionHash(filePath), lastModified: stat.mtime });
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

async function findAllGeminiSessions(projectCwd: string): Promise<FoundSession[]> {
  const homeDir = os.homedir();
  const geminiHome = process.env.GEMINI_CLI_HOME || path.join(homeDir, '.gemini');
  const slug = await getGeminiSlug(geminiHome, projectCwd);
  if (!slug) return [];

  const chatsDir = path.join(geminiHome, 'tmp', slug, 'chats');
  const results: FoundSession[] = [];
  try {
    const entries = await fs.readdir(chatsDir);
    // Gemini CLI switched from .json (single JSON object) to .jsonl
    // (metadata on line 1, one message per line after). Accept both.
    for (const file of entries.filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))) {
      const filePath = path.join(chatsDir, file);
      // Skip a transferred session only if nothing has happened in it since
      // the transfer. If the user kept chatting in it, treat it as a real
      // Gemini session.
      if (await isUntouchedTransferredGeminiSession(filePath)) continue;
      // Skip empty sessions — Gemini CLI auto-creates a metadata-only file
      // on launch even before the user says anything.
      if (await isEmptyGeminiSession(filePath)) continue;
      const stat = await fs.stat(filePath);
      results.push({ agent: 'gemini', filePath, hash: sessionHash(filePath), lastModified: stat.mtime });
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

async function findAllCodexSessions(projectCwd: string): Promise<FoundSession[]> {
  const homeDir = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(homeDir, '.codex');
  const sessionsDir = path.join(codexHome, 'sessions');

  const results: FoundSession[] = [];
  try {
    const years = await fs.readdir(sessionsDir);
    for (const year of years.sort().reverse()) {
      const months = await fs.readdir(path.join(sessionsDir, year));
      for (const month of months.sort().reverse()) {
        const days = await fs.readdir(path.join(sessionsDir, year, month));
        for (const day of days.sort().reverse()) {
          const dayDir = path.join(sessionsDir, year, month, day);
          const files = await fs.readdir(dayDir);

          for (const file of files.filter(f => f.endsWith('.jsonl'))) {
            const filePath = path.join(dayDir, file);

            // Read a few head lines. Legacy save-my-session Codex files put
            // the transfer marker on its own first line (Codex /resume can't
            // load those). The new writer embeds the marker inside
            // session_meta.payload so line 1 is a real session_meta.
            const headLines = await readHeadLines(filePath, 4);
            const firstLineIsLegacyMarker =
              headLines[0] && headLines[0].includes(TRANSFER_MARKER) &&
              !headLines[0].includes('session_meta');
            if (firstLineIsLegacyMarker) continue;

            const metaLine = headLines.find(l => l.includes('session_meta'));
            if (!metaLine) continue;
            try {
              const meta = JSON.parse(metaLine);
              if (meta.type === 'session_meta' && meta.payload?.cwd === projectCwd) {
                const stat = await fs.stat(filePath);
                results.push({ agent: 'codex', filePath, hash: sessionHash(filePath), lastModified: stat.mtime });
              }
            } catch {
              continue;
            }
          }
        }
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

async function getGeminiSlug(geminiHome: string, projectCwd: string): Promise<string | null> {
  try {
    const projectsPath = path.join(geminiHome, 'projects.json');
    const content = await fs.readFile(projectsPath, 'utf-8');
    const data = JSON.parse(content);
    return data.projects?.[projectCwd] || null;
  } catch {
    return null;
  }
}

async function readHeadLines(filePath: string, count: number): Promise<string[]> {
  // Native Codex session_meta can be >50KB because it includes the full
  // base_instructions prompt as JSON. A 16KB buffer truncates the first line
  // mid-string and the caller's JSON.parse would fail.
  const BUF_SIZE = 128 * 1024;
  const fileHandle = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(BUF_SIZE);
  const { bytesRead } = await fileHandle.read(buf, 0, BUF_SIZE, 0);
  await fileHandle.close();
  const content = buf.subarray(0, bytesRead).toString('utf-8');
  return content.split('\n').slice(0, count);
}

async function isTransferredSession(filePath: string): Promise<boolean> {
  const lines = await readHeadLines(filePath, 2);
  return lines.some(l => l.includes(TRANSFER_MARKER));
}

async function isUntouchedTransferredClaudeSession(filePath: string): Promise<boolean> {
  // Find the transfer marker line (if any) to get transferred_at.
  const headLines = await readHeadLines(filePath, 3);
  let transferredAt: string | null = null;
  for (const l of headLines) {
    if (!l.includes(TRANSFER_MARKER)) continue;
    try {
      const obj = JSON.parse(l);
      if (obj.type === TRANSFER_MARKER) {
        transferredAt = obj.transferred_at || null;
      }
    } catch { /* skip */ }
  }
  if (!transferredAt) return false; // not a transferred file, keep it

  // Scan the whole file for the max user/assistant timestamp.
  // If any message is newer than transferred_at, the user kept chatting.
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const transferredMs = new Date(transferredAt).getTime();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if ((obj.type === 'user' || obj.type === 'assistant') && obj.timestamp) {
          if (new Date(obj.timestamp).getTime() > transferredMs) return false;
        }
      } catch { /* skip malformed line */ }
    }
    return true; // no message newer than transfer — untouched
  } catch {
    return true;
  }
}

async function isEmptyGeminiSession(filePath: string): Promise<boolean> {
  try {
    if (filePath.endsWith('.jsonl')) {
      // jsonl: metadata on line 1; any message on line 2+ means non-empty.
      const lines = await readHeadLines(filePath, 2);
      return lines.length < 2 || !lines[1]?.trim();
    }
    // Old .json format: non-empty messages array.
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return !Array.isArray(data.messages) || data.messages.length === 0;
  } catch {
    return true;
  }
}

async function isUntouchedTransferredGeminiSession(filePath: string): Promise<boolean> {
  try {
    // jsonl format: metadata on line 1 may hold the marker; messages on
    // later lines carry their own timestamps.
    // old json format: single object with messages[] inside.
    let meta: any;
    let messages: any[];
    if (filePath.endsWith('.jsonl')) {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) return false;
      meta = JSON.parse(lines[0]);
      messages = lines.slice(1).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } else {
      const content = await fs.readFile(filePath, 'utf-8');
      meta = JSON.parse(content);
      messages = Array.isArray(meta.messages) ? meta.messages : [];
    }
    if (!(TRANSFER_MARKER in meta)) return false;

    const transferredAt = meta[TRANSFER_MARKER]?.transferred_at;
    if (!transferredAt) return true; // marker exists but no timestamp — treat as untouched

    const transferredMs = new Date(transferredAt).getTime();

    // Gemini's metadata lastUpdated is not always bumped when the user
    // continues chatting (seen in the wild). Check individual message
    // timestamps too — any user/gemini message newer than transferred_at
    // means the user kept chatting after /resume.
    for (const m of messages) {
      if ((m.type === 'user' || m.type === 'gemini') && m.timestamp) {
        if (new Date(m.timestamp).getTime() > transferredMs) return false;
      }
    }

    const lastUpdatedMs = meta.lastUpdated ? new Date(meta.lastUpdated).getTime() : 0;
    return lastUpdatedMs <= transferredMs;
  } catch {
    return false;
  }
}
