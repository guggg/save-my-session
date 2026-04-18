/**
 * Restore 命令：從狀態快照生成 context prompt
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ProjectState, RestoreOptions } from '../types.js';

export class RestoreCommand {
  private projectPath: string;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
  }

  async execute(options: RestoreOptions = {}): Promise<string> {
    console.log('📖 Loading project state...');

    const statePath = options.input || path.join(this.projectPath, 'project_state.yml');
    const state = await this.loadState(statePath);

    const prompt = this.generatePrompt(state, options);

    console.log('\n' + '='.repeat(80));
    console.log('📋 Context for new agent:');
    console.log('='.repeat(80));
    console.log(prompt);
    console.log('='.repeat(80));

    // Optionally save to file
    const outputPath = path.join(this.projectPath, '.restore_context.md');
    await fs.writeFile(outputPath, prompt, 'utf-8');
    console.log(`\n💾 Context saved to: ${outputPath}`);
    console.log('📎 You can paste this to your new AI coding agent\n');

    return prompt;
  }

  private async loadState(statePath: string): Promise<ProjectState> {
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      return YAML.parse(content) as ProjectState;
    } catch (error) {
      throw new Error(`Failed to load state file: ${statePath}`);
    }
  }

  private generatePrompt(state: ProjectState, options: RestoreOptions): string {
    const format = options.format || 'markdown';

    if (format === 'plain') {
      return this.generatePlainPrompt(state, options.agent);
    }

    return this.generateMarkdownPrompt(state, options.agent);
  }

  private generateMarkdownPrompt(state: ProjectState, targetAgent?: string): string {
    const sections: string[] = [];

    // Header
    sections.push(`# Project Handoff: ${state.meta.project_name}`);
    sections.push('');
    sections.push(`**Last Updated:** ${new Date(state.meta.last_updated).toLocaleString()}`);
    if (state.meta.last_agent) {
      sections.push(`**Previous Agent:** ${state.meta.last_agent}`);
    }
    if (targetAgent) {
      sections.push(`**Target Agent:** ${targetAgent}`);
    }
    sections.push('');
    sections.push('---');
    sections.push('');

    // Project Overview
    sections.push('## 📦 Project Overview');
    sections.push('');
    sections.push(`**Architecture:** ${state.architecture.summary}`);
    sections.push('');
    sections.push('**Tech Stack:**');
    state.architecture.tech_stack.forEach(tech => {
      sections.push(`- ${tech}`);
    });
    sections.push('');

    if (state.architecture.key_files.length > 0) {
      sections.push('**Key Files:**');
      state.architecture.key_files.slice(0, 5).forEach(file => {
        sections.push(`- \`${file}\``);
      });
      sections.push('');
    }

    // Current Task
    sections.push('## 🎯 Current Task');
    sections.push('');
    sections.push(`**Goal:** ${state.current_task.goal}`);
    sections.push(`**Status:** ${state.current_task.status}`);
    sections.push('');

    if (state.current_task.completed.length > 0) {
      sections.push('**✅ Completed:**');
      state.current_task.completed.forEach(item => {
        sections.push(`- ${item}`);
      });
      sections.push('');
    }

    if (state.current_task.next_steps.length > 0) {
      sections.push('**⏭️ Next Steps:**');
      state.current_task.next_steps.forEach(step => {
        sections.push(`- ${step}`);
      });
      sections.push('');
    }

    if (state.current_task.blockers && state.current_task.blockers.length > 0) {
      sections.push('**🚫 Blockers:**');
      state.current_task.blockers.forEach(blocker => {
        sections.push(`- ${blocker}`);
      });
      sections.push('');
    }

    // Git State
    sections.push('## 🔧 Git State');
    sections.push('');
    sections.push(`**Branch:** \`${state.git_state.branch}\``);

    if (state.git_state.remote) {
      sections.push(`**Remote:** ${state.git_state.remote}`);
      if (state.git_state.ahead || state.git_state.behind) {
        sections.push(`**Sync Status:** ${state.git_state.ahead || 0} ahead, ${state.git_state.behind || 0} behind`);
      }
    }
    sections.push('');

    if (state.git_state.uncommitted_files.length > 0) {
      sections.push('**📝 Uncommitted Changes:**');
      state.git_state.uncommitted_files.forEach(file => {
        sections.push(`- \`${file}\``);
      });
      sections.push('');
    }

    if (state.git_state.recent_commits.length > 0) {
      sections.push('**Recent Commits:**');
      state.git_state.recent_commits.slice(0, 3).forEach(commit => {
        sections.push(`- \`${commit.hash}\` ${commit.message}`);
      });
      sections.push('');
    }

    // Decisions
    if (state.decisions.length > 0) {
      sections.push('## 💡 Key Decisions');
      sections.push('');
      state.decisions.slice(-5).reverse().forEach((decision, idx) => {
        sections.push(`### ${idx + 1}. ${decision.decision}`);
        sections.push(`**Reason:** ${decision.reason}`);
        sections.push(`**When:** ${new Date(decision.timestamp).toLocaleString()}`);
        if (decision.impact) {
          sections.push(`**Impact:** ${decision.impact}`);
        }
        sections.push('');
      });
    }

    // Context
    sections.push('## 📌 Important Context');
    sections.push('');

    if (state.context.important_notes.length > 0) {
      sections.push('**Notes:**');
      state.context.important_notes.forEach(note => {
        sections.push(`- ${note}`);
      });
      sections.push('');
    }

    if (state.context.potential_issues.length > 0) {
      sections.push('**⚠️ Potential Issues:**');
      state.context.potential_issues.forEach(issue => {
        sections.push(`- ${issue}`);
      });
      sections.push('');
    }

    if (state.context.related_docs && state.context.related_docs.length > 0) {
      sections.push('**Related Documentation:**');
      state.context.related_docs.forEach(doc => {
        sections.push(`- ${doc}`);
      });
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('');
    sections.push('**What to do next:**');
    sections.push('1. Review the uncommitted changes to understand what was in progress');
    sections.push('2. Check the next steps and continue from where we left off');
    sections.push('3. Keep the decisions in mind when making new changes');
    sections.push('4. Update the project state after significant progress');

    return sections.join('\n');
  }

  private generatePlainPrompt(state: ProjectState, targetAgent?: string): string {
    const lines: string[] = [];

    lines.push(`PROJECT HANDOFF: ${state.meta.project_name}`);
    lines.push('');

    lines.push(`Architecture: ${state.architecture.summary}`);
    lines.push(`Tech Stack: ${state.architecture.tech_stack.join(', ')}`);
    lines.push('');

    lines.push(`Current Task: ${state.current_task.goal}`);
    lines.push(`Status: ${state.current_task.status}`);
    lines.push('');

    if (state.current_task.completed.length > 0) {
      lines.push('Completed:');
      state.current_task.completed.forEach(item => lines.push(`  - ${item}`));
      lines.push('');
    }

    if (state.current_task.next_steps.length > 0) {
      lines.push('Next Steps:');
      state.current_task.next_steps.forEach(step => lines.push(`  - ${step}`));
      lines.push('');
    }

    lines.push(`Git Branch: ${state.git_state.branch}`);
    if (state.git_state.uncommitted_files.length > 0) {
      lines.push(`Uncommitted Files: ${state.git_state.uncommitted_files.length}`);
    }
    lines.push('');

    if (state.decisions.length > 0) {
      lines.push('Key Decisions:');
      state.decisions.slice(-3).forEach(d => {
        lines.push(`  - ${d.decision}: ${d.reason}`);
      });
      lines.push('');
    }

    if (state.context.important_notes.length > 0) {
      lines.push('Important Notes:');
      state.context.important_notes.forEach(note => lines.push(`  - ${note}`));
    }

    return lines.join('\n');
  }
}
