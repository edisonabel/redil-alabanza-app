import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const logsDir = path.join(projectRoot, 'logs');
const port = Number(process.env.PORT || 4321);
const logPath = path.join(logsDir, 'local-server.log');
const url = `http://${getPrimaryLanAddress()}:${port}/`;

fs.mkdirSync(logsDir, { recursive: true });
fs.appendFileSync(logPath, `\n\n===== Lanzador ${new Date().toISOString()} =====\n`);

console.log('');
console.log('Redil Alabanza - servidor local');
console.log('================================');
console.log(`Proyecto: ${projectRoot}`);
console.log(`URL para celulares: ${url}`);
console.log(`Log: ${logPath}`);
console.log('');

let serverProcess = null;
let watchedPid = await getListeningPid(port);

if (await isPortOpen(port)) {
  console.log(`El servidor ya esta corriendo en el puerto ${port}.`);
  if (watchedPid) console.log(`PID detectado: ${watchedPid}`);
  fs.appendFileSync(logPath, `Servidor ya activo en puerto ${port}. PID: ${watchedPid || 'desconocido'}\n`);
  openUrl(url);
  startMemoryMonitor(() => watchedPid);
} else {
  await ensureDependencies();
  serverProcess = startServer();
  watchedPid = serverProcess.pid;

  const ready = await waitForPort(port, 45_000);
  if (!ready) {
    console.log('');
    console.log(`No pude confirmar que el puerto ${port} abriera. Revisa el log: ${logPath}`);
  } else {
    watchedPid = (await getListeningPid(port)) || serverProcess.pid;
    console.log('');
    console.log('Servidor listo.');
    console.log(`Abre desde el celular: ${url}`);
    openUrl(url);
  }

  startMemoryMonitor(() => watchedPid || serverProcess?.pid);
}

console.log('');
console.log('Deja esta ventana abierta mientras uses la app.');
console.log('Para apagar el servidor: cierra esta ventana o presiona Ctrl+C.');
console.log('');

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function getPrimaryLanAddress() {
  const addresses = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries = []]) =>
      entries
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => ({ name, address: entry.address }))
    )
    .sort((a, b) => scoreAddress(a) - scoreAddress(b));

  return addresses[0]?.address || '127.0.0.1';
}

function scoreAddress(item) {
  if (item.name === 'en0') return 0;
  if (item.name === 'en1') return 1;
  if (item.address.startsWith('192.168.')) return 2;
  if (item.address.startsWith('10.')) return 3;
  return 4;
}

async function ensureDependencies() {
  if (fs.existsSync(path.join(projectRoot, 'node_modules'))) return;

  console.log('No encontre node_modules. Instalando dependencias...');
  await runCommand('npm', ['install']);
}

function startServer() {
  console.log('Arrancando Astro en modo red local...');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n\n===== ${new Date().toISOString()} =====\n`);

  const child = spawn('npm', ['run', 'dev:lan'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });

  child.on('exit', (code) => {
    logStream.end(`\nServidor detenido con codigo ${code ?? 'desconocido'}.\n`);
    if (!shuttingDown) process.exit(code ?? 1);
  });

  return child;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} salio con codigo ${code}`));
    });
  });
}

async function isPortOpen(targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: targetPort, timeout: 600 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPort(targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(targetPort)) return true;
    await delay(500);
  }
  return false;
}

async function getListeningPid(targetPort) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${targetPort}`, '-sTCP:LISTEN', '-t']);
    const pid = Number(stdout.trim().split('\n')[0]);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function openUrl(targetUrl) {
  spawn('open', [targetUrl], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function startMemoryMonitor(getRootPid) {
  const print = async () => {
    const rootPid = Number(getRootPid());
    if (!Number.isFinite(rootPid) || rootPid <= 0) return;

    const snapshot = await getProcessSnapshot(rootPid);
    if (!snapshot) return;

    const time = new Date().toLocaleTimeString('es-CO', { hour12: false });
    const line = `[${time}] MONITOR servidor: memoria ${snapshot.memoryMb.toFixed(1)} MB | CPU ${snapshot.cpu.toFixed(
        1
      )}% | procesos ${snapshot.count}`;
    console.log(line);
    fs.appendFileSync(logPath, `${line}\n`);
  };

  print();
  setInterval(print, 10_000);
}

async function getProcessSnapshot(rootPid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,comm=']);
    const rows = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          cpu: Number(match[3]),
          rssKb: Number(match[4]),
        };
      })
      .filter(Boolean);

    const descendants = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
          descendants.add(row.pid);
          changed = true;
        }
      }
    }

    const selected = rows.filter((row) => descendants.has(row.pid));
    if (selected.length === 0) return null;

    return {
      count: selected.length,
      cpu: selected.reduce((sum, row) => sum + row.cpu, 0),
      memoryMb: selected.reduce((sum, row) => sum + row.rssKb, 0) / 1024,
    };
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
  process.exit(0);
}
