import { type NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name.split('.').pop() || 'webp';
    const fileName = `hero-${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), 'public', 'hero');
    const filePath = path.join(dir, fileName);

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, buffer);

    return NextResponse.json({
      url: `/hero/${fileName}`,
      fileName,
      sizeBytes: buffer.length,
    });
  } catch (err: unknown) {
    const isReadOnly = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EROFS';
    if (isReadOnly) {
      return NextResponse.json({
        error: 'El servidor de producción no acepta archivos. Usá una URL externa (CDN) o probá en localhost.',
        code: 'READONLY_FS',
      }, { status: 400 });
    }
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Error al subir la imagen' }, { status: 500 });
  }
}
