import * as fs from 'fs';
import * as path from 'path';
import { saveConfig } from '../../src/lib/config';
import { XrayConfig } from '../../src/types/xray-config';

describe('saveConfig', () => {
  const testDir = path.join(__dirname, '../fixtures/config-test');
  const testConfigPath = path.join(testDir, '.xrayrc.json');

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    // Clean up test config if exists
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  it('should save config to .xrayrc.json with pretty formatting', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      aliases: {
        comp: 'react components',
        routes: 'express routes'
      }
    };

    saveConfig(config, testConfigPath);

    expect(fs.existsSync(testConfigPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
    expect(saved).toEqual(config);
  });

  it('should use current directory if no path provided', () => {
    const config: XrayConfig = {
      paths: ['./src']
    };

    const originalCwd = process.cwd();
    process.chdir(testDir);

    try {
      saveConfig(config);
      expect(fs.existsSync(path.join(testDir, '.xrayrc.json'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (fs.existsSync(path.join(testDir, '.xrayrc.json'))) {
        fs.unlinkSync(path.join(testDir, '.xrayrc.json'));
      }
    }
  });

  it('should pretty print with 2-space indent', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      aliases: {
        comp: 'react components'
      }
    };

    saveConfig(config, testConfigPath);

    const content = fs.readFileSync(testConfigPath, 'utf-8');
    expect(content).toContain('{\n  "paths"');
    expect(content).toContain('  "aliases"');
  });
});
