/* Storage layer. Production uses a private Vercel Blob store; tests use the in-memory store.
 * Both expose the same four methods:
 *   getJson(path)                          -> object or null
 *   putJson(path, obj, { overwrite })      -> true, or throws ExistsError when overwrite is false and the path exists
 *   list(prefix)                           -> [{ pathname, uploadedAt }] (all pages)
 */
'use strict';

class ExistsError extends Error {
  constructor(path) { super('Already exists: ' + path); this.name = 'ExistsError'; }
}

function blobStore() {
  // Required lazily so tests never need the package.
  const blob = require('@vercel/blob');
  const opts = { access: 'private' };

  return {
    async getJson(path) {
      const res = await blob.get(path, { ...opts, useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const text = await new Response(res.stream).text();
      return JSON.parse(text);
    },
    async putJson(path, obj, { overwrite = false } = {}) {
      try {
        await blob.put(path, JSON.stringify(obj), {
          ...opts,
          addRandomSuffix: false,
          allowOverwrite: overwrite,
          contentType: 'application/json',
          cacheControlMaxAge: 60
        });
        return true;
      } catch (err) {
        if (!overwrite && /exist/i.test(String(err && err.message))) throw new ExistsError(path);
        throw err;
      }
    },
    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const page = await blob.list({ prefix, cursor, limit: 1000 });
        page.blobs.forEach((b) => out.push({ pathname: b.pathname, uploadedAt: b.uploadedAt }));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    }
  };
}

function memoryStore() {
  const data = new Map();
  return {
    data,
    async getJson(path) { return data.has(path) ? JSON.parse(data.get(path).body) : null; },
    async putJson(path, obj, { overwrite = false } = {}) {
      if (!overwrite && data.has(path)) throw new ExistsError(path);
      data.set(path, { body: JSON.stringify(obj), uploadedAt: new Date() });
      return true;
    },
    async list(prefix) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => ({ pathname: k, uploadedAt: v.uploadedAt }));
    }
  };
}

module.exports = { blobStore, memoryStore, ExistsError };
