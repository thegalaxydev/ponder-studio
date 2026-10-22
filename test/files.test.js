import { describe, expect, it } from 'vitest';
import { listFiles } from '../src/files.js';

describe('listFiles', () => {
  it('walks past the workspace.tree depth limit', async () => {
    const all = ['a/b/c/d/e/f/g/h/i/j/k/Deep.java', 'a/Top.java', 'a/b/notes.txt'];
    const calls = [];
    globalThis.modsmith = {
      call: async (method, { dir, depth }) => {
        calls.push(dir);
        const build = (prefix, level) => {
          const names = new Set(all.filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1).split('/')[0]));
          return [...names].map((name) => {
            const path = `${prefix}/${name}`;
            const dir = !all.includes(path);
            return dir ? (level < depth ? { path, dir, children: build(path, level + 1) } : { path, dir }) : { path, dir };
          });
        };
        return build(dir, 0);
      }
    };
    expect(await listFiles('a', '.java')).toEqual(['a/Top.java', 'a/b/c/d/e/f/g/h/i/j/k/Deep.java']);
    expect(calls.length).toBe(2);
    delete globalThis.modsmith;
  });
});
