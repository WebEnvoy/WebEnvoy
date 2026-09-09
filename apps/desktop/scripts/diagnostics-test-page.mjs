// Dedicated non-production page for Installed Plugin live acceptance (#498).
// This server generates browser events; it never connects to WebEnvoy.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 18798);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid test port');
let actions = 0;
const page = `<!doctype html><meta charset="utf-8"><title>Runtime diagnostics check</title>
<main><h1>Runtime diagnostics check</h1><p>No account or external business effect.</p>
<button type="button">Generate diagnostics</button><p role="status">Ready</p></main>
<script>
document.querySelector('button').addEventListener('click', async () => {
  const result = await fetch('/action', {method:'POST'}).then(r => r.json());
  console.warn('Diagnostic warning'); console.error('Diagnostic error');
  console.warn('token=fixture-only-redaction-sentinel');
  console.warn('Long diagnostic ' + 'x'.repeat(600));
  await Promise.allSettled([fetch('/ok'), fetch('/unavailable')]);
  document.querySelector('[role=status]').textContent = 'Diagnostics generated; action count ' + result.actions;
  setTimeout(() => { throw new Error('Diagnostic page exception'); }, 0);
});
</script>`;
const server = createServer((req, res) => {
  const route = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (route === '/failure') { console.log(JSON.stringify({path:route, result:'connection_closed'})); req.socket.destroy(); return; }
  const status = route === '/unavailable' ? 503 : route === '/redirect' ? 302 : ['/', '/next', '/ok', '/action', '/counts'].includes(route) ? 200 : 404;
  if (route === '/action' && req.method === 'POST') actions++;
  res.writeHead(status, { 'content-type': route === '/' || route === '/next' ? 'text/html; charset=utf-8' : 'application/json', 'cache-control':'no-store', ...(route === '/redirect' ? {location:'/ok'} : {}) });
  res.end(route === '/' || route === '/next' ? page : JSON.stringify({actions, result:status === 200 ? 'ok' : 'expected-test-failure'}));
  console.log(JSON.stringify({path:route, method:req.method, status, actions}));
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({origin:`http://127.0.0.1:${port}`, non_production:true})));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
