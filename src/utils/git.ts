/**
 * Git 相關工具函數
 */

import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { GitState, Commit } from '../types.js';

export class GitAnalyzer {
  private git: SimpleGit;

  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(repoPath);
  }

  async getGitState(): Promise<GitState> {
    const isRepo = await this.git.checkIsRepo();

    if (!isRepo) {
      return {
        branch: 'N/A',
        uncommitted_files: [],
        recent_commits: []
      };
    }

    const [status, branch, log, remote] = await Promise.all([
      this.git.status(),
      this.git.branchLocal(),
      this.git.log({ maxCount: 5 }),
      this.getRemoteInfo()
    ]);

    return {
      branch: branch.current,
      uncommitted_files: this.getUncommittedFiles(status),
      recent_commits: this.formatCommits(log.all),
      remote: remote.url,
      ahead: remote.ahead,
      behind: remote.behind
    };
  }

  private getUncommittedFiles(status: StatusResult): string[] {
    const files: string[] = [];

    // Modified files
    files.push(...status.modified);
    files.push(...status.created);
    files.push(...status.deleted);
    files.push(...status.renamed.map(r => r.to));

    // Staged files
    files.push(...status.staged);

    return [...new Set(files)]; // Remove duplicates
  }

  private formatCommits(commits: readonly any[]): Commit[] {
    return [...commits].map(commit => ({
      hash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      timestamp: commit.date
    }));
  }

  private async getRemoteInfo(): Promise<{
    url?: string;
    ahead?: number;
    behind?: number;
  }> {
    try {
      const remotes = await this.git.getRemotes(true);
      const status = await this.git.status();

      return {
        url: remotes[0]?.refs.fetch,
        ahead: status.ahead,
        behind: status.behind
      };
    } catch (error) {
      return {};
    }
  }

  async getDiff(includeUntracked: boolean = false): Promise<string> {
    const diff = await this.git.diff();

    if (includeUntracked) {
      const status = await this.git.status();
      if (status.not_added.length > 0) {
        return diff + '\n\nUntracked files:\n' + status.not_added.join('\n');
      }
    }

    return diff;
  }
}
