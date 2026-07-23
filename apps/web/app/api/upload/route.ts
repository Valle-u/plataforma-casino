import { type NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // En localhost: escribir a public/hero/
    if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const ext = file.name.split('.').pop() || 'webp';
      const fileName = `hero-${Date.now()}.${ext}`;
      const dir = path.join(process.cwd(), 'public', 'hero');
      const filePath = path.join(dir, fileName);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, buffer);
      return NextResponse.json({ url: `/hero/${fileName}`, fileName, sizeBytes: buffer.length });
    }

    // En Vercel: proxy al Railway backend via endpoint de hero uploads
    const apiFormData = new FormData();
    apiFormData.append('file', file, file.name);

    const res = await fetch(`${API_URL}/tenant/uploads/hero`, {
      method: 'POST',
      body: apiFormData,
      headers: {
        'X-Tenant-Host': request.headers.get('X-Tenant-Host') || 'demo.localhost',
        'Authorization': request.headers.get('Authorization') || '',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Error en el servidor');
      console.error('Upload proxy failed:', res.status, errText);
      return NextResponse.json({ error: `Error del servidor: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ url: data.url, storageKey: data.storageKey, sizeBytes: data.sizeBytes });
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' && 'message' in err ? err.message : null;
    const errMsg = typeof errObj === 'string' ? errObj : 'Error desconocido';
    console.error('Upload error:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
