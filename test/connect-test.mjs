// Test end-to-end de a11y-checker contra un sitio local con problemas de accesibilidad.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'a11y-checker'), { recursive: true });
writeFileSync(path.join(tmpDir, 'dsh-home', 'a11y-checker', 'config.json'), JSON.stringify({ allowedHosts: ['127.0.0.1'], userAgent: 'a11y-test' }, null, 2), 'utf8');

const html = `<!doctype html><html><head><title>Panel</title></head><body>
<h1>Panel</h1><h3>Salto</h3>
<img src="/x.png">
<img src="/y.png" alt="">
<button></button>
<a href="#">clic aquí</a>
<input type="text" name="correo">
<div style="color:#777777;background:#888888">texto</div>
<span tabindex="5">foco</span>
<p id="dup">a</p><p id="dup">b</p>
<video autoplay src="/v.mp4"></video>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  else { res.writeHead(404); res.end('no'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

function makeClient(extraEnv = {}) {
  const entry = process.env.A11Y_SERVER ? path.resolve(process.env.A11Y_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'a11y-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const result = await client.callTool({ name: 'audit', arguments: { url: base } });
console.log('--- audit ---'); console.log(textOf(result).slice(0, 1100));
const blocked = await client.callTool({ name: 'audit', arguments: { url: 'https://example.com/' } });
console.log('host no permitido isError:', blocked.isError === true); 
const bad = await client.callTool({ name: 'audit', arguments: { url: 'ftp://x' } });
console.log('protocolo inválido isError:', bad.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
server.close();
console.log('OK');
