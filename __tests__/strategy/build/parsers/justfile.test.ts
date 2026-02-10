// __tests__/strategy/build/parsers/justfile.test.ts
import { parseJustfile, justTool } from '../../../../src/lib/strategy/build/parsers/justfile';

describe('Justfile Parser', () => {
  describe('parseJustfile', () => {
    it('should parse recipes with dependencies', () => {
      const content = `all: build test

build:
  echo "Building..."
  gcc -o app src/*.c

test: build
  ./app --test`;

      const config = parseJustfile('Justfile', content);

      expect(config.tool).toBe('just');
      expect(config.targets).toHaveLength(3);

      expect(config.targets[0].name).toBe('all');
      expect(config.targets[0].dependencies).toEqual(['build', 'test']);

      expect(config.targets[1].name).toBe('build');
      expect(config.targets[1].dependencies).toEqual([]);
      expect(config.targets[1].recipe).toEqual([
        'echo "Building..."',
        'gcc -o app src/*.c'
      ]);

      expect(config.targets[2].name).toBe('test');
      expect(config.targets[2].dependencies).toEqual(['build']);
      expect(config.targets[2].recipe).toEqual(['./app --test']);
    });

    it('should parse recipe descriptions', () => {
      const content = `# Build the application
build:
  gcc -o app src/*.c

# Run tests
test: build
  ./app --test

# Clean build artifacts
clean:
  rm -f *.o app`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(3);

      expect(config.targets[0].name).toBe('build');
      expect(config.targets[0].description).toBe('Build the application');

      expect(config.targets[1].name).toBe('test');
      expect(config.targets[1].description).toBe('Run tests');

      expect(config.targets[2].name).toBe('clean');
      expect(config.targets[2].description).toBe('Clean build artifacts');
    });

    it('should handle recipes with tab indentation', () => {
      const content = `build:
\techo "Building..."
\tgcc -o app src/*.c`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual([
        'echo "Building..."',
        'gcc -o app src/*.c'
      ]);
    });

    it('should handle recipes with space indentation', () => {
      const content = `build:
  echo "Building..."
  gcc -o app src/*.c`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual([
        'echo "Building..."',
        'gcc -o app src/*.c'
      ]);
    });

    it('should handle recipes with no dependencies', () => {
      const content = `clean:
  rm -f *.o app`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('clean');
      expect(config.targets[0].dependencies).toEqual([]);
      expect(config.targets[0].recipe).toEqual(['rm -f *.o app']);
    });

    it('should set default target as first target', () => {
      const content = `all: build test

build:
  echo "Building"

test:
  echo "Testing"`;

      const config = parseJustfile('Justfile', content);

      expect(config.defaultTarget).toBe('all');
    });

    it('should handle empty files', () => {
      const content = '';
      const config = parseJustfile('Justfile', content);

      expect(config.tool).toBe('just');
      expect(config.targets).toEqual([]);
      expect(config.defaultTarget).toBeUndefined();
      expect(config.dependencies).toEqual({});
    });

    it('should build dependencies map', () => {
      const content = `all: build test

build: lib
  echo "Building"

test: build
  echo "Testing"

lib:
  echo "Library"`;

      const config = parseJustfile('Justfile', content);

      expect(config.dependencies).toEqual({
        'all': ['build', 'test'],
        'build': ['lib'],
        'test': ['build'],
        'lib': []
      });
    });

    it('should handle recipes with parameters', () => {
      const content = `# Build with specific target
build target:
  echo "Building {{target}}"
  gcc -o {{target}} src/*.c`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('build');
      expect(config.targets[0].description).toBe('Build with specific target');
    });

    it('should ignore non-recipe comments', () => {
      const content = `# This is a general comment
# that spans multiple lines

# Build the app
build:
  gcc -o app src/*.c

# Another comment
# not attached to a recipe

test:
  ./app --test`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(2);
      expect(config.targets[0].description).toBe('Build the app');
      expect(config.targets[1].description).toBeUndefined();
    });

    it('should handle recipes with empty bodies', () => {
      const content = `all: build test

build:

test:
  echo "Testing"`;

      const config = parseJustfile('Justfile', content);

      expect(config.targets).toHaveLength(3);
      expect(config.targets[1].name).toBe('build');
      expect(config.targets[1].recipe).toEqual([]);
    });
  });

  describe('justTool', () => {
    it('should detect Justfile', () => {
      const files = ['src/main.c', 'Justfile', 'README.md'];
      const detected = justTool.detect(files);
      expect(detected).toBe('Justfile');
    });

    it('should detect justfile (lowercase)', () => {
      const files = ['src/main.c', 'justfile', 'README.md'];
      const detected = justTool.detect(files);
      expect(detected).toBe('justfile');
    });

    it('should detect .justfile', () => {
      const files = ['src/main.c', '.justfile', 'README.md'];
      const detected = justTool.detect(files);
      expect(detected).toBe('.justfile');
    });

    it('should return null if no Justfile', () => {
      const files = ['src/main.c', 'Makefile', 'README.md'];
      const detected = justTool.detect(files);
      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(justTool.name).toBe('just');
    });
  });
});
