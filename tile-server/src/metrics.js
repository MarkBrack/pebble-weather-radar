import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const METRIC_NAMES = [
  'viewportRequests',
  'slippyTileRequests',
  'unauthorizedRequests',
  'renderErrors',
  'cacheHits',
  'cacheMisses'
];

function emptyCounts() {
  return Object.fromEntries(METRIC_NAMES.map((name) => [name, 0]));
}

function newState(now) {
  return {
    version: 1,
    firstRecordedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    totals: emptyCounts(),
    daily: {}
  };
}

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

export class RequestMetrics {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.now = options.now || (() => new Date());
    this.state = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.state) return;
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = newState(this.now());
    }
  }

  async write() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  record(name) {
    if (!METRIC_NAMES.includes(name)) throw new Error(`Unknown metric ${name}`);
    this.queue = this.queue.then(async () => {
      await this.load();
      const now = this.now();
      const day = dayKey(now);
      if (!this.state.daily[day]) this.state.daily[day] = emptyCounts();
      this.state.totals[name] += 1;
      this.state.daily[day][name] += 1;
      this.state.updatedAt = now.toISOString();

      const retainedDays = Object.keys(this.state.daily).sort().slice(-90);
      this.state.daily = Object.fromEntries(retainedDays.map((key) => [key, this.state.daily[key]]));
      await this.write();
    });
    return this.queue;
  }

  async snapshot() {
    await this.queue;
    await this.load();
    return JSON.parse(JSON.stringify(this.state));
  }
}
