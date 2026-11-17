import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await workspaceService.runScheduler();
  return NextResponse.json({
    ok: true,
    dispatchedCount: result.dispatchedCount,
    effectiveNowIso: result.view.effectiveNowIso,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      advanceDays?: number;
      resetClock?: boolean;
    };
    const result = await workspaceService.runScheduler({
      advanceDays: body.advanceDays,
      resetClock: body.resetClock,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Scheduler tick failed' },
      { status: 400 },
    );
  }
}
