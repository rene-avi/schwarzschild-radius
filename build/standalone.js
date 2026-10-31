/** Keep the production page usable under file://, including in Safari/Firefox. */
export function standaloneHtml() {
  return {
    name: 'event-horizon-standalone',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // The source page routes a local double-click to the last built page.
        // In a production build, replace that launcher with Vite's real entry.
        return html.replace(
          /<script\s+data-local-launcher>[\s\S]*?<\/script>/,
          '<script type="module" src="/src/main.js"></script>',
        );
      },
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle['index.html'];
        const scripts = Object.values(bundle).filter(file => file.type === 'chunk');
        const styles = Object.values(bundle).filter(file => file.type === 'asset' && file.fileName.endsWith('.css'));
        if (!page || page.type !== 'asset' || scripts.length !== 1) {
          this.error('The standalone page requires one HTML entry and one JavaScript bundle.');
        }
        const script = scripts[0];
        if (script.imports.length || script.dynamicImports.length) {
          this.error('The standalone page cannot load external JavaScript modules.');
        }
        let html = String(page.source)
          .replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>/gi, '')
          .replace(/<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["'][^>]*>/gi, '');
        const css = styles.map(file => String(file.source)).join('\n').replace(/<\/style/gi, '<\\/style');
        const js = script.code.replace(/<\/script/gi, '<\\/script');
        html = html.replace('</head>', () => `<style>${css}</style>\n</head>`);
        // A classic inline script also avoids file-origin module/CORS restrictions.
        // It must run after the canvas and other DOM elements have been parsed.
        html = html.replace('</body>', () => `<script>${js}</script>\n</body>`);
        page.source = html;
        delete bundle[script.fileName];
        for (const style of styles) delete bundle[style.fileName];
        const leftovers = Object.keys(bundle).filter(name => name !== 'index.html');
        if (leftovers.length) this.error(`Unexpected standalone dependencies: ${leftovers.join(', ')}`);
      },
    },
  };
}
