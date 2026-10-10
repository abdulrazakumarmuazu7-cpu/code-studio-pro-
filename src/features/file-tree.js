export function buildFileTree(fileSystem) {
  const root = { type: 'folder', name: '', path: '', children: new Map() };

  const ensureFolder = (folderPath) => {
    if (!folderPath) return root;

    const parts = String(folderPath).split('/').filter(Boolean);
    let node = root;
    let current = '';

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { type: 'folder', name: part, path: current, children: new Map() });
      }
      node = node.children.get(part);
    }

    return node;
  };

  for (const [path, data] of fileSystem.entries()) {
    if (data.type === 'folder') {
      ensureFolder(path);
      continue;
    }

    const parts = String(path).split('/').filter(Boolean);
    const fileName = parts.pop();
    const folder = ensureFolder(parts.join('/'));
    folder.children.set(fileName, { type: 'file', name: fileName, path, data });
  }

  return root;
}

export function renderTreeNode(node, container, depth, options = {}) {
  const { expandedFolders = new Set(), currentFile = null, onOpenFile = () => {}, onToggleFolder = () => {} } = options;

  const folders = [];
  const files = [];

  for (const child of node.children.values()) {
    if (child.type === 'folder') folders.push(child);
    else files.push(child);
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    const expanded = expandedFolders.has(folder.path);
    const item = document.createElement('div');
    item.className = `file-item folder ${expanded ? 'expanded' : ''} ${options.selectedFolder === folder.path ? 'active' : ''}`;
    item.dataset.path = folder.path;
    item.style.paddingLeft = `${8 + depth * 16}px`;
    item.innerHTML = `
      <span class="file-icon"><i class="fas fa-folder${expanded ? '-open' : ''}"></i></span>
      <span class="file-name">${folder.name}</span>
    `;
    item.onclick = (event) => {
      event.stopPropagation();
      onToggleFolder(folder.path);
    };
    container.appendChild(item);

    if (expanded) {
      renderTreeNode(folder, container, depth + 1, options);
    }
  }

  for (const file of files) {
    const item = document.createElement('div');
    item.className = `file-item ${file.path === currentFile ? 'active' : ''}`;
    item.dataset.path = file.path;
    item.style.paddingLeft = `${8 + (depth + 1) * 16}px`;
    item.innerHTML = `
      <span class="file-icon"><i class="fas fa-file"></i></span>
      <span class="file-name">${file.name}</span>
    `;
    item.onclick = () => onOpenFile(file.path);
    container.appendChild(item);
  }
}
