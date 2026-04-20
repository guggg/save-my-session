export type AgentType = 'claude' | 'gemini' | 'codex';

export interface UnifiedMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface UnifiedSession {
  id: string;
  agent: AgentType;
  cwd: string;
  messages: UnifiedMessage[];
  startTime: string;
  lastUpdated: string;
  model?: string;
}

// Claude Code slugs project directories by replacing every non-alphanumeric
// char with a dash (confirmed by inspecting ~/.claude/projects/). Keep this in
// one place so finder and writer always agree.
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
