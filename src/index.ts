#!/usr/bin/env node
import { registerCommands } from './commands';

// Initialize and register all commands (async for alias registration)
async function main() {
  const program = await registerCommands();

  // Handle CLI execution
  if (require.main === module) {
    program.parse();
  } else {
    // For when module is required (like from bin/xray)
    // Parse the arguments that were passed to the process
    program.parse(process.argv);
  }
}

// Run the CLI
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export for testing
export { registerCommands };