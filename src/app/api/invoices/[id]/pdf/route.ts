import { NextResponse } from 'next/server';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const view = await workspaceService.getView();
  const inv = view.invoices.find((i) => i.id === id);
  if (!inv?.pdfBlobPathname) {
    return NextResponse.json({ error: 'PDF not found for this invoice.' }, { status: 404 });
  }

  const file = await workspaceService.storage.readPdf(inv.pdfBlobPathname);
  if (!file) {
    return NextResponse.json({ error: 'Stored PDF unavailable.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename="${inv.pdfFilename ?? 'invoice.pdf'}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
