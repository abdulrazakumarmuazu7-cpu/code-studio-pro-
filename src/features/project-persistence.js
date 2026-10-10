export function saveProjectRecord(projectName, fileSystem, store) {
  const files = {};
  for (const [name, value] of fileSystem.entries()) {
    if (value.type === 'file') {
      files[name] = { ...value, modified: false };
    }
  }

  if (!store || typeof store.put !== 'function') return null;
  return store.put({ id: projectName, name: projectName, files, timestamp: Date.now() });
}

export function loadProjectRecord(projectName, store) {
  if (!store || typeof store.get !== 'function') return null;
  return store.get(projectName);
}

export function listProjectRecords(store) {
  if (!store || typeof store.getAll !== 'function') return [];
  return store.getAll();
}

export function deleteProjectRecord(projectName, store) {
  if (!store || typeof store.delete !== 'function') return false;
  return store.delete(projectName);
}
