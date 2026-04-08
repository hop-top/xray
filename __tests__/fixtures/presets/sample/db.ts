import { verify } from './auth';

export function read(id: string): string {
  return verify(id) ? `row:${id}` : '';
}

export function write(id: string, value: string): void {
  if (verify(id)) {
    void value;
  }
}

export function flush(): void {}
