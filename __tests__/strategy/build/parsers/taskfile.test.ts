// __tests__/strategy/build/parsers/taskfile.test.ts
import { parseTaskfile, taskTool } from '../../../../src/lib/strategy/build/parsers/taskfile';

describe('Taskfile Parser', () => {
  describe('parseTaskfile', () => {
    it('should parse tasks with dependencies', () => {
      const content = `version: '3'

tasks:
  build:
    desc: Build the application
    cmds:
      - gcc -o app src/*.c

  test:
    desc: Run tests
    deps: [build]
    cmds:
      - ./app --test

  all:
    deps: [build, test]`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.tool).toBe('task');
      expect(config.targets).toHaveLength(3);

      expect(config.targets[0].name).toBe('build');
      expect(config.targets[0].description).toBe('Build the application');
      expect(config.targets[0].dependencies).toEqual([]);
      expect(config.targets[0].recipe).toEqual(['gcc -o app src/*.c']);

      expect(config.targets[1].name).toBe('test');
      expect(config.targets[1].description).toBe('Run tests');
      expect(config.targets[1].dependencies).toEqual(['build']);
      expect(config.targets[1].recipe).toEqual(['./app --test']);

      expect(config.targets[2].name).toBe('all');
      expect(config.targets[2].dependencies).toEqual(['build', 'test']);
    });

    it('should handle single command as string', () => {
      const content = `version: '3'

tasks:
  clean:
    desc: Clean build artifacts
    cmds:
      - rm -f *.o app`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual(['rm -f *.o app']);
    });

    it('should handle cmd field (singular)', () => {
      const content = `version: '3'

tasks:
  hello:
    cmd: echo "Hello World"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual(['echo "Hello World"']);
    });

    it('should handle cmds as objects with cmd property', () => {
      const content = `version: '3'

tasks:
  build:
    cmds:
      - cmd: gcc -o app src/main.c
      - cmd: echo "Build complete"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual([
        'gcc -o app src/main.c',
        'echo "Build complete"'
      ]);
    });

    it('should handle description field', () => {
      const content = `version: '3'

tasks:
  build:
    description: Build the application
    cmds:
      - gcc -o app src/*.c`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].description).toBe('Build the application');
    });

    it('should prefer desc over description', () => {
      const content = `version: '3'

tasks:
  build:
    desc: Short description
    description: Long description
    cmds:
      - gcc -o app src/*.c`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].description).toBe('Short description');
    });

    it('should handle tasks with no commands', () => {
      const content = `version: '3'

tasks:
  all:
    deps: [build, test]

  build:
    cmds:
      - echo "Building"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets).toHaveLength(2);
      expect(config.targets[0].name).toBe('all');
      expect(config.targets[0].recipe).toEqual([]);
      expect(config.targets[0].dependencies).toEqual(['build', 'test']);
    });

    it('should handle default task', () => {
      const content = `version: '3'

default: build

tasks:
  build:
    cmds:
      - echo "Building"

  test:
    cmds:
      - echo "Testing"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.defaultTarget).toBe('build');
    });

    it('should handle empty tasks', () => {
      const content = `version: '3'

tasks: {}`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.tool).toBe('task');
      expect(config.targets).toEqual([]);
      expect(config.dependencies).toEqual({});
    });

    it('should handle missing tasks key', () => {
      const content = `version: '3'`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.tool).toBe('task');
      expect(config.targets).toEqual([]);
      expect(config.dependencies).toEqual({});
    });

    it('should build dependencies map', () => {
      const content = `version: '3'

tasks:
  all:
    deps: [build, test]

  build:
    deps: [lib]

  test:
    deps: [build]

  lib:
    cmds:
      - echo "Library"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.dependencies).toEqual({
        'all': ['build', 'test'],
        'build': ['lib'],
        'test': ['build'],
        'lib': []
      });
    });

    it('should handle deps as empty array', () => {
      const content = `version: '3'

tasks:
  build:
    deps: []
    cmds:
      - echo "Building"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets[0].dependencies).toEqual([]);
    });

    it('should handle missing deps field', () => {
      const content = `version: '3'

tasks:
  build:
    cmds:
      - echo "Building"`;

      const config = parseTaskfile('Taskfile.yml', content);

      expect(config.targets[0].dependencies).toEqual([]);
    });
  });

  describe('taskTool', () => {
    it('should detect Taskfile.yml', () => {
      const files = ['src/main.go', 'Taskfile.yml', 'README.md'];
      const detected = taskTool.detect(files);
      expect(detected).toBe('Taskfile.yml');
    });

    it('should detect Taskfile.yaml', () => {
      const files = ['src/main.go', 'Taskfile.yaml', 'README.md'];
      const detected = taskTool.detect(files);
      expect(detected).toBe('Taskfile.yaml');
    });

    it('should return null if no Taskfile', () => {
      const files = ['src/main.go', 'Makefile', 'README.md'];
      const detected = taskTool.detect(files);
      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(taskTool.name).toBe('task');
    });
  });
});
