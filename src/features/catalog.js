export function createProjectCatalog(fileSystem) {
  const catalog = [];
  for (const [path, data] of fileSystem.entries()) {
    if (data.type === 'file') {
      catalog.push({ path, language: data.language || 'plaintext', modified: !!data.modified });
    }
  }
  return catalog;
}

export function countFiles(fileSystem) {
  let count = 0;
  for (const data of fileSystem.values()) if (data.type === 'file') count += 1;
  return count;
}
