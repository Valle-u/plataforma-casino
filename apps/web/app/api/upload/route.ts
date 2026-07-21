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
    const cwd = process.cwd();
    const dir = path.join(cwd, 'public', 'hero');
    const filePath = path.join(dir, fileName);

    await mkdir(dir, { recursive: true });
    await writeFile(filePath, buffer);

    console.log(`Upload OK: ${fileName} (${buffer.length}B) → ${dir}`);

    return NextResponse.json({
      url: `/hero/${fileName}`,
      fileName,
      sizeBytes: buffer.length,
    });
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? err as Record<string, unknown> : {};
    const isReadOnly = errObj.code === 'EROFS';
    console.error(`Upload error: ${errObj.code || 'unknown'} - ${errObj.message || err}`);
    if (isReadOnly) {
      return NextResponse.json({
        error: 'El servidor de producción no acepta archivos. Usá una URL externa o probá en localhost.',
        code: 'READONLY_FS',
      }, { status: 400 });
    }
    return NextResponse.json({
      error: errObj.message ? String(errObj.message) : 'Error al subir la imagen',
    }, { status: 500 });
  }
}
