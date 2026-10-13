import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const databasePath = join(projectRoot, 'data', 'tasks.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

// SQLite dosyası ilk çalıştırmada açılır; tablo yoksa bu SQL oluşturur.
const database = new DatabaseSync(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL CHECK (priority IN ('Düşük', 'Orta', 'Yüksek')),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL
  )
`);

const priorities = new Set(['Düşük', 'Orta', 'Yüksek']);
const port = Number(process.env.API_PORT || 3001);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
  };
}

function listTasks() {
  const rows = database.prepare(`
    SELECT id, title, description, priority, completed, created_at
    FROM tasks
    ORDER BY created_at DESC, id DESC
  `).all();
  return rows.map(toTask);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let rawBody = '';
  for await (const chunk of request) {
    rawBody += chunk;
    if (rawBody.length > 1_000_000) {
      throw new HttpError(413, 'İstek gövdesi çok büyük.');
    }
  }

  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, 'Geçerli bir JSON gövdesi gönder.');
  }
}

function validateTask(input, { allowCompleted = false, allowCreatedAt = false } = {}) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const priority = input?.priority;

  if (!title || title.length > 90) {
    throw new HttpError(400, 'Görev adı 1 ile 90 karakter arasında olmalı.');
  }
  if (description.length > 240) {
    throw new HttpError(400, 'Açıklama en fazla 240 karakter olabilir.');
  }
  if (!priorities.has(priority)) {
    throw new HttpError(400, 'Öncelik Düşük, Orta veya Yüksek olmalı.');
  }

  const task = { title, description, priority, completed: false, createdAt: new Date().toISOString() };
  if (allowCompleted && typeof input.completed === 'boolean') {
    task.completed = input.completed;
  }
  if (allowCreatedAt && typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt))) {
    task.createdAt = input.createdAt;
  }
  return task;
}

function insertTask(task) {
  const result = database.prepare(`
    INSERT INTO tasks (title, description, priority, completed, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(task.title, task.description, task.priority, Number(task.completed), task.createdAt);

  return database.prepare(`
    SELECT id, title, description, priority, completed, created_at
    FROM tasks WHERE id = ?
  `).get(Number(result.lastInsertRowid));
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/api/tasks') {
    return sendJson(response, 200, listTasks());
  }

  if (request.method === 'POST' && pathname === '/api/tasks') {
    const task = validateTask(await readJson(request));
    return sendJson(response, 201, toTask(insertTask(task)));
  }

  // Eski tarayıcı kaydını bir kez SQLite'a taşı; dolu veritabanına dokunma.
  if (request.method === 'POST' && pathname === '/api/tasks/import') {
    const body = await readJson(request);
    if (!Array.isArray(body.tasks) || body.tasks.length > 500) {
      throw new HttpError(400, 'Aktarılacak görev listesi geçersiz.');
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      const existingCount = database.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
      if (existingCount > 0) {
        database.exec('COMMIT');
        return sendJson(response, 200, { imported: 0, tasks: listTasks() });
      }

      const imported = body.tasks.map((item) =>
        validateTask(item, { allowCompleted: true, allowCreatedAt: true }),
      );
      for (const task of imported.reverse()) insertTask(task);
      database.exec('COMMIT');
      return sendJson(response, 200, { imported: imported.length, tasks: listTasks() });
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  const taskRoute = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskRoute && request.method === 'PATCH') {
    const body = await readJson(request);
    if (typeof body.completed !== 'boolean') {
      throw new HttpError(400, 'Tamamlanma durumu true veya false olmalı.');
    }

    const result = database.prepare('UPDATE tasks SET completed = ? WHERE id = ?')
      .run(Number(body.completed), Number(taskRoute[1]));
    if (result.changes === 0) throw new HttpError(404, 'Görev bulunamadı.');

    const row = database.prepare(`
      SELECT id, title, description, priority, completed, created_at
      FROM tasks WHERE id = ?
    `).get(Number(taskRoute[1]));
    return sendJson(response, 200, toTask(row));
  }

  if (taskRoute && request.method === 'DELETE') {
    const result = database.prepare('DELETE FROM tasks WHERE id = ?').run(Number(taskRoute[1]));
    if (result.changes === 0) throw new HttpError(404, 'Görev bulunamadı.');
    response.writeHead(204);
    return response.end();
  }

  throw new HttpError(404, 'Bu API adresi bulunamadı.');
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!response.headersSent) {
      sendJson(response, status, {
        error: status === 500 ? 'Sunucuda beklenmeyen bir hata oluştu.' : error.message,
      });
    } else {
      response.destroy();
    }
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`API portu ${port} zaten kullanımda.`);
  } else {
    console.error('API sunucusu başlatılamadı:', error.message);
  }
  database.close();
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Görev API hazır: http://127.0.0.1:${port}`);
  console.log(`SQLite dosyası: ${databasePath}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
