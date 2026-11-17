import { NextResponse } from 'next/server';
import { parsePdfInvoice } from '@/lib/pdf-invoice-parser';
import { workspaceService } from '@/lib/workspace-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'PDF file is required.' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF exceeds 10 MB limit.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
      return NextResponse.json({ error: 'Uploaded file does not have a valid %PDF header.' }, { status: 400 });
    }

    const parsed = parsePdfInvoice(buffer);
    const pdfBlobPathname = await workspaceService.storage.savePdf(file.name, buffer);

    return NextResponse.json({
      filename: file.name,
      pdfBlobPathname,
      parsed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse PDF invoice.' },
      { status: 500 },
    );
  }
}
