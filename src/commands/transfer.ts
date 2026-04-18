import chalk from 'chalk';
import path from 'path';
import { AgentType, findLatestSession, findAllSessions, parseSession, writeSession, appendToSession, FoundSession } from '../transfer/index.js';

export interface TransferOptions {
  from: AgentType;
  to?: AgentType;
  cwd: string;
  sessionFile?: string;
  list?: boolean;
  append?: string; // path to target session to append into
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
      await this.listSessions(from, cwd);
      return;
    }

    const to = options.to!;

    if (from === to) {
      throw new Error('Source and target agent cannot be the same');
    }

    console.log(`\n🔄 Transferring session: ${AGENT_LABELS[from]} → ${AGENT_LABELS[to]}`);
    console.log(`   Project: ${cwd}\n`);

    // 1. Find session
    let sessionPath = options.sessionFile;

    if (!sessionPath) {
      console.log(`🔍 Finding latest ${AGENT_LABELS[from]} session...`);
      const found = await findLatestSession(cwd, from);

      if (!found) {
        throw new Error(`No ${AGENT_LABELS[from]} session found for this project`);
      }

      sessionPath = found.filePath;
      console.log(`   Found: ${sessionPath}`);
      console.log(`   Last modified: ${found.lastModified.toLocaleString()}\n`);
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
      const { appended } = await appendToSession(session, options.append, to);

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

  private async listSessions(agent: AgentType, cwd: string): Promise<void> {
    console.log(`\n📋 ${AGENT_LABELS[agent]} sessions for: ${cwd}\n`);

    const sessions = await findAllSessions(cwd, agent);

    if (sessions.length === 0) {
      console.log('   No sessions found.\n');
      console.log(chalk.gray(`   Searched project: ${cwd}`));
      console.log(chalk.gray('   If that is not your project root, re-run from the correct directory'));
      console.log(chalk.gray('   or pass --cwd <path> explicitly:'));
      console.log(chalk.gray(`   save-my-session transfer --from ${agent} --list --cwd <project-root>\n`));
      return;
    }

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const tag = i === 0 ? chalk.green(' (latest)') : '';
      const preview = await this.getSessionPreview(s, agent);

      console.log(`  ${chalk.bold(`#${i + 1}`)}${tag}`);
      if (preview.lastUserMessage) {
        const truncated = preview.lastUserMessage.length > 60
          ? preview.lastUserMessage.slice(0, 60) + '...'
          : preview.lastUserMessage;
        console.log(`     "${truncated}"`);
      }
      console.log(`     ${preview.userCount} user / ${preview.assistantCount} assistant messages`);
      console.log(`     ${preview.startTime} → ${preview.endTime}`);
      console.log(`     ${chalk.gray(s.filePath)}`);
      console.log('');
    }

    console.log(chalk.gray('  Use --session <path> to transfer a specific session:'));
    console.log(chalk.gray(`  save-my-session transfer --from ${agent} --to <target> --session <path>\n`));
  }

  private async getSessionPreview(s: FoundSession, agent: AgentType): Promise<{
    lastUserMessage: string;
    userCount: number;
    assistantCount: number;
    startTime: string;
    endTime: string;
  }> {
    try {
      const session = await parseSession(s.filePath, agent);
      const userMsgs = session.messages.filter(m => m.role === 'user');
      const assistantMsgs = session.messages.filter(m => m.role === 'assistant');

      const lastUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;
      const firstMsg = session.messages[0];
      const lastMsg = session.messages[session.messages.length - 1];

      const formatTime = (ts: string) => {
        if (!ts) return '?';
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      };

      return {
        lastUserMessage: lastUser?.text?.replace(/\n/g, ' ').trim() || '',
        userCount: userMsgs.length,
        assistantCount: assistantMsgs.length,
        startTime: formatTime(firstMsg?.timestamp || session.startTime),
        endTime: formatTime(lastMsg?.timestamp || session.lastUpdated)
      };
    } catch {
      return { lastUserMessage: '', userCount: 0, assistantCount: 0, startTime: '?', endTime: '?' };
    }
  }
}
