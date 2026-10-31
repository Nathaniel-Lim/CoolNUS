import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialState, advance, command, observation, assertState, allCrews } from './src/simulator.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createSimulatorServer({ persist = true, dataFile = path.join(root, '.data/state.json'), clock = true } = {}) {
  let state = initialState();
  if (persist && fs.existsSync(dataFile)) {
    state = JSON.parse(fs.readFileSync(dataFile, 'utf8')); assertState(state);
    state.running = false; // Restart paused, preserving every resource and assignment.
  }
  const clients = new Set();
  function publish(next) {
    state = next;
    if (persist) {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.writeFileSync(`${dataFile}.tmp`, JSON.stringify(state)); fs.renameSync(`${dataFile}.tmp`, dataFile);
    }
    for (const client of clients) client.write(`data: ${JSON.stringify(state)}\n\n`);
  }
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function body(req) {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Error('Request body is too large.'); }
    return data ? JSON.parse(data) : {};
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(state)}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
      if (req.method === 'GET' && url.pathname === '/api/agents') return json(res, 200, {
        atc: { id: state.atc.id, observationUrl: '/api/views/atc' },
        pilots: state.pilots.map(p => ({ id: p.id, callsign: p.callsign, observationUrl: `/api/views/pilots/${p.id}` })),
        ground: state.ground.crews.map(group => group.map(c => ({ id: c.id, type: c.type, observationUrl: `/api/views/ground/${c.id}` })))
      });
      if (req.method === 'GET' && url.pathname === '/api/views/atc') return json(res, 200, observation(state, 'atc', state.atc.id));
      const viewMatch = url.pathname.match(/^\/api\/views\/(pilots|ground)\/([^/]+)$/);
      if (req.method === 'GET' && viewMatch) return json(res, 200, observation(state, viewMatch[1] === 'pilots' ? 'pilot' : 'ground', decodeURIComponent(viewMatch[2])));
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin mutations are not allowed.' });
        const data = await body(req);
        if (url.pathname === '/api/actions') {
          if (!data.actor || !Number.isInteger(data.expectedRevision)) throw new Error('actor and integer expectedRevision are required.');
          publish(command(state, data.command, data.actor, data.expectedRevision)); return json(res, 200, state);
        }
        if (url.pathname === '/api/control') {
          const next = structuredClone(state);
          switch (data.type) {
            case 'play': next.running = true; break;
            case 'pause': next.running = false; break;
            case 'speed': if (![1, 5, 15, 60].includes(data.speed)) throw new Error('Invalid speed.'); next.speed = data.speed; break;
            case 'step': if (state.running) throw new Error('Pause before stepping.'); publish(advance(state, data.seconds ?? 30)); return json(res, 200, state);
            case 'reset': { const fresh = initialState(); fresh.revision = state.revision + 1; publish(fresh); return json(res, 200, state); }
            default: throw new Error('Unknown control.');
          }
          next.revision++; publish(next); return json(res, 200, state);
        }
        return json(res, 404, { error: 'Unknown endpoint.' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const file = files[url.pathname];
      if (!file) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); res.end(fs.readFileSync(path.join(root, 'public', file[0])));
    } catch (error) { json(res, /Stale revision/.test(error.message) ? 409 : 400, { error: error.message }); }
  });
  const timer = clock ? setInterval(() => { if (state.running) publish(advance(state, state.speed)); }, 1000) : null;
  server.on('close', () => { if (timer) clearInterval(timer); for (const client of clients) client.end(); });
  return { server, getState: () => structuredClone(state) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createSimulatorServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`CoolNUS airport simulator: http://127.0.0.1:${port}`));
}
