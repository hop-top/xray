export function add(a: number, b: number): number {
  return a + b;
}

export class Calculator {
  total(a: number, b: number) {
    return add(a, b);
  }
}
