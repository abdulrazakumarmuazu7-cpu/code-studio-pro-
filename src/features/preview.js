export function buildPreviewHtml(htmlContent, fileSystem) {
  let html = htmlContent;

  const resolveLocal = (path) => {
    const clean = String(path || '').replace(/^\.?\//, '');
    return fileSystem.get(clean) || fileSystem.get(path) || null;
  };

  html = html.replace(/<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (match, href) => {
    const cssFile = resolveLocal(href);
    return cssFile ? `<style>\n${cssFile.content}\n</style>` : match;
  });

  html = html.replace(/<script[^>]*src=["']([^"']+\.js)["'][^>]*><\/script>/gi, (match, src) => {
    const jsFile = resolveLocal(src);
    return jsFile ? `<script>\n${jsFile.content}\n<\/script>` : match;
  });

  return html;
}

export function openPreviewFrame(frame, html, fileSystem) {
  const wrapped = buildPreviewHtml(html, fileSystem);
  const blob = new Blob([wrapped], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  frame.src = url;
  return url;
}
