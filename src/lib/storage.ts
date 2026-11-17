import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSeedState } from './seed.ts';
import type { AppState } from './types.ts';

const STATE_BLOB_PATH = 'nudgepay/state.json';

export interface BlobDriver {
  put: (
    pathname: string,
    body: string | Buffer,
    options: {
      access: 'private' | 'public';
      allowOverwrite?: boolean;
      addRandomSuffix?: boolean;
      contentType?: string;
    },
  ) => Promise<{ pathname: string }>;
  get: (
    pathname: string,
    options: { access: 'private' | 'public'; useCache?: boolean },
  ) => Promise<{
    statusCode: number;
    stream: ReadableStream;
    blob: { contentType?: string };
  } | null>;
}

export interface StorageOptions {
  localDir?: string;
  blobDriver?: BlobDriver;
}

export function getEffectiveNowIso(simulatedDayOffset = 0, baseMs = Date.now()): string {
  return new Date(baseMs + simulatedDayOffset * 86_400_000).toISOString();
}

async function resolveBlobDriver(override?: BlobDriver): Promise<BlobDriver | null> {
  if (override) return override;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const blobMod = await import('@vercel/blob');
  return {
    put: blobMod.put as unknown as BlobDriver['put'],
    get: blobMod.get as unknown as BlobDriver['get'],
  };
}

async function resolveWritableDir(preferred?: string): Promise<string> {
  const candidates = preferred
    ? [preferred]
    : [path.join(process.cwd(), '.data'), path.join(os.tmpdir(), 'nudgepay-data')];

  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = path.join(dir, '.probe');
      await fs.writeFile(probe, 'ok', 'utf8');
      await fs.unlink(probe);
      return dir;
    } catch {
      continue;
    }
  }
  return path.join(os.tmpdir(), 'nudgepay-data');
}

export function createStorage(options: StorageOptions = {}) {
  let cachedDir: string | null = null;

  async function getLocalDir(): Promise<string> {
    if (!cachedDir) {
      cachedDir = await resolveWritableDir(options.localDir);
    }
    return cachedDir;
  }

  async function loadState(): Promise<AppState> {
    const blob = await resolveBlobDriver(options.blobDriver);
    if (blob) {
      try {
        const res = await blob.get(STATE_BLOB_PATH, { access: 'private', useCache: false });
        if (res && res.statusCode === 200) {
          const text = await new Response(res.stream).text();
          return JSON.parse(text) as AppState;
        }
      } catch {
        // Seed below if missing or unreadable
      }
      const seeded = createSeedState(new Date().toISOString());
      await saveState(seeded);
      return seeded;
    }

    const dir = await getLocalDir();
    const stateFile = path.join(dir, 'state.json');
    try {
      const raw = await fs.readFile(stateFile, 'utf8');
      return JSON.parse(raw) as AppState;
    } catch {
      const seeded = createSeedState(new Date().toISOString());
      await saveState(seeded);
      return seeded;
    }
  }

  async function saveState(state: AppState): Promise<void> {
    const blob = await resolveBlobDriver(options.blobDriver);
    const json = JSON.stringify(state);
    if (blob) {
      await blob.put(STATE_BLOB_PATH, json, {
        access: 'private',
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      return;
    }

    const dir = await getLocalDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'state.json'), json, 'utf8');
  }

  async function savePdf(filename: string, buffer: Buffer): Promise<string> {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'invoice.pdf';
    const pathname = `nudgepay/pdfs/${Date.now()}-${safeName}`;
    const blob = await resolveBlobDriver(options.blobDriver);
    if (blob) {
      const saved = await blob.put(pathname, buffer, {
        access: 'private',
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: 'application/pdf',
      });
      return saved.pathname;
    }

    const dir = await getLocalDir();
    const pdfDir = path.join(dir, 'pdfs');
    await fs.mkdir(pdfDir, { recursive: true });
    const localName = `${Date.now()}-${safeName}`;
    await fs.writeFile(path.join(pdfDir, localName), buffer);
    return `local:${localName}`;
  }

  async function readPdf(pathname: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (pathname.startsWith('local:')) {
      const dir = await getLocalDir();
      const filePath = path.join(dir, 'pdfs', pathname.slice(6));
      try {
        const buffer = await fs.readFile(filePath);
        return { buffer, contentType: 'application/pdf' };
      } catch {
        return null;
      }
    }

    const blob = await resolveBlobDriver(options.blobDriver);
    if (!blob) return null;
    try {
      const res = await blob.get(pathname, { access: 'private' });
      if (!res || res.statusCode !== 200) return null;
      const arr = await new Response(res.stream).arrayBuffer();
      return {
        buffer: Buffer.from(arr),
        contentType: res.blob.contentType ?? 'application/pdf',
      };
    } catch {
      return null;
    }
  }

  return {
    loadState,
    saveState,
    savePdf,
    readPdf,
    isBlobBacked: () => Boolean(options.blobDriver || process.env.BLOB_READ_WRITE_TOKEN),
  };
}

export const defaultStorage = createStorage();
