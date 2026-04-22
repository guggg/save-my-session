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
      if (await isTransferredSession(filePath)) continue;
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
    for (const file of entries.filter(f => f.endsWith('.json'))) {
      const filePath = path.join(chatsDir, file);
      // Skip a transferred session only if nothing has happened in it since
      // the transfer. If the user kept chatting in it, treat it as a real
      // Gemini session.
      if (await isUntouchedTransferredGeminiSession(filePath)) continue;
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

            const headLines = await readHeadLines(filePath, 3);
            if (headLines.some(l => l.includes(TRANSFER_MARKER))) continue;

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
  const fileHandle = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(16384);
  const { bytesRead } = await fileHandle.read(buf, 0, 16384, 0);
  await fileHandle.close();
  const content = buf.subarray(0, bytesRead).toString('utf-8');
  return content.split('\n').slice(0, count);
}

async function isTransferredSession(filePath: string): Promise<boolean> {
  const lines = await readHeadLines(filePath, 2);
  return lines.some(l => l.includes(TRANSFER_MARKER));
}

async function isUntouchedTransferredGeminiSession(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    if (!(TRANSFER_MARKER in data)) return false;

    const transferredAt = data[TRANSFER_MARKER]?.transferred_at;
    if (!transferredAt) return true; // marker exists but no timestamp — treat as untouched

    const transferredMs = new Date(transferredAt).getTime();
    const lastUpdatedMs = data.lastUpdated ? new Date(data.lastUpdated).getTime() : 0;

    // If lastUpdated is newer than the transfer time, the user continued the
    // conversation and this is a real Gemini session we should transfer from.
    return lastUpdatedMs <= transferredMs;
  } catch {
    return false;
  }
}
