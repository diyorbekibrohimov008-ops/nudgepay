import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const view = await workspaceService.sendManualNudge(id);
    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send nudge' },
      { status: 400 },
    );
  }
}
