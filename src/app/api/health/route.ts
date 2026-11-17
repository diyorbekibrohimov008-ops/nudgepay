import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'nudgepay',
    storageMode: workspaceService.storage.isBlobBacked() ? 'vercel_blob' : 'local_json',
    timestamp: new Date().toISOString(),
  });
}
