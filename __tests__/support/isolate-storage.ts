/**
 * Jest global setup: cache and state dir isolation.
 *
 * xray keeps its analysis cache and telemetry sink in the user cache / state
 * dirs, keyed by project root. A suite that runs the CLI (or the library)
 * without its own XDG_CACHE_HOME / XDG_STATE_HOME would otherwise write into
 * the developer's real dirs. Point both at a throwaway dir for the whole run,
 * removed at the end. This runs in the parent process, so it also reaches
 * children spawned without an explicit env (a jest suite's `process.env` is a
 * copy that child processes do not see). A suite that needs specific dirs
 * still sets its own.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-jest-xdg-'));
  process.env.XDG_CACHE_HOME = path.join(root, 'cache');
  process.env.XDG_STATE_HOME = path.join(root, 'state');
  return () => fs.rmSync(root, { recursive: true, force: true });
}
