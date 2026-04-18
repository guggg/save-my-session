/**
 * Update 命令：增量更新專案狀態
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ProjectState, UpdateOptions, Decision } from '../types.js';

export class UpdateCommand {
  private projectPath: string;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
  }

  async execute(options: UpdateOptions): Promise<void> {
    const statePath = path.join(this.projectPath, 'project_state.yml');
    const state = await this.loadState(statePath);

    switch (options.type) {
      case 'decision':
        await this.addDecision(state, options.message);
        break;
      case 'progress':
        await this.markProgress(state, options.message);
        break;
      case 'blocker':
        await this.addBlocker(state, options.message);
        break;
      case 'note':
        await this.addNote(state, options.message);
        break;
    }

    // Update timestamp
    state.meta.last_updated = new Date().toISOString();

    // Save updated state
    await this.saveState(state, statePath);

    console.log(`✅ Updated: ${options.type} - ${options.message}`);
  }

  private async loadState(statePath: string): Promise<ProjectState> {
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      return YAML.parse(content) as ProjectState;
    } catch (error) {
      throw new Error(
        'No project state found. Run "save-my-session snapshot" first.'
      );
    }
  }

  private async addDecision(state: ProjectState, message: string): Promise<void> {
    // Parse decision message format: "Decision | Reason [| Impact]"
    const parts = message.split('|').map(s => s.trim());

    const decision: Decision = {
      decision: parts[0],
      reason: parts[1] || 'No reason provided',
      timestamp: new Date().toISOString(),
      impact: parts[2]
    };

    state.decisions.push(decision);

    console.log('\n💡 Decision recorded:');
    console.log(`   What: ${decision.decision}`);
    console.log(`   Why: ${decision.reason}`);
    if (decision.impact) {
      console.log(`   Impact: ${decision.impact}`);
    }
  }

  private async markProgress(state: ProjectState, message: string): Promise<void> {
    // Mark an item as completed and potentially update status
    state.current_task.completed.push(message);

    // Remove from next_steps if it exists there
    state.current_task.next_steps = state.current_task.next_steps.filter(
      step => !step.toLowerCase().includes(message.toLowerCase())
    );

    console.log(`\n✅ Marked as completed: ${message}`);

    // Auto-update task status
    const totalSteps = state.current_task.completed.length + state.current_task.next_steps.length;
    const completedSteps = state.current_task.completed.length;

    if (totalSteps > 0) {
      const percentage = Math.round((completedSteps / totalSteps) * 100);
      state.current_task.status = `${percentage}% 完成`;
      console.log(`   Task progress: ${percentage}%`);
    }
  }

  private async addBlocker(state: ProjectState, message: string): Promise<void> {
    if (!state.current_task.blockers) {
      state.current_task.blockers = [];
    }

    state.current_task.blockers.push(message);

    console.log(`\n🚫 Blocker added: ${message}`);
  }

  private async addNote(state: ProjectState, message: string): Promise<void> {
    state.context.important_notes.push(message);

    console.log(`\n📌 Note added: ${message}`);
  }

  private async saveState(state: ProjectState, outputPath: string): Promise<void> {
    const yaml = YAML.stringify(state, {
      indent: 2,
      lineWidth: 100
    });

    await fs.writeFile(outputPath, yaml, 'utf-8');
  }
}

/**
 * Helper function for interactive updates
 */
export async function interactiveUpdate(projectPath: string = process.cwd()): Promise<void> {
  console.log('\n🔄 Interactive Update Mode');
  console.log('What would you like to update?');
  console.log('1. Add a decision');
  console.log('2. Mark progress');
  console.log('3. Add a blocker');
  console.log('4. Add a note');
  console.log('');

  // In a real implementation, this would use a library like 'inquirer' for interactive prompts
  // For now, we'll keep it simple
  console.log('Use the command with options instead:');
  console.log('  save-my-session update decision "Use Redis for caching | Better performance"');
  console.log('  save-my-session update progress "Completed user authentication"');
  console.log('  save-my-session update blocker "Waiting for API key from DevOps"');
  console.log('  save-my-session update note "Database migration needs manual review"');
}
