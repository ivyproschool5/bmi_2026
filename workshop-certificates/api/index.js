/* Vercel serverless entry point: /api
 * GET  /api?action=workshop&code=XXXX     public workshop + questions (no answers)
 * GET  /api?action=verify&id=IVY-...       public certificate check
 * POST /api  payload={"action":"submit",...}   assessment submission
 * POST /api  payload={"action":"admin.*","adminKey":"..."}  trainer console
 */
'use strict';

const { handle } = require('./_lib/logic');
const { blobStore } = require('./_lib/store');

let store;

function parseBody(req) {
  let body = req.body;
  if (!body) return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{')) { try { return JSON.parse(trimmed); } catch (e) { return {}; } }
    body = Object.fromEntries(new URLSearchParams(body));
  }
  if (body && typeof body.payload === 'string') {
    try { return JSON.parse(body.payload); } catch (e) { return {}; }
  }
  return typeof body === 'object' ? body : {};
}

module.exports = async function (req, res) {
  store = store || blobStore();
  const query = Object.assign({}, req.query || {});
  const body = req.method === 'POST' ? parseBody(req) : {};
  const merged = Object.assign({}, query, body);
  const out = await handle(store, req.method, merged, { adminKey: process.env.ADMIN_KEY });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(out));
};
