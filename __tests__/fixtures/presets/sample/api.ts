import { login, logout } from './auth';
import { read, write } from './db';

export function handleRequest(user: string, id: string, val: string): string {
  if (!login(user)) return 'unauth';
  const current = read(id);
  write(id, val);
  logout();
  return current;
}
