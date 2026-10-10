export function createDefaultProjectState() {
  return {
    projectName: 'untitled-project',
    currentFile: null,
    openFiles: [],
    selectedFolder: '',
    expandedFolders: new Set(),
    fileSystem: new Map(),
    monacoModels: new Map(),
    settings: {
      theme: 'dark',
      fontSize: 14,
      wordWrap: 'on',
      autoSave: 'afterDelay',
      gitAuthorName: '',
      gitAuthorEmail: '',
      gitCorsProxy: 'https://cors.isomorphic-git.org',
      gitToken: ''
    }
  };
}

export function ensureDefaultFiles(fileSystem) {
  const defaults = {
    'index.html': {
      type: 'file',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My App</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Welcome to Code Studio Pro</h1>
  <button id="btn">Click me</button>
  <script src="app.js"></script>
</body>
</html>`,
      language: 'html',
      modified: false
    },
    'style.css': {
      type: 'file',
      content: `body { font-family: sans-serif; display: grid; place-items: center; min-height: 100vh; }`,
      language: 'css',
      modified: false
    },
    'app.js': {
      type: 'file',
      content: `document.getElementById('btn')?.addEventListener('click', () => { alert('Code Studio Pro is working!'); });`,
      language: 'javascript',
      modified: false
    }
  };

  for (const [path, data] of Object.entries(defaults)) {
    if (!fileSystem.has(path)) {
      fileSystem.set(path, data);
    }
  }
}
