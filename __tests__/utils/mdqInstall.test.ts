import { MDQ_VERSION, mdqInstallHint } from '../../src/utils/mdqInstall';

describe('mdqInstallHint', () => {
  const cargo = `cargo install mdq --version ${MDQ_VERSION} --locked`;
  const release = `https://github.com/yshavit/mdq/releases/tag/v${MDQ_VERSION}`;

  it('pins a semver version', () => {
    expect(MDQ_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
  ])('%s/%s -> brew', (platform, arch) => {
    const hint = mdqInstallHint(platform as NodeJS.Platform, arch);
    expect(hint).toContain('brew install mdq');
    expect(hint).not.toContain('cargo');
  });

  it.each([
    ['linux', 'x64', 'mdq-linux-x64.tar.gz'],
    ['win32', 'x64', 'mdq-windows-x64.zip'],
  ])('%s/%s -> prebuilt asset', (platform, arch, asset) => {
    const hint = mdqInstallHint(platform as NodeJS.Platform, arch);
    expect(hint).toContain(release);
    expect(hint).toContain(asset);
    expect(hint).not.toContain('brew');
  });

  it.each([
    ['linux', 'arm64'],
    ['win32', 'arm64'],
    ['freebsd', 'x64'],
    ['linux', 'ia32'],
  ])('%s/%s -> cargo (no prebuilt asset)', (platform, arch) => {
    const hint = mdqInstallHint(platform as NodeJS.Platform, arch);
    expect(hint).toContain(cargo);
    expect(hint).not.toContain('brew');
    expect(hint).not.toContain('releases');
  });

  it('defaults to the running platform', () => {
    expect(mdqInstallHint()).toBe(mdqInstallHint(process.platform, process.arch));
  });
});
