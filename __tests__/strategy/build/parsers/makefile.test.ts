// __tests__/strategy/build/parsers/makefile.test.ts
import { parseMakefile, makeTool } from '../../../../src/lib/strategy/build/parsers/makefile';

describe('Makefile Parser', () => {
  describe('parseMakefile', () => {
    it('should parse targets with dependencies', () => {
      const content = `all: build test

build:
\tgcc -o app src/*.c

test: build
\t./app --test`;

      const config = parseMakefile('Makefile', content);

      expect(config.tool).toBe('make');
      expect(config.targets).toHaveLength(3);

      expect(config.targets[0].name).toBe('all');
      expect(config.targets[0].dependencies).toEqual(['build', 'test']);
      expect(config.targets[0].recipe).toEqual([]);

      expect(config.targets[1].name).toBe('build');
      expect(config.targets[1].dependencies).toEqual([]);
      expect(config.targets[1].recipe).toEqual(['gcc -o app src/*.c']);

      expect(config.targets[2].name).toBe('test');
      expect(config.targets[2].dependencies).toEqual(['build']);
      expect(config.targets[2].recipe).toEqual(['./app --test']);
    });

    it('should detect .PHONY targets', () => {
      const content = `.PHONY: clean test

all: build

build:
\tgcc -o app src/*.c

clean:
\trm -f *.o app

test: build
\t./app --test`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(4);

      const cleanTarget = config.targets.find(t => t.name === 'clean');
      expect(cleanTarget?.phony).toBe(true);

      const testTarget = config.targets.find(t => t.name === 'test');
      expect(testTarget?.phony).toBe(true);

      const buildTarget = config.targets.find(t => t.name === 'build');
      expect(buildTarget?.phony).toBeFalsy();
    });

    it('should parse multi-line recipes', () => {
      const content = `build:
\tgcc -c src/main.c
\tgcc -c src/utils.c
\tgcc -o app main.o utils.o`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].recipe).toEqual([
        'gcc -c src/main.c',
        'gcc -c src/utils.c',
        'gcc -o app main.o utils.o'
      ]);
    });

    it('should handle targets with file dependencies', () => {
      const content = `app: main.o utils.o
\tgcc -o app main.o utils.o

main.o: src/main.c src/main.h
\tgcc -c src/main.c

utils.o: src/utils.c src/utils.h
\tgcc -c src/utils.c`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(3);
      expect(config.targets[0].dependencies).toEqual(['main.o', 'utils.o']);
      expect(config.targets[1].dependencies).toEqual(['src/main.c', 'src/main.h']);
      expect(config.targets[2].dependencies).toEqual(['src/utils.c', 'src/utils.h']);
    });

    it('should set default target as first target', () => {
      const content = `all: build test

build:
\techo "Building"

test:
\techo "Testing"`;

      const config = parseMakefile('Makefile', content);

      expect(config.defaultTarget).toBe('all');
    });

    it('should handle empty files', () => {
      const content = '';
      const config = parseMakefile('Makefile', content);

      expect(config.tool).toBe('make');
      expect(config.targets).toEqual([]);
      expect(config.defaultTarget).toBeUndefined();
      expect(config.dependencies).toEqual({});
    });

    it('should ignore comments', () => {
      const content = `# This is a comment
# Another comment
all: build
\techo "Done"

# More comments
build:
\techo "Building"`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(2);
      expect(config.targets[0].name).toBe('all');
      expect(config.targets[1].name).toBe('build');
    });

    it('should handle variable assignments (ignore them)', () => {
      const content = `CC = gcc
CFLAGS = -Wall -O2

all: build
\t$(CC) $(CFLAGS) -o app src/*.c`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('all');
      expect(config.targets[0].recipe).toEqual(['$(CC) $(CFLAGS) -o app src/*.c']);
    });

    it('should handle targets with no dependencies', () => {
      const content = `clean:
\trm -f *.o app`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('clean');
      expect(config.targets[0].dependencies).toEqual([]);
      expect(config.targets[0].recipe).toEqual(['rm -f *.o app']);
    });

    it('should build dependencies map', () => {
      const content = `all: build test

build: lib
\techo "Building"

test: build
\techo "Testing"

lib:
\techo "Library"`;

      const config = parseMakefile('Makefile', content);

      expect(config.dependencies).toEqual({
        'all': ['build', 'test'],
        'build': ['lib'],
        'test': ['build'],
        'lib': []
      });
    });

    it('should handle targets with continuation lines (simple case)', () => {
      const content = `build:
\tgcc -o app \\
\t    src/main.c \\
\t    src/utils.c`;

      const config = parseMakefile('Makefile', content);

      expect(config.targets).toHaveLength(1);
      // Each line is separate in our simple parser
      expect(config.targets[0].recipe.length).toBeGreaterThan(0);
    });
  });

  describe('makeTool', () => {
    it('should detect Makefile', () => {
      const files = ['src/main.c', 'Makefile', 'README.md'];
      const detected = makeTool.detect(files);
      expect(detected).toBe('Makefile');
    });

    it('should detect makefile (lowercase)', () => {
      const files = ['src/main.c', 'makefile', 'README.md'];
      const detected = makeTool.detect(files);
      expect(detected).toBe('makefile');
    });

    it('should detect .mk files', () => {
      const files = ['src/main.c', 'build.mk', 'README.md'];
      const detected = makeTool.detect(files);
      expect(detected).toBe('build.mk');
    });

    it('should return null if no Makefile', () => {
      const files = ['src/main.c', 'package.json', 'README.md'];
      const detected = makeTool.detect(files);
      expect(detected).toBeNull();
    });

    it('should have correct name', () => {
      expect(makeTool.name).toBe('make');
    });
  });
});
