/**
 * Process-wide root program + theme.
 *
 * Single source for the kit-built root `Command` and its `Theme`; later
 * consumers (TUI, output rendering) import `theme` from here without
 * pulling in command registration.
 */
import { createRootProgram } from './root-options';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json');

export const { program, theme } = createRootProgram(version);
