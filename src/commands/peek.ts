import chalk from 'chalk';
import { AgentType, findLatestSession, resolveSessionPath, sessionHash, parseSession } from '../transfer/index.js';

export interface PeekOptions {
  from: AgentType;
  cwd: string;
  sessionFile?: string;
  tail: number;
}

const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex'
};

export class PeekCommand {
  async execute(options: PeekOptions): Promise<void> {
    const { from, cwd, tail } = options;

    let sessionPath: string;
    if (options.sessionFile) {
      sessionPath = await resolveSessionPath(options.sessionFile, from, cwd);
    } else {
      const found = await findLatestSession(cwd, from);
      if (!found) {
        throw new Error(`No ${AGENT_LABELS[from]} session found for this project`);
      }
      sessionPath = found.filePath;
    }

    const session = await parseSession(sessionPath, from);
    const total = session.messages.length;
    const start = Math.max(0, total - tail);
    const slice = session.messages.slice(start);

    const hash = sessionHash(sessionPath);
    console.log('');
    console.log(`  ${chalk.bold(`${AGENT_LABELS[from]} session`)}  ${chalk.yellow(hash)}`);
    console.log(chalk.gray(`  ${sessionPath}`));
    console.log(chalk.gray(`  Showing ${slice.length} of ${total} messages` +
      (start > 0 ? ` (skipped first ${start})` : '')));
    console.log('');

    for (const msg of slice) {
      const roleTag = msg.role === 'user'
        ? chalk.bold.cyan('❯ user')
        : chalk.bold.magenta('✦ assistant');
      const ts = msg.timestamp ? chalk.gray(`  ${formatTime(msg.timestamp)}`) : '';
      console.log(`${roleTag}${ts}`);
      console.log(indent(msg.text.trim(), '  '));
      console.log('');
    }
  }
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map(l => prefix + l).join('\n');
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
