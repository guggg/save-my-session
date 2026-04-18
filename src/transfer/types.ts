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
