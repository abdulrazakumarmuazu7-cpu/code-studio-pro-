export function getProjectDefaultFiles() {
  return {
    'index.html': {
      type: 'file',
      language: 'html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My App</title>
</head>
<body>
  <h1>Welcome to Code Studio Pro</h1>
  <script src="app.js"></script>
</body>
</html>`
    },
    'app.js': {
      type: 'file',
      language: 'javascript',
      content: `console.log('Project booted.');`
    },
    'style.css': {
      type: 'file',
      language: 'css',
      content: `body { font-family: sans-serif; margin: 2rem; }`
    }
  };
}

export function findEntryHtml(fileSystem) {
  const names = [...fileSystem.keys()];
  return fileSystem.has('index.html') ? 'index.html' : names.find((name) => /\.html?$/i.test(name)) || null;
}
