// index.js — API entry point. Env required: JWT_SECRET (>=32 chars).
import { createServer } from './src/server.js';

const { PORT = 8080, DATA_DIR = './data', JWT_SECRET, ALLOWED_ORIGIN = '', PUBLIC_URL } = process.env;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET is not set. See .env.example'); process.exit(1); }

const { server, url } = await createServer({
  dataDir: DATA_DIR, jwtSecret: JWT_SECRET, port: Number(PORT),
  allowedOrigin: ALLOWED_ORIGIN, publicUrl: PUBLIC_URL || `http://localhost:${PORT}`
});
console.log(`[api] Code Studio Pro API listening on ${url}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log(`\n[api] ${sig} — shutting down`); server.close(() => process.exit(0)); });
