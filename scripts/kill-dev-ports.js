// Free dev ports before starting (fixes EADDRINUSE from leftover npm run dev).
const { execSync } = require('child_process');

const PORTS = [3001, 5173, 5174];

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const m = line.match(/LISTENING\s+(\d+)/);
        if (m) pids.add(m[1]);
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
      out.trim().split('\n').filter(Boolean).forEach((id) => pids.add(id));
    }
  } catch {
    /* port free */
  }
  return [...pids];
}

for (const port of PORTS) {
  for (const procId of pidsOnPort(port)) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${procId}`, { stdio: 'ignore' });
      } else {
        execSync(`kill -9 ${procId}`, { stdio: 'ignore' });
      }
      console.log(`[dev] freed port ${port} (PID ${procId})`);
    } catch {
      /* already gone */
    }
  }
}
