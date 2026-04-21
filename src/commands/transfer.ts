import chalk from 'chalk';
import path from 'path';
import { AgentType, findLatestSession, resolveSessionPath, parseSession, writeSession, appendToSession } from '../transfer/index.js';
import { ListCommand } from './list.js';

export interface TransferOptions {
  from: AgentType;
  to?: AgentType;
  cwd: string;
  sessionFile?: string;
  list?: boolean;
  append?: string; // path to target session to append into
  force?: boolean; // skip timestamp filter when appending
}

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex'
};

export class TransferCommand {
  async execute(options: TransferOptions): Promise<void> {
    const { from, cwd } = options;

    if (options.list) {
      console.log(chalk.yellow('⚠️  --list on "transfer" is deprecated. Use: save-my-session list --from ' + from));
      await new ListCommand().execute({ from, cwd });
      return;
    }

    const to = options.to!;

    if (from === to) {
      throw new Error('Source and target agent cannot be the same');
    }

    console.log(`\n🔄 Transferring session: ${AGENT_LABELS[from]} → ${AGENT_LABELS[to]}`);
    console.log(`   Project: ${cwd}\n`);

    // 1. Find session
    let sessionPath: string;

    if (options.sessionFile) {
      sessionPath = await resolveSessionPath(options.sessionFile, from, cwd);
      console.log(`   Session: ${sessionPath}`);
    } else {
      console.log(`🔍 Finding latest ${AGENT_LABELS[from]} session...`);
      const found = await findLatestSession(cwd, from);

      if (!found) {
        throw new Error(`No ${AGENT_LABELS[from]} session found for this project`);
      }

      sessionPath = found.filePath;
      console.log(`   Found: ${chalk.bold(found.hash)}  ${found.filePath}`);
      console.log(`   Last modified: ${found.lastModified.toLocaleString()}\n`);
    }

    // Resolve --append target (may also be a hash)
    if (options.append) {
      options.append = await resolveSessionPath(options.append, to, cwd);
    }

    // 2. Parse session
    console.log(`📖 Parsing ${AGENT_LABELS[from]} session...`);
    const session = await parseSession(sessionPath, from);
    console.log(`   ${session.messages.length} messages extracted`);

    if (session.messages.length === 0) {
      throw new Error('Session has no messages to transfer');
    }

    const userMsgs = session.messages.filter(m => m.role === 'user');
    const assistantMsgs = session.messages.filter(m => m.role === 'assistant');
    console.log(`   ${userMsgs.length} user messages, ${assistantMsgs.length} assistant messages\n`);

    // 3. Write or append
    if (options.append) {
      console.log(`📎 Appending to existing ${AGENT_LABELS[to]} session...`);
      const { appended } = await appendToSession(session, options.append, to, options.force);

      if (appended === 0) {
        console.log('   No new messages to append (all messages are older than the target session).\n');
      } else {
        console.log(`   Appended ${appended} messages to: ${options.append}\n`);
        console.log(chalk.green('✅ Append complete!\n'));
        console.log(`The ${AGENT_LABELS[from]} conversation has been merged into your ${AGENT_LABELS[to]} session.\n`);
      }
    } else {
      console.log(`✍️  Writing ${AGENT_LABELS[to]} session...`);
      const outputPath = await writeSession(session, to, cwd);
      console.log(`   Saved to: ${outputPath}\n`);

      console.log(chalk.green('✅ Transfer complete!\n'));
      console.log(`Next: open ${AGENT_LABELS[to]} in this project directory, and it should see the transferred session.`);
      console.log(`The session contains your full conversation history from ${AGENT_LABELS[from]}.\n`);
    }
  }

}
