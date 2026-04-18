/**
 * Project State Snapshot 資料結構
 */

export interface ProjectState {
  meta: MetaInfo;
  architecture: Architecture;
  current_task: CurrentTask;
  decisions: Decision[];
  git_state: GitState;
  context: Context;
}

export interface MetaInfo {
  project_name: string;
  last_updated: string; // ISO 8601
  last_agent?: string;
  snapshot_version: string;
}

export interface Architecture {
  summary: string;
  key_files: string[];
  tech_stack: string[];
  dependencies?: Record<string, string>;
}

export interface CurrentTask {
  goal: string;
  status: string; // e.g., "70% 完成", "進行中", "已完成"
  completed: string[];
  next_steps: string[];
  blockers?: string[];
}

export interface Decision {
  decision: string;
  reason: string;
  timestamp: string; // ISO 8601
  impact?: string;
}

export interface GitState {
  branch: string;
  uncommitted_files: string[];
  recent_commits: Commit[];
  remote?: string;
  ahead?: number;
  behind?: number;
}

export interface Commit {
  hash: string;
  message: string;
  author?: string;
  timestamp?: string;
}

export interface Context {
  important_notes: string[];
  potential_issues: string[];
  related_docs?: string[];
}

/**
 * CLI 命令選項
 */

export interface SnapshotOptions {
  output?: string;
  verbose?: boolean;
  includeTaskContext?: boolean;
}

export interface RestoreOptions {
  input?: string;
  agent?: string;
  format?: 'markdown' | 'plain';
}

export interface UpdateOptions {
  type: 'decision' | 'progress' | 'blocker' | 'note';
  message: string;
}
