import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  try {
    const patch = await request.json();
    const view = await workspaceService.updateSettings(patch);
    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update settings' },
      { status: 400 },
    );
  }
}
