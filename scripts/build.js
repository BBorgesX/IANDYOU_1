import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, css, engine, app] = await Promise.all(
  ['index.html', 'src/styles.css', 'src/engine/synchronization.js', 'src/app.js'].map(path => readFile(new URL(path, root), 'utf8')),
);
const standalone = html
  .replace('<link rel="stylesheet" href="/src/styles.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="/src/app.js"></script>', () => `<script>\n(() => {\n${engine.replaceAll('export function', 'function')}\n${app.replace(/^import[^\n]+\n/, '')}\n})();\n</script>`)
  .replace('href="/" aria-label="MeetSync início"', 'href="#" aria-label="MeetSync início"');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/MeetSync.html', root), standalone);
console.log('Gerado dist/MeetSync.html — execute npm start; rotas e sessões compartilhadas precisam do servidor.');
