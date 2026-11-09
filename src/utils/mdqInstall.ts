// Single source of truth for the pinned mdq release (CI reads it from here).
export const MDQ_VERSION = '0.10.0';

const RELEASE_URL = `https://github.com/yshavit/mdq/releases/tag/v${MDQ_VERSION}`;

// Prebuilt assets published upstream for MDQ_VERSION, keyed by `${platform}-${arch}`.
const PREBUILT_ASSETS: Record<string, string> = {
  'linux-x64': 'mdq-linux-x64.tar.gz',
  'win32-x64': 'mdq-windows-x64.zip',
};

/**
 * Platform-aware install hint for the external `mdq` binary.
 * macOS: Homebrew. Platforms with a prebuilt asset: pinned release download.
 * Everything else (e.g. linux-arm64): build from source via cargo.
 */
export function mdqInstallHint(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (platform === 'darwin') {
    return 'Install with: brew install mdq';
  }
  const asset = PREBUILT_ASSETS[`${platform}-${arch}`];
  if (asset) {
    return `Download ${asset} from ${RELEASE_URL}`;
  }
  return `Install with: cargo install mdq --version ${MDQ_VERSION} --locked`;
}
