#!/usr/bin/env node
import { registerCommands } from './commands';

// Initialize and register all commands
const program = registerCommands();

// Handle CLI execution
if (require.main === module) {
  program.parse();
} else {
  // For when module is required (like from bin/xray)
  // Parse the arguments that were passed to the process
  program.parse(process.argv);
}

export { program };