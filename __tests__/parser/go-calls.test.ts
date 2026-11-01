import { ParserManager } from '../../src/lib/parser/manager';

describe('Go qualified calls and import aliases', () => {
  const src = `package main

import (
	"fmt"
	u "example.com/m/util"
	. "example.com/m/dot"
	_ "example.com/m/blank"
	"example.com/m/cmd"
)

func main() {
	cmd.Execute()
	u.Run()
	fmt.Println()
	x := build()
	x.Method()
	obj.field.Nested()
}
`;

  it('keeps pkg.Func references qualified; value-receiver calls become .Method; stdlib calls record nothing', async () => {
    const r = await new ParserManager('/root').parse('main.go', src);
    const main = r.tags.find(t => t.name === 'main')!;
    expect([...main.references!].sort()).toEqual(
      ['build', 'cmd.Execute', 'u.Run', '.Method', '.Nested'].sort()
    );
  });

  it('records import aliases (name, dot, blank) per import spec', async () => {
    const r = await new ParserManager('/root').parse('main.go', src);
    const by = (s: string) => r.imports.find(i => i.source === s)!;
    expect(by('example.com/m/util').alias).toBe('u');
    expect(by('example.com/m/dot').alias).toBe('.');
    expect(by('example.com/m/blank').alias).toBe('_');
    expect(by('example.com/m/cmd').alias).toBeUndefined();
    expect(by('fmt').alias).toBeUndefined();
  });
});
