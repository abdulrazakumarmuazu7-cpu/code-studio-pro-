export function runGlobalSearch(query, fileSystem) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];

  const results = [];
  for (const [path, data] of fileSystem.entries()) {
    if (data.type !== 'file' || typeof data.content !== 'string') continue;

    const lines = data.content.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      if (lines[idx].toLowerCase().includes(q)) {
        results.push({ path, line: idx + 1, text: lines[idx].trim().slice(0, 120) });
      }
    }
  }

  return results;
}
