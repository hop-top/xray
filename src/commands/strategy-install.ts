import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../lib/logger';
import {
  PROJECT_STRATEGIES_ENV,
  StrategyLoader,
  projectStrategiesAllowed,
  StrategyPackage,
  readStrategyPackage,
} from '../lib/strategy/loader';

const FILE_STRATEGY = /\.(ts|js|yml|yaml)$/;
const DECLARATIVE_FILE = /\.ya?ml$/;

/** Run npm without a shell; `--` ends option parsing so a source is never a flag. */
function npm(args: string[], stdio: 'inherit' | 'capture'): string {
  const out = execFileSync('npm', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: stdio === 'inherit' ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'inherit'],
  });
  return out ?? '';
}

/**
 * Fetch `spec` with `npm pack --ignore-scripts` into a private temp
 * directory, unpack it there and validate it as a strategy package, all
 * before the project is touched. Returns the package name and the
 * validated manifest. The temp directory is always removed.
 */
function validateBeforeInstall(spec: string): { name: string; pkg: StrategyPackage } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-install-'));
  try {
    let packed: any;
    try {
      const out = npm(['pack', '--ignore-scripts', '--json', '--pack-destination', tmp, '--', spec], 'capture');
      packed = JSON.parse(out)?.[0];
    } catch {
      throw new Error(`npm could not fetch ${spec}`);
    }
    const name = packed?.name;
    if (typeof name !== 'string' || name === '' || typeof packed?.filename !== 'string') {
      throw new Error(`cannot determine the package name of ${spec}`);
    }
    const tarball = path.join(tmp, path.basename(packed.filename));
    const members = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' }).split('\n').filter(Boolean);
    for (const m of members) {
      if (path.isAbsolute(m) || m.split(/[\\/]/).includes('..')) {
        throw new Error(`unsafe path in package archive: ${m}`);
      }
    }
    const dest = path.join(tmp, 'unpacked');
    fs.mkdirSync(dest);
    execFileSync('tar', ['-xzf', tarball, '-C', dest], { stdio: ['ignore', 'ignore', 'inherit'] });
    // npm archives hold a single top-level directory, `package/`.
    const pkg = readStrategyPackage(path.join(dest, 'package'));
    return { name, pkg };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** A local strategy file is read, not installed; say so. */
async function readLocalFile(loader: StrategyLoader, file: string): Promise<void> {
  const declarative = DECLARATIVE_FILE.test(file);
  if (!declarative && !projectStrategiesAllowed()) {
    Logger.warn(
      `${file} runs code and was not loaded: set ${PROJECT_STRATEGIES_ENV}=1 to load it ` +
      `(only for code you trust). Nothing was installed or copied.`
    );
    return;
  }
  const strategy = await loader.loadStrategy(file);
  Logger.success(`Read strategy ${strategy.name} v${strategy.version} from ${file}.`);
  Logger.warn(
    `Nothing was installed or copied. To use it, put the file in .xray/strategies/ ` +
    `or in a directory listed in XRAY_STRATEGIES_PATH.`
  );
}

/**
 * Install a strategy from a path or npm source.
 *
 * - A local `.yml`/`.yaml`/`.js`/`.ts` file is only read (see above).
 * - Anything else goes to `npm install` in the working directory (no
 *   shell). The real package name comes from npm, never from the source
 *   text. The package is fetched and validated in a temp directory first
 *   (`xray-strategy` with a name and an entry inside the package); only a
 *   valid one is installed, so a rejected package changes nothing.
 *
 * Throws on failure; the caller reports it and exits non-zero.
 */
export async function installStrategy(source: string, loader: StrategyLoader): Promise<void> {
  let spec = source;
  if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
    const absolute = path.resolve(source);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Path does not exist: ${absolute}`);
    }
    if (fs.statSync(absolute).isFile() && FILE_STRATEGY.test(absolute)) {
      return readLocalFile(loader, absolute);
    }
    spec = absolute;
  }

  const checked = validateBeforeInstall(spec);
  const name = checked.name;
  const modules = path.join(process.cwd(), 'node_modules');
  const pkgDir = path.resolve(modules, ...name.split('/'));
  if (path.relative(modules, pkgDir).startsWith('..')) {
    throw new Error(`unsafe package name: ${name}`);
  }
  let before = '';
  try {
    before = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')).version;
  } catch {
    // not installed yet
  }

  Logger.warn(`\nInstalling from npm: ${source}`);
  if (before && before !== checked.pkg.version) {
    Logger.warn(`${name} ${before} is already installed; npm updates it to ${checked.pkg.version}.`);
  }
  try {
    npm(['install', '--', spec], 'inherit');
  } catch {
    throw new Error(`npm install failed for ${source}`);
  }

  // The installed copy is what npm unpacked from the same archive.
  const pkg = readStrategyPackage(pkgDir);
  const useCode = !pkg.declarative && projectStrategiesAllowed();
  if (pkg.declarative || useCode) {
    let strategy;
    try {
      strategy = await loader.loadStrategy(pkg.entryPath);
    } catch (err: any) {
      throw new Error(`${name} is installed but failed to load: ${err.message}`);
    }
    Logger.success(`\nStrategy installed: ${strategy.name} v${strategy.version} (${name})`);
    if (useCode) {
      Logger.warn(`${name} runs code and was loaded because ${PROJECT_STRATEGIES_ENV}=1 is set.`);
    }
  } else {
    Logger.success(`\nStrategy package installed: ${pkg.strategyName} v${pkg.version} (${name})`);
    Logger.warn(
      `It runs code and was not loaded. Set ${PROJECT_STRATEGIES_ENV}=1 to load it ` +
      `(only for code you trust).`
    );
  }
  if (!path.basename(name).startsWith('xray-strategy-') || name.startsWith('@')) {
    Logger.warn(
      `xray finds code strategy packages only as top-level node_modules/xray-strategy-*; ` +
      `${name} will not be discovered.`
    );
  }
}
