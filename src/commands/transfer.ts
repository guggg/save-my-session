import chalk from 'chalk';
import path from 'path';
import { AgentType, findLatestSession, findAllSessions, resolveSessionPath, parseSession, writeSession, appendToSession, FoundSession } from '../transfer/index.js';

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

    const W = 72;
    const hr = '─'.repeat(W);

    // Returns the display width of a string, counting CJK chars as 2 columns.
    const displayWidth = (s: string) => [...s].reduce((n, c) => {
      const cp = c.codePointAt(0) ?? 0;
      const wide = (cp >= 0x1100 && cp <= 0xFFEF) || (cp >= 0x20000 && cp <= 0x2FA1F);
      return n + (wide ? 2 : 1);
    }, 0);

    const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - displayWidth(s)));

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const isLatest = i === 0;
      const preview = await this.getSessionPreview(s, agent);

      const labelText = isLatest ? `#${i + 1} ★ latest` : `#${i + 1}`;
      const labelColored = isLatest ? chalk.bold.green(labelText) : chalk.bold(labelText);
      const hashTag = chalk.yellow(s.hash);

      console.log(chalk.gray(`  ┌${hr}┐`));
      // label on left, hash on right
      const rightPad = W - 1 - displayWidth(labelText) - 7 - 2; // 7 = hash len, 2 = spaces
      console.log(`  │ ${labelColored}${' '.repeat(Math.max(1, rightPad))}${hashTag} │`);
      console.log(chalk.gray(`  ├${hr}┤`));

      if (preview.lastUserMessage) {
        const inner = W - 5; // "💬 " prefix (emoji=2, space=1) + trailing space
        let truncated = preview.lastUserMessage;
        while (displayWidth(truncated) > inner) {
          truncated = [...truncated].slice(0, -1).join('');
        }
        if (truncated !== preview.lastUserMessage) truncated += '…';
        console.log(`  │ 💬 ${pad(truncated, inner)} │`);
      }

      const msgLine = `💌 ${preview.userCount} user / ${preview.assistantCount} assistant`;
      const timeLine = `🕐 ${preview.startTime} → ${preview.endTime}`;
      console.log(`  │ ${pad(msgLine, W - 2)} │`);
      console.log(`  │ ${pad(timeLine, W - 2)} │`);

      console.log(chalk.gray(`  └${hr}┘`));
      console.log('');
    }

    console.log(chalk.gray('  Use --session <hash> to transfer a specific session:'));
    console.log(chalk.gray(`  save-my-session transfer --from ${agent} --to <target> --session <hash>\n`));
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
