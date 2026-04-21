import chalk from 'chalk';
import { AgentType, findAllSessions, parseSession, FoundSession } from '../transfer/index.js';

export interface ListOptions {
  from: AgentType;
  cwd: string;
}

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex'
};

export class ListCommand {
  async execute(options: ListOptions): Promise<void> {
    const { from: agent, cwd } = options;

    console.log(`\n📋 ${AGENT_LABELS[agent]} sessions for: ${cwd}\n`);

    const sessions = await findAllSessions(cwd, agent);

    if (sessions.length === 0) {
      console.log('   No sessions found.\n');
      console.log(chalk.gray(`   Searched project: ${cwd}`));
      console.log(chalk.gray('   If that is not your project root, re-run from the correct directory'));
      console.log(chalk.gray('   or pass --cwd <path> explicitly:'));
      console.log(chalk.gray(`   save-my-session list --from ${agent} --cwd <project-root>\n`));
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
      const rightPad = W - 1 - displayWidth(labelText) - 7 - 2; // 7 = hash len, 2 = spaces
      console.log(`  │ ${labelColored}${' '.repeat(Math.max(1, rightPad))}${hashTag} │`);
      console.log(chalk.gray(`  ├${hr}┤`));

      if (preview.lastUserMessage) {
        const inner = W - 5;
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
