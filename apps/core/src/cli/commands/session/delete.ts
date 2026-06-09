import type { CommandModule } from 'yargs';
import { deleteSession } from '../../utils/sessions.js';

interface DeleteArgs {
  sessionId: string;
}

export const deleteCommand: CommandModule<object, DeleteArgs> = {
  command: 'delete <sessionId>',
  describe: 'Delete a session',
  builder: (yargs) =>
    yargs.positional('sessionId', { type: 'string', demandOption: true }),
  handler: async (argv) => {
    const success = deleteSession(argv.sessionId);

    if (!success) {
      console.error(`Session "${argv.sessionId}" not found`);
      process.exit(1);
    }

    console.log(`✓ Session "${argv.sessionId}" deleted`);
  },
};