import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { senderEmail?: string; messageBody?: string };
    if (!body.messageBody?.trim()) {
      return NextResponse.json({ error: 'messageBody is required.' }, { status: 400 });
    }
    const result = await workspaceService.recordClientReply(
      id,
      body.senderEmail ?? '',
      body.messageBody,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to analyze reply' },
      { status: 400 },
    );
  }
}
