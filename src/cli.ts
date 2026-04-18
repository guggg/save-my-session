#!/usr/bin/env node

/**
 * save-my-session CLI
 * Smart project state snapshot tool for seamless AI coding agent handoffs
 */

import { Command } from 'commander';
import { SnapshotCommand } from './commands/snapshot.js';
import { RestoreCommand } from './commands/restore.js';
import { UpdateCommand } from './commands/update.js';
import { InstallCommand, UninstallCommand } from './commands/install.js';
import { TransferCommand } from './commands/transfer.js';
import { AgentType } from './transfer/types.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('save-my-session')
  .description('Smart project state snapshot tool for seamless AI coding agent handoffs')
  .version('0.1.0');

// Snapshot command
program
  .command('snapshot')
  .description('Generate a project state snapshot')
  .option('-o, --output <path>', 'Output file path', 'project_state.yml')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options) => {
    try {
      const cmd = new SnapshotCommand();
      await cmd.execute(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Restore command
program
  .command('restore')
  .description('Generate context prompt from project state for a new agent')
  .option('-i, --input <path>', 'Input state file path', 'project_state.yml')
  .option('-a, --agent <name>', 'Target agent name (e.g., "Claude Code", "Cursor")')
  .option('-f, --format <type>', 'Output format (markdown|plain)', 'markdown')
  .action(async (options) => {
    try {
      const cmd = new RestoreCommand();
      await cmd.execute(options);
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Update command
program
  .command('update')
  .description('Update project state incrementally')
  .argument('<type>', 'Update type (decision|progress|blocker|note)')
  .argument('<message>', 'Update message')
  .action(async (type, message) => {
    try {
      if (!['decision', 'progress', 'blocker', 'note'].includes(type)) {
        throw new Error('Invalid update type. Use: decision, progress, blocker, or note');
      }

      const cmd = new UpdateCommand();
      await cmd.execute({ type: type as any, message });
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Init command (helper to set up a new project)
program
  .command('init')
  .description('Initialize project state with interactive prompts')
  .action(async () => {
    console.log(chalk.blue('\n🚀 Initializing project state...\n'));

    try {
      // Create initial snapshot
      const cmd = new SnapshotCommand();
      const state = await cmd.execute({ verbose: true });

      console.log(chalk.green('\n✨ Project state initialized!'));
      console.log(chalk.gray('\nNext steps:'));
      console.log(chalk.gray('  1. Edit project_state.yml to add your current task'));
      console.log(chalk.gray('  2. Use "update" command to track progress'));
      console.log(chalk.gray('  3. Use "restore" to generate context for a new agent\n'));
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Transfer command
program
  .command('transfer')
  .description('Transfer session from one AI agent to another')
  .requiredOption('--from <agent>', 'Source agent (claude|gemini|codex)')
  .option('--to <agent>', 'Target agent (claude|gemini|codex)')
  .option('--cwd <path>', 'Project directory', process.cwd())
  .option('--session <file>', 'Specific session file to transfer')
  .option('--list', 'List all sessions for the source agent')
  .option('--append <file>', 'Append to an existing target session instead of creating new')
  .action(async (options) => {
    try {
      const validAgents = ['claude', 'gemini', 'codex'];
      if (!validAgents.includes(options.from)) {
        throw new Error(`Invalid source agent: ${options.from}. Use: ${validAgents.join(', ')}`);
      }
      if (!options.list && !options.to) {
        throw new Error('--to is required (unless using --list)');
      }
      if (options.to && !validAgents.includes(options.to)) {
        throw new Error(`Invalid target agent: ${options.to}. Use: ${validAgents.join(', ')}`);
      }

      const cmd = new TransferCommand();
      await cmd.execute({
        from: options.from as AgentType,
        to: options.to as AgentType,
        cwd: options.cwd,
        sessionFile: options.session,
        list: options.list,
        append: options.append
      });
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Info command (show current state summary)
program
  .command('info')
  .description('Show current project state summary')
  .action(async () => {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const YAML = await import('yaml');

      const statePath = path.join(process.cwd(), 'project_state.yml');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = YAML.parse(content);

      console.log(chalk.blue('\n📊 Project State Summary\n'));
      console.log(chalk.bold('Project:'), state.meta.project_name);
      console.log(chalk.bold('Last Updated:'), new Date(state.meta.last_updated).toLocaleString());
      console.log(chalk.bold('Architecture:'), state.architecture.summary);
      console.log(chalk.bold('Tech Stack:'), state.architecture.tech_stack.join(', '));
      console.log('');
      console.log(chalk.bold('Current Task:'));
      console.log('  Goal:', state.current_task.goal);
      console.log('  Status:', state.current_task.status);
      console.log('  Completed:', state.current_task.completed.length, 'items');
      console.log('  Next Steps:', state.current_task.next_steps.length, 'items');
      console.log('');
      console.log(chalk.bold('Git:'));
      console.log('  Branch:', state.git_state.branch);
      console.log('  Uncommitted Files:', state.git_state.uncommitted_files.length);
      console.log('');
      console.log(chalk.bold('Decisions:'), state.decisions.length, 'recorded');
      console.log(chalk.bold('Notes:'), state.context.important_notes.length, 'notes');
      console.log('');
    } catch (error) {
      console.error(chalk.red('❌ No project state found.'));
      console.error(chalk.gray('   Run "save-my-session init" to create one.\n'));
      process.exit(1);
    }
  });

// Install command
program
  .command('install')
  .description('Inject handoff prompts into all detected AI agents (Claude, Gemini, Codex)')
  .action(async () => {
    try {
      const cmd = new InstallCommand();
      await cmd.execute();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Uninstall command
program
  .command('uninstall')
  .description('Remove handoff prompts from all AI agents')
  .action(async () => {
    try {
      const cmd = new UninstallCommand();
      await cmd.execute();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), (error as Error).message);
      process.exit(1);
    }
  });

// Examples command
program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.blue('\n📚 Usage Examples\n'));

    console.log(chalk.bold('1. Initialize project state:'));
    console.log(chalk.gray('   $ save-my-session init\n'));

    console.log(chalk.bold('2. Generate a snapshot:'));
    console.log(chalk.gray('   $ save-my-session snapshot\n'));

    console.log(chalk.bold('3. Record a decision:'));
    console.log(chalk.gray('   $ save-my-session update decision "Use PostgreSQL | Better JSON support"\n'));

    console.log(chalk.bold('4. Mark progress:'));
    console.log(chalk.gray('   $ save-my-session update progress "Completed user authentication"\n'));

    console.log(chalk.bold('5. Add a blocker:'));
    console.log(chalk.gray('   $ save-my-session update blocker "Waiting for API access"\n'));

    console.log(chalk.bold('6. Add a note:'));
    console.log(chalk.gray('   $ save-my-session update note "Remember to update docs"\n'));

    console.log(chalk.bold('7. Generate context for new agent:'));
    console.log(chalk.gray('   $ save-my-session restore --agent "Cursor"\n'));

    console.log(chalk.bold('8. Check current status:'));
    console.log(chalk.gray('   $ save-my-session info\n'));
  });

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
