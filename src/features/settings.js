export function initializeSettings() {
  const saved = localStorage.getItem('code-studio-settings');
  if (!saved) return {
    theme: 'dark',
    fontSize: 14,
    wordWrap: 'on',
    autoSave: 'afterDelay'
  };

  try {
    return { ...{
      theme: 'dark',
      fontSize: 14,
      wordWrap: 'on',
      autoSave: 'afterDelay'
    }, ...JSON.parse(saved) };
  } catch {
    return {
      theme: 'dark',
      fontSize: 14,
      wordWrap: 'on',
      autoSave: 'afterDelay'
    };
  }
}

export function saveSettings(settings) {
  localStorage.setItem('code-studio-settings', JSON.stringify(settings));
}
