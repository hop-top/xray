export function login(user: string): boolean {
  return user.length > 0;
}

export function logout(): void {}

export function verify(token: string): boolean {
  return token.length > 0;
}
