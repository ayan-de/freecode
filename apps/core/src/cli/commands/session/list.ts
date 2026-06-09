import type { CommandModule } from 'yargs';
import { readSessionsDir } from '../../utils/sessions.js';

interface ListArgs {
  project?: string;
}

// ANSI color codes
const yellow = '\x1b[33m';
const reset = '\x1b[0m';

export const listCommand: CommandModule<object, ListArgs> = {
  command: 'list',
  describe: 'List sessions',
  builder: (yargs) =>
    yargs.option('project', {
      type: 'string',
      describe: 'Filter by project path',
    }),
  handler: async (argv) => {
    const sessions = readSessionsDir();

    // Filter by project if specified
    const filtered = argv.project
      ? sessions.filter(s => s.projectPath.includes(argv.project!))
      : sessions;

    if (filtered.length === 0) {
      console.log('\n  No sessions found.\n');
      return;
    }

    console.log('\n  Sessions:\n');
    for (const session of filtered) {
      const title = session.title || '(no title)';
      const date = new Date(session.lastTurnAt).toLocaleString();
      console.log(`  ${yellow}${session.id}${reset}  ${title}`);
      console.log(`           ${session.status} · ${session.turnCount} turns · ${date}\n`);
    }
  },
};