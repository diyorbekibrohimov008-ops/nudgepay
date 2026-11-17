import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST() {
  const view = await workspaceService.resetDemo();
  return NextResponse.json(view);
}
