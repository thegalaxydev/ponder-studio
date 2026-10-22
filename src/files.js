export async function listFiles(dir, suffix) {
  const out = [];
  const walk = async (nodes) => {
    for (const n of nodes) {
      if (n.dir) await (n.children ? walk(n.children) : visit(n.path));
      else if (n.path.endsWith(suffix)) out.push(n.path);
    }
  };
  const visit = async (d) => walk(await modsmith.call('workspace.tree', { dir: d, depth: 8 }));
  await visit(dir);
  return out.sort();
}
