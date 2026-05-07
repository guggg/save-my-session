/**
 * Install 命令：注入 handoff prompt 到各 Agent 的 system prompt
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MARKER_START = '<!-- save-my-session:start -->';
const MARKER_END = '<!-- save-my-session:end -->';

interface AgentConfig {
  name: string;
  globalPath: string;
  promptFile: string;
}

const AGENTS: AgentConfig[] = [
  {
    name: 'Claude Code',
    globalPath: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    promptFile: 'claude.md'
  },
  {
    name: 'Gemini CLI',
    globalPath: path.join(os.homedir(), '.gemini', 'GEMINI.md'),
    promptFile: 'gemini.md'
  },
  {
    name: 'Codex',
    globalPath: path.join(os.homedir(), '.codex', 'AGENTS.md'),
    promptFile: 'codex.md'
  }
];

export class InstallCommand {
  async execute(): Promise<void> {
    console.log('🔧 Installing save-my-session handoff prompts...\n');

    let installed = 0;
    let skipped = 0;

    for (const agent of AGENTS) {
      try {
        const result = await this.installForAgent(agent);
        if (result === 'installed') {
          console.log(`  ✅ ${agent.name}: Injected into ${agent.globalPath}`);
          installed++;
        } else if (result === 'updated') {
          console.log(`  🔄 ${agent.name}: Updated in ${agent.globalPath}`);
          installed++;
        } else {
          console.log(`  ⏭️  ${agent.name}: Directory not found, skipped`);
          skipped++;
        }
      } catch (error) {
        console.log(`  ❌ ${agent.name}: ${(error as Error).message}`);
        skipped++;
      }
    }

    console.log(`\n✨ Done! ${installed} agent(s) configured, ${skipped} skipped.`);

    if (installed > 0) {
      console.log('\n📋 What happens now:');
      console.log('   When you want to switch agents, just say so.');
      console.log('   The agent will write a handoff summary and give you the transfer command.\n');
    }
  }

  private async installForAgent(agent: AgentConfig): Promise<'installed' | 'updated' | 'skipped'> {
    const dir = path.dirname(agent.globalPath);

    // Check if agent's config directory exists
    try {
      await fs.access(dir);
    } catch {
      return 'skipped';
    }

    // Read the prompt template
    const promptPath = path.join(__dirname, '..', 'prompts', agent.promptFile);
    const prompt = await fs.readFile(promptPath, 'utf-8');

    const wrappedPrompt = `\n${MARKER_START}\n${prompt.trim()}\n${MARKER_END}\n`;

    // Read existing file or create new
    let existingContent = '';
    try {
      existingContent = await fs.readFile(agent.globalPath, 'utf-8');
    } catch {
      // File doesn't exist yet, will create
    }

    // Check if already installed
    if (existingContent.includes(MARKER_START)) {
      // Update existing
      const regex = new RegExp(
        `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
        'g'
      );
      const newContent = existingContent.replace(regex, wrappedPrompt.trim());
      await fs.writeFile(agent.globalPath, newContent, 'utf-8');
      return 'updated';
    }

    // Append to file
    const newContent = existingContent.trimEnd() + '\n' + wrappedPrompt;
    await fs.writeFile(agent.globalPath, newContent, 'utf-8');
    return 'installed';
  }
}

export class UninstallCommand {
  async execute(): Promise<void> {
    console.log('🧹 Removing save-my-session handoff prompts...\n');

    for (const agent of AGENTS) {
      try {
        const removed = await this.removeFromAgent(agent);
        if (removed) {
          console.log(`  ✅ ${agent.name}: Removed from ${agent.globalPath}`);
        } else {
          console.log(`  ⏭️  ${agent.name}: Not installed, skipped`);
        }
      } catch (error) {
        console.log(`  ❌ ${agent.name}: ${(error as Error).message}`);
      }
    }

    console.log('\n✨ Done! Handoff prompts removed.\n');
  }

  private async removeFromAgent(agent: AgentConfig): Promise<boolean> {
    let content: string;
    try {
      content = await fs.readFile(agent.globalPath, 'utf-8');
    } catch {
      return false;
    }

    if (!content.includes(MARKER_START)) {
      return false;
    }

    const regex = new RegExp(
      `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
      'g'
    );
    const newContent = content.replace(regex, '\n');
    await fs.writeFile(agent.globalPath, newContent.trimEnd() + '\n', 'utf-8');
    return true;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
