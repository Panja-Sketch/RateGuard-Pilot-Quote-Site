import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApi } from './routes/api.js';
import { HttpError } from './engine/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export function createApp(ctx, auth, config = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } },
    crossOriginEmbedderPolicy: false,
  }));

  const origins = (config.corsOrigins || []).filter(Boolean);
  if (origins.length) {
    app.use('/api', (req, res, next) => {
      const o = req.get('origin');
      if (o && origins.includes(o)) {
        res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Filename', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
      }
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    });
  }

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'pilot-quote-site', synthetic: true }));
  app.get('/api/v1/openapi.json', (_req, res) => {
    const f = path.join(ROOT, 'docs', 'openapi.json');
    if (!fs.existsSync(f)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'OpenAPI document not found.' } });
    res.type('application/json').send(fs.readFileSync(f));
  });

  app.use('/api/v1', express.json({ limit: '2mb' }), buildApi(ctx, auth, config));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Unknown API route. See /api/v1/openapi.json.')));

  // static frontend (also what Firebase Hosting would serve)
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' } });
    console.error(`[error] ${req.method} ${req.path}:`, err);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server. The error was logged.' } });
  });
  return app;
}
