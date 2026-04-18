import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AgentType } from './types.js';
import { TRANSFER_MARKER } from './writers.js';

export interface FoundSession {
  agent: AgentType;
  filePath: string;
  lastModified: Date;
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
  const projectSlug = projectCwd.replace(/\//g, '-');
  const projectDir = path.join(configDir, 'projects', projectSlug);

  const results: FoundSession[] = [];
  try {
    const entries = await fs.readdir(projectDir);
    for (const file of entries.filter(f => f.endsWith('.jsonl'))) {
      const filePath = path.join(projectDir, file);
      if (await isTransferredSession(filePath)) continue;
      const stat = await fs.stat(filePath);
      results.push({ agent: 'claude', filePath, lastModified: stat.mtime });
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
      if (await isTransferredGeminiSession(filePath)) continue;
      const stat = await fs.stat(filePath);
      results.push({ agent: 'gemini', filePath, lastModified: stat.mtime });
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
                results.push({ agent: 'codex', filePath, lastModified: stat.mtime });
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

async function isTransferredGeminiSession(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return TRANSFER_MARKER in data;
  } catch {
    return false;
  }
}
