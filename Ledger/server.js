'use strict';

const http = require('http');
const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const ROOT     = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE  = path.join(DATA_DIR, 'transactions.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

/* Files / folders that must never be served */
const BLOCKED_FILES = new Set(['server.js', 'package.json', 'package-lock.json', '.env', '.gitignore']);
const BLOCKED_DIRS  = new Set(['data', 'node_modules', '.git']);

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

let writeChain = Promise.resolve();

async function ensureDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DB_FILE);
  } catch {
    await fsp.writeFile(DB_FILE, JSON.stringify({ transactions: [] }, null, 2), 'utf8');
  }
}

async function readDb() {
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.transactions)) return { transactions: [] };
    return parsed;
  } catch {
    return { transactions: [] };
  }
}

/* Serialize writes so concurrent requests can't clobber the file. */
function writeDb(db) {
  writeChain = writeChain.then(() =>
    fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8')
  );
  return writeChain;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const clean = (v, max) =>
  String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\s+$/g, '').replace(/^\s+/g, '').slice(0, max);

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (body.date !== undefined || !partial) {
    const date = String(body.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date must be in YYYY-MM-DD format');
    else out.date = date;
  }

  if (body.type !== undefined || !partial) {
    const type = String(body.type ?? '').trim();
    if (type !== 'income' && type !== 'expense') errors.push('type must be "income" or "expense"');
    else out.type = type;
  }

  if (body.amount !== undefined || !partial) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
      errors.push('amount must be a positive number');
    } else {
      out.amount = Math.round(amount * 100) / 100;
    }
  }

  if (body.description !== undefined || !partial) {
    const description = clean(body.description, 200);
    if (!description) errors.push('description is required');
    else out.description = description;
  }

  if (body.category !== undefined) out.category = clean(body.category, 60);
  if (body.notes    !== undefined) out.notes    = clean(body.notes, 1000);

  return { errors, value: out };
}

/* ------------------------------------------------------------------ */
/*  API                                                               */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const { pathname } = url;

  /* ----- Collection: /api/transactions ----- */
  if (pathname === '/api/transactions') {
    if (req.method === 'GET') {
      const db = await readDb();
      return sendJSON(res, 200, { transactions: db.transactions });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }

      const { errors, value } = validatePayload(body);
      if (errors.length) return sendJSON(res, 400, { error: errors[0], errors });

      const now = new Date().toISOString();
      const tx = {
        id: 'tx_' + crypto.randomUUID(),
        date: value.date,
        type: value.type,
        amount: value.amount,
        category: value.category || '',
        description: value.description,
        notes: value.notes || '',
        createdAt: now,
        updatedAt: now,
      };

      const db = await readDb();
      db.transactions.push(tx);
      await writeDb(db);

      return sendJSON(res, 201, tx);
    }

    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  /* ----- Single item: /api/transactions/:id ----- */
  const match = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const db = await readDb();
    const index = db.transactions.findIndex((t) => t.id === id);

    if (index === -1) return sendJSON(res, 404, { error: 'Transaction not found' });

    if (req.method === 'GET') {
      return sendJSON(res, 200, db.transactions[index]);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      let body;
      try { body = await readBody(req); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }

      const { errors, value } = validatePayload(body, { partial: req.method === 'PATCH' });
      if (errors.length) return sendJSON(res, 400, { error: errors[0], errors });

      const current = db.transactions[index];
      const updated = {
        ...current,
        ...value,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };

      db.transactions[index] = updated;
      await writeDb(db);
      return sendJSON(res, 200, updated);
    }

    if (req.method === 'DELETE') {
      const [removed] = db.transactions.splice(index, 1);
      await writeDb(db);
      return sendJSON(res, 200, { ok: true, id: removed.id });
    }

    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  return sendJSON(res, 404, { error: 'Unknown API endpoint' });
}

/* ------------------------------------------------------------------ */
/*  Static files                                                      */
/* ------------------------------------------------------------------ */

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return sendText(res, 400, 'Bad request'); }

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.join(ROOT, pathname);
  const rel = path.relative(ROOT, filePath);

  /* Path traversal guard */
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return sendText(res, 403, 'Forbidden');
  }

  /* Never serve server files or the data folder */
  const segments = rel.split(path.sep);
  if (BLOCKED_FILES.has(rel) || BLOCKED_DIRS.has(segments[0])) {
    return sendText(res, 403, 'Forbidden');
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return sendText(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

/* ------------------------------------------------------------------ */
/*  Server                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Internal server error' });
    else res.end();
  }
});

ensureDb()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`\n  Ledger is running`);
      console.log(`  → http://localhost:${PORT}\n`);
      console.log(`  Data file: ${DB_FILE}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\nShutting down…');
  server.close(() => process.exit(0));
});