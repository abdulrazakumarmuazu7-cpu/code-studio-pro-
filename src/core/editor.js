export function createMonacoEditor(container, options = {}) {
  if (typeof monaco === 'undefined') {
    console.warn('Monaco is not available yet.');
    return null;
  }

  return monaco.editor.create(container, {
    minimap: { enabled: true },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    ...options
  });
}

export function setEditorTheme(theme = 'vs-dark') {
  if (typeof monaco !== 'undefined') {
    monaco.editor.setTheme(theme);
  }
}

export function getEditorLanguage(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    html: 'html', css: 'css', json: 'json', md: 'markdown', py: 'python',
    sh: 'shell', yaml: 'yaml', yml: 'yaml'
  };
  return map[ext] || 'plaintext';
}
