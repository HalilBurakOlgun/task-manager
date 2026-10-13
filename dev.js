import { spawn } from 'node:child_process';
import { createServer as createProbeServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
let apiPort = Number(process.env.API_PORT || 3001);
const managedProcesses = [];
let shuttingDown = false;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createProbeServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

async function isTaskApiReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return false;
    return Array.isArray(await response.json());
  } catch {
    return false;
  }
}

async function findAvailablePort(startingAt) {
  for (let candidate = startingAt; candidate < startingAt + 20; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  return null;
}

function startManagedProcess(name, args) {
  const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: 'inherit' });
  const managed = { name, child };
  managedProcesses.push(managed);

  child.on('error', (error) => {
    console.error(`${name} başlatılamadı:`, error.message);
    process.exitCode = 1;
    stopAll();
  });

  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${name} kapandı (çıkış kodu: ${code ?? 'sinyal'}).`);
      process.exitCode = code || 1;
      stopAll();
    }
  });

  return child;
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of managedProcesses) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
}

async function start() {
  if (await isTaskApiReady(apiPort)) {
    console.log(`Mevcut SQLite API yeniden kullanılıyor: http://127.0.0.1:${apiPort}`);
  } else {
    if (!(await isPortAvailable(apiPort))) {
      const occupiedPort = apiPort;
      const fallbackPort = await findAvailablePort(apiPort + 1);
      if (fallbackPort === null) {
        throw new Error(`API için ${occupiedPort}–${occupiedPort + 19} aralığında boş port bulunamadı.`);
      }
      apiPort = fallbackPort;
      process.env.API_PORT = String(apiPort);
      console.warn(
        `Port ${occupiedPort} kullanımda ve API yanıt vermiyor; yeni API ${apiPort} portunda açılıyor.`,
      );
    }

    const apiProcess = startManagedProcess('SQLite API', ['server/index.js']);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && apiProcess.exitCode === null) {
      if (await isTaskApiReady(apiPort)) break;
      await delay(150);
    }

    if (!(await isTaskApiReady(apiPort))) {
      console.error(`SQLite API ${apiPort} portunda başlayamadı.`);
      process.exitCode = 1;
      stopAll();
      return;
    }
  }

  startManagedProcess('React / Vite', [
    'node_modules/vite/bin/vite.js',
    '--host',
    '0.0.0.0',
  ]);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

start().catch((error) => {
  console.error('Geliştirme sunucuları başlatılamadı:', error.message);
  process.exitCode = 1;
  stopAll();
});
