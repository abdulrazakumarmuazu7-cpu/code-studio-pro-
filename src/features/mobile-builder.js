export function createMobileExportPayload(projectName, fileSystem) {
  const files = {};
  for (const [name, data] of fileSystem) {
    if (data.type === 'file') files[name] = data.content;
  }

  return {
    projectName,
    createdAt: new Date().toISOString(),
    files,
    package: {
      name: String(projectName || 'my-app').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      appId: 'com.codestudio.app',
      platforms: ['android', 'ios']
    }
  };
}

export function buildProjectArchive(projectName, fileSystem) {
  return createMobileExportPayload(projectName, fileSystem);
}
