export function getLanguageFromFilename(filename) {
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

export function createMonacoModelForPath(path, content, isWelcome = false) {
  if (typeof monaco === 'undefined') return null;

  const language = isWelcome ? 'javascript' : getLanguageFromFilename(path);
  const uri = monaco.Uri.parse(isWelcome ? 'inmemory://welcome' : `inmemory://project/${path}`);
  return monaco.editor.createModel(content || '', language, uri);
}

export function getModelForPath(monacoModels, path, contentFactory) {
  let model = monacoModels.get(path);
  if (!model || model.isDisposed()) {
    model = createMonacoModelForPath(path, typeof contentFactory === 'function' ? contentFactory() : '', false);
    monacoModels.set(path, model);
  }
  return model;
}

export function disposeMonacoModels(monacoModels) {
  for (const model of monacoModels.values()) {
    if (model && !model.isDisposed()) model.dispose();
  }
  monacoModels.clear();
}

export function disposeModelsUnderPath(monacoModels, path) {
  const prefix = `${path}/`;
  for (const [key, model] of [...monacoModels]) {
    if (key === path || key.startsWith(prefix)) {
      if (!model.isDisposed()) model.dispose();
      monacoModels.delete(key);
    }
  }
}
