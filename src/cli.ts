#!/usr/bin/env node

/**
 * save-my-session CLI
 * Transfer coding sessions between AI agents (Claude Code, Gemini CLI, Codex)
 */

import { Command } from 'commander';
import { InstallCommand, UninstallCommand } from './commands/install.js';
import { TransferCommand } from './commands/transfer.js';
import { AgentType } from './transfer/types.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('save-my-session')
  .description('Transfer coding sessions between AI agents (Claude Code, Gemini CLI, Codex)')
  .version('0.1.0');

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

program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(chalk.blue('\n📚 Usage Examples\n'));

    console.log(chalk.bold('1. Install handoff prompts into each agent:'));
    console.log(chalk.gray('   $ save-my-session install\n'));

    console.log(chalk.bold('2. List Claude sessions for the current project:'));
    console.log(chalk.gray('   $ save-my-session transfer --from claude --list\n'));

    console.log(chalk.bold('3. Transfer the latest Claude session to Gemini:'));
    console.log(chalk.gray('   $ save-my-session transfer --from claude --to gemini\n'));

    console.log(chalk.bold('4. Transfer a specific session file:'));
    console.log(chalk.gray('   $ save-my-session transfer --from gemini --to codex --session <path>\n'));

    console.log(chalk.bold('5. Merge changes back into an existing session:'));
    console.log(chalk.gray('   $ save-my-session transfer --from gemini --to claude --append <target-session>\n'));

    console.log(chalk.bold('6. Remove the handoff prompts:'));
    console.log(chalk.gray('   $ save-my-session uninstall\n'));
  });

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
