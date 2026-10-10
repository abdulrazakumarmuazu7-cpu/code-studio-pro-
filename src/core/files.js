export function normalizePath(path) {
  return String(path || '').replace(/^\/+|\/+$/g, '');
}

export function detectLanguage(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  const map = {
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', md: 'markdown', py: 'python', java: 'java', php: 'php',
    rb: 'ruby', go: 'go', rs: 'rust', yaml: 'yaml', yml: 'yaml', sh: 'shell',
    bash: 'shell', zsh: 'shell', sql: 'sql', xml: 'xml'
  };
  return map[ext] || 'plaintext';
}

export function buildFileTree(fileSystem) {
  const root = { type: 'folder', path: '', name: '', children: new Map() };

  const ensureFolder = (parts) => {
    let node = root;
    let current = '';

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { type: 'folder', path: current, name: part, children: new Map() });
      }
      node = node.children.get(part);
    }

    return node;
  };

  for (const [path, data] of fileSystem.entries()) {
    if (data.type === 'folder') {
      ensureFolder(String(path).split('/').filter(Boolean));
      continue;
    }

    const parts = String(path).split('/').filter(Boolean);
    const fileName = parts.pop();
    const folder = ensureFolder(parts);
    folder.children.set(fileName, { type: 'file', path, name: fileName, data });
  }

  return root;
}
