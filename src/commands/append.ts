import chalk from 'chalk';
import { AgentType, findLatestSession, resolveSessionPath, parseSession, appendToSession } from '../transfer/index.js';

export interface AppendOptions {
  from: AgentType;
  to: AgentType;
  cwd: string;
  sessionFile?: string; // source session hash or path (optional — defaults to latest)
  target: string;       // target session hash or path (required)
  force?: boolean;      // bypass content dedup
}

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex'
};

export class AppendCommand {
  async execute(options: AppendOptions): Promise<void> {
    const { from, to, cwd } = options;

    if (from === to) {
      throw new Error('Source and target agent cannot be the same');
    }

    console.log(`\n📎 Appending session: ${AGENT_LABELS[from]} → ${AGENT_LABELS[to]}`);
    console.log(`   Project: ${cwd}\n`);

    // Resolve source
    let sessionPath: string;
    if (options.sessionFile) {
      sessionPath = await resolveSessionPath(options.sessionFile, from, cwd);
      console.log(`   Source: ${sessionPath}`);
    } else {
      console.log(`🔍 Finding latest ${AGENT_LABELS[from]} session...`);
      const found = await findLatestSession(cwd, from);
      if (!found) {
        throw new Error(`No ${AGENT_LABELS[from]} session found for this project`);
      }
      sessionPath = found.filePath;
      console.log(`   Found: ${chalk.bold(found.hash)}  ${found.filePath}\n`);
    }

    // Resolve target (the --target value is a hash/path in the target agent's namespace)
    const targetPath = await resolveSessionPath(options.target, to, cwd);
    console.log(`   Target: ${targetPath}\n`);

    // Parse source
    console.log(`📖 Parsing ${AGENT_LABELS[from]} session...`);
    const session = await parseSession(sessionPath, from);
    console.log(`   ${session.messages.length} messages extracted`);

    if (session.messages.length === 0) {
      throw new Error('Session has no messages to append');
    }

    const userMsgs = session.messages.filter(m => m.role === 'user');
    const assistantMsgs = session.messages.filter(m => m.role === 'assistant');
    console.log(`   ${userMsgs.length} user messages, ${assistantMsgs.length} assistant messages\n`);

    // Append
    console.log(`📎 Appending to existing ${AGENT_LABELS[to]} session...`);
    const { appended } = await appendToSession(session, targetPath, to, options.force);

    if (appended === 0) {
      console.log('   No new messages to append (every source message already exists in the target).\n');
      return;
    }

    console.log(`   Appended ${appended} messages to: ${targetPath}\n`);
    console.log(chalk.green('✅ Append complete!\n'));
    console.log(`The ${AGENT_LABELS[from]} conversation has been merged into your ${AGENT_LABELS[to]} session.\n`);
  }
}
