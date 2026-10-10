export function applyTheme(theme = 'dark') {
  const isDark = theme !== 'light';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  return isDark;
}

export function toggleTheme(currentTheme) {
  return currentTheme === 'dark' ? 'light' : 'dark';
}
