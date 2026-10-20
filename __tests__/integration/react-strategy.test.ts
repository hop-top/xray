// tests/integration/react-strategy.test.ts
// Note: execSync is used in controlled test environment (safe as per plan)
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CLI_PATH = path.join(__dirname, '../../bin/cli.js');

describe('React Strategy Integration', () => {
  let testRoot: string;

  beforeAll(() => {
    // Create comprehensive React test project
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'react-integration-'));

    // Create package.json with React
    fs.writeFileSync(
      path.join(testRoot, 'package.json'),
      JSON.stringify({
        name: 'test-react-integration',
        version: '1.0.0',
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        devDependencies: {
          '@types/react': '^18.2.0'
        }
      }, null, 2)
    );

    // Create directory structure
    fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'src/components'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'src/hooks'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'src/contexts'), { recursive: true });

    // Create function components
    fs.writeFileSync(
      path.join(testRoot, 'src/components/Button.tsx'),
      `import React from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
}

export function Button({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/components/Input.tsx'),
      `import React from 'react';

export const Input = (props: { value: string; onChange: (v: string) => void }) => {
  return <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />;
};`
    );

    // Create class components
    fs.writeFileSync(
      path.join(testRoot, 'src/components/Card.tsx'),
      `import React from 'react';

export class Card extends React.Component {
  render() {
    return <div className="card">{this.props.children}</div>;
  }
}`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/components/List.tsx'),
      `import React from 'react';

export class List extends React.PureComponent {
  render() {
    return <ul>{this.props.children}</ul>;
  }
}`
    );

    // Create component with multi-line params
    fs.writeFileSync(
      path.join(testRoot, 'src/components/ComplexForm.tsx'),
      `import React from 'react';

export function ComplexForm(
  {
    title,
    onSubmit,
    children
  }: {
    title: string;
    onSubmit: () => void;
    children: React.ReactNode;
  }
) {
  return <form onSubmit={onSubmit}><h2>{title}</h2>{children}</form>;
}`
    );

    // Create component with generics
    fs.writeFileSync(
      path.join(testRoot, 'src/components/GenericList.tsx'),
      `import React from 'react';

export const GenericList = <T extends { id: string }>(props: { items: T[] }) => {
  return <div>{props.items.map(item => <div key={item.id}>{item.id}</div>)}</div>;
};`
    );

    // Create custom hooks
    fs.writeFileSync(
      path.join(testRoot, 'src/hooks/useCounter.ts'),
      `import { useState } from 'react';

export function useCounter(initialValue: number = 0) {
  const [count, setCount] = useState(initialValue);
  const increment = () => setCount(c => c + 1);
  const decrement = () => setCount(c => c - 1);
  return { count, increment, decrement };
}`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/hooks/useToggle.ts'),
      `import { useState, useCallback } from 'react';

export const useToggle = (initialValue: boolean = false) => {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  return { value, toggle };
};`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/hooks/useLocalStorage.ts'),
      `import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored) {
      setValue(JSON.parse(stored));
    }
  }, [key]);

  return { value, setValue };
}`
    );

    // Create contexts
    fs.writeFileSync(
      path.join(testRoot, 'src/contexts/ThemeContext.ts'),
      `import { createContext } from 'react';

export const ThemeContext = createContext({
  theme: 'light' as 'light' | 'dark',
  toggleTheme: () => {}
});`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/contexts/AuthContext.ts'),
      `import { createContext } from 'react';

interface AuthContextType {
  user: any;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);`
    );

    fs.writeFileSync(
      path.join(testRoot, 'src/contexts/NotificationContext.ts'),
      `import { createContext } from 'react';

export const NotificationContext = createContext({
  notifications: [] as string[],
  addNotification: (message: string) => {}
});`
    );
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('Strategy Detection', () => {
    it('should detect React strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy detect -p ${testRoot} 2>&1`).toString();

      expect(output).toContain('Detected Strategies:');
      expect(output).toContain('react');
      expect(output).toContain('v0.1.0');
    });

    it('should list React as available strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();

      expect(output).toContain('Available Strategies:');
      expect(output).toContain('react');
      expect(output).toContain('v0.1.0');
    });
  });

  describe('Component Detection', () => {
    it('should find all React components', () => {
      const output = execSync(`node ${CLI_PATH} react components -p ${testRoot}`).toString();

      expect(output).toContain('React components:');

      // Function components
      expect(output).toContain('Button');
      expect(output).toContain('Input');
      expect(output).toContain('ComplexForm');
      expect(output).toContain('GenericList');

      // Class components
      expect(output).toContain('Card');
      expect(output).toContain('List');

      // Total count
      expect(output).toContain('Total: 6');
    });

  });

  describe('Hook Detection', () => {
    it('should find all custom hooks', () => {
      const output = execSync(`node ${CLI_PATH} react hooks -p ${testRoot}`).toString();

      expect(output).toContain('React hooks:');
      expect(output).toContain('useCounter');
      expect(output).toContain('useToggle');
      expect(output).toContain('useLocalStorage');
      expect(output).toContain('Total: 3');
    });

  });

  describe('Context Detection', () => {
    it('should find all contexts', () => {
      const output = execSync(`node ${CLI_PATH} react contexts -p ${testRoot}`).toString();

      expect(output).toContain('React contexts:');
      expect(output).toContain('ThemeContext');
      expect(output).toContain('AuthContext');
      expect(output).toContain('NotificationContext');
      expect(output).toContain('Total: 3');
    });

  });

  describe('Edge Cases', () => {
    it('should handle project without React gracefully', () => {
      const nonReactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-react-'));

      fs.writeFileSync(
        path.join(nonReactDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: { express: '^4.0.0' } })
      );

      try {
        // Non-detected strategies warn and report nothing (exit 0) instead of failing.
        const output = execSync(`node ${CLI_PATH} react components -p ${nonReactDir} 2>&1`).toString();
        expect(output).toContain('Extension "react" did not detect an applicable project');
        expect(output).toContain('Total: 0');
      } finally {
        fs.rmSync(nonReactDir, { recursive: true, force: true });
      }
    });

    it('should handle unknown command gracefully', () => {
      // Commander rejects unknown subcommands of a registered strategy (af1af00).
      try {
        execSync(`node ${CLI_PATH} react unknown -p ${testRoot} 2>&1`);
        throw new Error('Expected a non-zero exit');
      } catch (e: any) {
        const output = (e.stdout ?? e.stderr ?? '').toString();
        expect(output).toContain("unknown command 'unknown'");
      }
    });
  });

  describe('Complex Patterns', () => {
    it('should detect components with multi-line parameters', () => {
      const output = execSync(`node ${CLI_PATH} react components -p ${testRoot}`).toString();
      expect(output).toContain('ComplexForm');
    });

    it('should detect components with TypeScript generics', () => {
      const output = execSync(`node ${CLI_PATH} react components -p ${testRoot}`).toString();
      expect(output).toContain('GenericList');
    });

    it('should detect React.PureComponent', () => {
      const output = execSync(`node ${CLI_PATH} react components -p ${testRoot}`).toString();
      expect(output).toContain('List');
    });

    it('should detect hooks with generic types', () => {
      const output = execSync(`node ${CLI_PATH} react hooks -p ${testRoot}`).toString();
      expect(output).toContain('useLocalStorage');
    });
  });
});
