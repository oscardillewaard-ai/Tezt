// Testopstelling voor drie-routes.html: headless Chromium, abcjs lokaal, nagebootste accountopslag (db/user),
// nagebootste MIDI-piano en een bestuurbare klok. Gebruikt door alle t-*.mjs.
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(HERE, '../drie-routes.html');
export const OLD = path.resolve(HERE, 'fixtures/drie-routes-v1.html');
export const OUT = path.resolve(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

let ABC_LOCAL = null;
try { ABC_LOCAL = createRequire(import.meta.url).resolve('abcjs/dist/abcjs-basic-min.js'); } catch { ABC_LOCAL = null; }
if (!ABC_LOCAL) console.warn('abcjs niet gevonden: draai eerst npm install in drie-routes/. Bladmuziek valt terug op tekst.');

export function makeStore(){
  // Gedeelde opslag in het geheugen: pad -> { data, version }
  return { docs: new Map(), writes: 0, failNext: null, uid: 'u_test_user' };
}

let browser = null;
export async function getBrowser(){
  if (!browser){
    const args = ['--autoplay-policy=no-user-gesture-required'];
    try { browser = await chromium.launch({ args }); }
    catch {
      // Voorgeinstalleerde Chromium in de Claude Code-cloudomgeving
      const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
      browser = await chromium.launch({ args, executablePath: exe });
    }
  }
  return browser;
}
export async function closeBrowser(){ if (browser) await browser.close(); browser = null; }

/**
 * opts: file, time (Date), store (makeStore() of null: geen window.claude), viewport, colorScheme,
 *       storageState, midi (nagebootste piano), abc (false: bladmuziek laadt niet), hash
 */
export async function openApp(opts){
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    colorScheme: opts.colorScheme || 'light',
    storageState: opts.storageState,
    deviceScaleFactor: opts.dpr || 1
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));

  const html = fs.readFileSync(opts.file || APP, 'utf8');
  const abc = () => (ABC_LOCAL ? fs.readFileSync(ABC_LOCAL, 'utf8') : null);
  await ctx.route('https://app.test/**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  for (const host of ['https://cdn.jsdelivr.net/**', 'https://unpkg.com/**', 'https://cdnjs.cloudflare.com/**']){
    await ctx.route(host, r => {
      const body = opts.abc === false ? null : abc();
      if (body && r.request().url().includes('abcjs')) return r.fulfill({ status: 200, contentType: 'application/javascript', body });
      return r.abort();
    });
  }
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());

  if (opts.time) await page.clock.install({ time: opts.time });

  const store = opts.store;
  if (store){
    await page.exposeFunction('__dbGet', p => {
      const d = store.docs.get(p);
      return d ? { exists: true, data: JSON.parse(JSON.stringify(d.data)), version: d.version } : { exists: false };
    });
    await page.exposeFunction('__dbSet', (p, data) => {
      if (store.failNext){ const code = store.failNext; store.failNext = null; return { error: code }; }
      if (JSON.stringify(data).length > 256 * 1024) return { error: 'invalid_argument' };
      const prev = store.docs.get(p);
      store.docs.set(p, { data: JSON.parse(JSON.stringify(data)), version: (prev ? prev.version : 0) + 1 });
      store.writes++;
      return { ok: true };
    });
    await page.addInitScript(({ uid }) => {
      function snap(p){ return window.__dbGet(p).then(r => ({ id: p.split('/').pop(), exists: r.exists, data: () => r.data, metadata: { fromCache: false, hasPendingWrites: false }, _v: r.version })); }
      function docRef(p){
        return {
          id: p.split('/').pop(), path: p,
          get: () => snap(p),
          set: async data => { const r = await window.__dbSet(p, data); if (r.error){ const e = new Error(r.error); e.code = r.error; throw e; } },
          update: async () => { throw Object.assign(new Error('niet gebruikt'), { code: 'invalid_argument' }); },
          delete: async () => {},
          onSnapshot(next){
            let last = -1, dead = false;
            const tick = async () => { if (dead) return; const s = await snap(p); const v = s._v || 0; if (v !== last){ last = v; next(s); } };
            tick();
            const iv = setInterval(tick, 300);
            return () => { dead = true; clearInterval(iv); };
          }
        };
      }
      const db = Object.freeze({ doc: p => docRef(p), collection: c => ({ path: c, doc: id => docRef(c + '/' + id) }) });
      const user = Object.freeze({ id: async () => uid, me: async () => ({ id: uid, name: '', isOwner: true, canEdit: true }), isOwner: async () => true, canEdit: async () => true, can: async () => null });
      window.claude = { use: async name => { await new Promise(r => setTimeout(r, 30)); return name === 'db' ? db : name === 'user' ? user : null; } };
    }, { uid: store.uid });
  }

  if (opts.midi){
    await page.addInitScript(() => {
      // Nagebootste Web MIDI met één invoer, "Test Piano". window.__midi.tap(noot) speelt een noot.
      const input = { id: 'in1', name: 'Test Piano', manufacturer: 'Test', state: 'connected', type: 'input', connection: 'open', onmidimessage: null };
      const access = { inputs: new Map([['in1', input]]), outputs: new Map(), onstatechange: null, sysexEnabled: false };
      navigator.requestMIDIAccess = async () => access;
      const send = bytes => { if (typeof input.onmidimessage === 'function') input.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() }); };
      window.__midi = {
        on: (m, v = 80) => send([0x90, m, v]),
        off: m => send([0x80, m, 0]),
        tap: async (m, ms = 120) => { send([0x90, m, 80]); await new Promise(r => setTimeout(r, ms)); send([0x80, m, 0]); }
      };
    });
  }

  await page.goto('https://app.test/drie-routes.html' + (opts.hash || ''));
  await page.waitForSelector('#app > *');
  return { page, ctx, logs, store };
}

export async function state(page, key = 'drieroutes.v1'){
  return page.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, key);
}

export async function overflowX(page){
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// Kleine verzameling van controles per testbestand
export function suite(name){
  const res = { name, pass: 0, fail: 0, notes: [] };
  return {
    ok(cond, msg, extra){
      if (cond) res.pass++;
      else { res.fail++; res.notes.push('FAIL ' + msg + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
      return cond;
    },
    note(msg){ res.notes.push('NOTE ' + msg); },
    done(){
      console.log(`\n== ${res.name}: ${res.pass} passed, ${res.fail} failed`);
      res.notes.forEach(n => console.log('  ' + n));
      if (res.fail) process.exitCode = 1;
      return res;
    }
  };
}
