// tests/strategies/go-cli.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import GoCliStrategy from '../../strategies/go-cli';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('GoCliStrategy', () => {
  let strategy: GoCliStrategy;

  beforeEach(() => {
    strategy = new GoCliStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('go-cli');
      expect(strategy.version).toBe('0.2.0');
    });
  });

  describe('detection', () => {
    it('should detect Go CLI project with Cobra dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cobra-'));

      const goMod = `module example.com/mycli

go 1.21

require (
    github.com/spf13/cobra v1.8.0
)`;

      fs.writeFileSync(path.join(tempDir, 'go.mod'), goMod);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Go CLI project with urfave/cli dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-urfave-'));

      const goMod = `module example.com/mycli

go 1.21

require (
    github.com/urfave/cli/v2 v2.27.0
)`;

      fs.writeFileSync(path.join(tempDir, 'go.mod'), goMod);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Go CLI with main.go and flag package', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-flag-'));

      const mainGo = `package main

import (
    "flag"
    "fmt"
)

func main() {
    verbose := flag.Bool("verbose", false, "verbose output")
    flag.Parse()
    fmt.Println(*verbose)
}`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Go CLI with cmd/ directory structure', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmd-'));

      fs.mkdirSync(path.join(tempDir, 'cmd'));
      fs.writeFileSync(
        path.join(tempDir, 'cmd', 'root.go'),
        'package cmd\n\nvar rootCmd = &cobra.Command{}'
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not detect non-CLI Go project', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-cli-'));

      const goMod = `module example.com/mylib

go 1.21

require (
    github.com/gorilla/mux v1.8.0
)`;

      fs.writeFileSync(path.join(tempDir, 'go.mod'), goMod);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect with cobra import in Go files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cobra-import-'));

      const cmdGo = `package cmd

import "github.com/spf13/cobra"

var rootCmd = &cobra.Command{
    Use: "myapp",
}`;

      fs.writeFileSync(path.join(tempDir, 'cmd.go'), cmdGo);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
