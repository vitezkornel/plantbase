import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { askAgent } from 'core';

const PORT = 3000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatHtml = readFileSync(join(__dirname, 'chat.html'), 'utf-8');

const AskInputSchema = z.object({
  question: z.string().min(1),
});

function logError(err: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }),
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    logError(err);
    sendJson(res, 500, { error: 'Hiba történt a kérés feldolgozása közben.' });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: 'Érvénytelen kérés formátum.' });
    return;
  }

  const parsed = AskInputSchema.safeParse(json);
  if (!parsed.success) {
    sendJson(res, 400, { error: 'Kérlek, adj meg egy nem üres kérdést.' });
    return;
  }

  try {
    const result = await askAgent(parsed.data.question);
    sendJson(res, 200, { answer: result.answer, escalated: result.escalated });
  } catch (err) {
    logError(err);
    sendJson(res, 500, {
      error: 'Hiba történt a kérdés megválaszolása közben. Kérjük, próbáld újra.',
    });
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(chatHtml);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ask') {
    void handleAsk(req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Plantbase customer-chat demo listening on http://localhost:${PORT}`);
});
