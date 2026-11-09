// tests/strategies/react.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import ReactStrategy from '../../strategies/react';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ReactStrategy', () => {
  let strategy: ReactStrategy;

  beforeEach(() => {
    strategy = new ReactStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('react');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detection', () => {
    it('should detect React project with react dependency', async () => {
      const fixtureRoot = path.join(__dirname, '../strategy/fixtures/react-project');
      const ctx = new StrategyContextImpl(fixtureRoot);

      const detected = await strategy.detect(ctx);
      expect(detected).toBe(true);
    });

    it('should detect React project with react-dom dependency', async () => {
      const fixtureRoot = path.join(__dirname, '../strategy/fixtures/react-project');
      const ctx = new StrategyContextImpl(fixtureRoot);

      const detected = await strategy.detect(ctx);
      expect(detected).toBe(true);
    });

    it('should detect React with JSX files', async () => {
      const fixtureRoot = path.join(__dirname, '../strategy/fixtures/react-project');
      const ctx = new StrategyContextImpl(fixtureRoot);

      const detected = await strategy.detect(ctx);
      expect(detected).toBe(true);
    });

    it('should detect React with TSX files', async () => {
      const fixtureRoot = path.join(__dirname, '../strategy/fixtures/react-project');
      const ctx = new StrategyContextImpl(fixtureRoot);

      const detected = await strategy.detect(ctx);
      expect(detected).toBe(true);
    });

    it('should not detect non-React project', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-react-'));

      // Create a package.json without React
      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'express': '^4.18.0'
        }
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect with React dev dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-react-dev-'));

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: {
          'react': '^18.2.0'
        }
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('component detection', () => {
    it('should detect function component', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-func-component-'));

      const componentCode = `import React from 'react';

export default function MyComponent() {
  return <div>Hello</div>;
}`;

      fs.writeFileSync(
        path.join(tempDir, 'MyComponent.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'MyComponent.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('MyComponent');
      expect(metadata.metadata?.componentType).toBe('function');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect arrow function component', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-arrow-component-'));

      const componentCode = `import React from 'react';

export const ArrowComponent = () => {
  return <div>Arrow</div>;
}`;

      fs.writeFileSync(
        path.join(tempDir, 'ArrowComponent.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'ArrowComponent.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('ArrowComponent');
      expect(metadata.metadata?.componentType).toBe('function');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect class component', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-class-component-'));

      const componentCode = `import React from 'react';

export class ClassComponent extends React.Component {
  render() {
    return <div>Class</div>;
  }
}`;

      fs.writeFileSync(
        path.join(tempDir, 'ClassComponent.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'ClassComponent.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('ClassComponent');
      expect(metadata.metadata?.componentType).toBe('class');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not tag non-component files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-utils-'));

      const utilCode = `export const formatName = (name: string) => name.toUpperCase();`;

      fs.writeFileSync(
        path.join(tempDir, 'utils.ts'),
        utilCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'utils.ts'), ctx);

      expect(metadata.tags).not.toContain('react:component');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('hook detection', () => {
    it('should detect custom hook with function syntax', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-func-hook-'));

      const hookCode = `import { useState } from 'react';

export function useCounter() {
  const [count, setCount] = useState(0);
  return { count, setCount };
}`;

      fs.writeFileSync(
        path.join(tempDir, 'useCounter.ts'),
        hookCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'useCounter.ts'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:hook']));
      expect(metadata.metadata?.hookName).toBe('useCounter');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect custom hook with arrow function syntax', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-arrow-hook-'));

      const hookCode = `import { useState } from 'react';

export const useToggle = (initialValue: boolean = false) => {
  const [value, setValue] = useState(initialValue);
  const toggle = () => setValue(!value);
  return { value, toggle };
}`;

      fs.writeFileSync(
        path.join(tempDir, 'useToggle.ts'),
        hookCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'useToggle.ts'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:hook']));
      expect(metadata.metadata?.hookName).toBe('useToggle');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not tag non-hook files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-non-hook-'));

      const normalCode = `export const formatUser = (name: string) => name.trim();`;

      fs.writeFileSync(
        path.join(tempDir, 'formatUser.ts'),
        normalCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'formatUser.ts'), ctx);

      expect(metadata.tags).not.toContain('react:hook');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('context detection', () => {
    it('should detect context with createContext', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-context-'));

      const contextCode = `import { createContext } from 'react';

export const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {}
});`;

      fs.writeFileSync(
        path.join(tempDir, 'ThemeContext.ts'),
        contextCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'ThemeContext.ts'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:context']));
      expect(metadata.metadata?.contextName).toBe('ThemeContext');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect context without export', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-context-no-export-'));

      const contextCode = `import { createContext } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);`;

      fs.writeFileSync(
        path.join(tempDir, 'AuthContext.ts'),
        contextCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'AuthContext.ts'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:context']));
      expect(metadata.metadata?.contextName).toBe('AuthContext');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not tag non-context files', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-non-context-'));

      const normalCode = `export const config = { apiUrl: 'https://api.example.com' };`;

      fs.writeFileSync(
        path.join(tempDir, 'config.ts'),
        normalCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'config.ts'), ctx);

      expect(metadata.tags).not.toContain('react:context');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('AST-based detection enhancements', () => {
    it('should detect component with multi-line parameters', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-multiline-'));

      const componentCode = `import React from 'react';

export function MyComponent(
  { name, age }: { name: string; age: number }
) {
  return <div>{name} is {age}</div>;
}`;

      fs.writeFileSync(
        path.join(tempDir, 'MyComponent.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'MyComponent.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('MyComponent');
      expect(metadata.metadata?.componentType).toBe('function');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect component with TypeScript generics', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-generics-'));

      const componentCode = `import React from 'react';

export const GenericComponent = <T extends object>(props: T) => {
  return <div>Generic</div>;
};`;

      fs.writeFileSync(
        path.join(tempDir, 'GenericComponent.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'GenericComponent.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('GenericComponent');
      expect(metadata.metadata?.componentType).toBe('function');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect React.PureComponent', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pure-component-'));

      const componentCode = `import React from 'react';

export class PureComp extends React.PureComponent {
  render() {
    return <div>Pure</div>;
  }
}`;

      fs.writeFileSync(
        path.join(tempDir, 'PureComp.tsx'),
        componentCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'PureComp.tsx'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:component']));
      expect(metadata.metadata?.componentName).toBe('PureComp');
      expect(metadata.metadata?.componentType).toBe('class');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect hook with complex parameters', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-complex-hook-'));

      const hookCode = `import { useState } from 'react';

export const useComplexHook = <T,>(
  initialValue: T,
  options?: { debounce?: number }
) => {
  const [value, setValue] = useState(initialValue);
  return { value, setValue };
};`;

      fs.writeFileSync(
        path.join(tempDir, 'useComplexHook.ts'),
        hookCode
      );

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'useComplexHook.ts'), ctx);

      expect(metadata.tags).toEqual(expect.arrayContaining(['react:hook']));
      expect(metadata.metadata?.hookName).toBe('useComplexHook');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
