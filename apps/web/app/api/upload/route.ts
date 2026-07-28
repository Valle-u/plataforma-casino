import { type NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function getFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    // --- 1. Auth: require Bearer token ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- 2. Parse form data ---
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // --- 3. Validate file size ---
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum: ${MAX_SIZE_BYTES / 1024 / 1024}MB` },
        { status: 413 },
      );
    }

    // --- 4. Validate MIME type ---
    if (!ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed: ${file.type}. Allowed: jpeg, png, webp, avif` },
        { status: 415 },
      );
    }

    // --- 5. Validate extension ---
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Extension not allowed: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
        { status: 415 },
      );
    }

    // --- 6. Local dev: write to public/hero/ ---
    if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileName = `hero-${Date.now()}${ext}`;
      const dir = path.join(process.cwd(), 'public', 'hero');
      const filePath = path.join(dir, fileName);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, buffer);
      return NextResponse.json({ url: `/hero/${fileName}`, fileName, sizeBytes: buffer.length });
    }

    // --- 7. Production: proxy to Railway backend ---
    const apiFormData = new FormData();
    apiFormData.append('file', file, file.name);

    const res = await fetch(`${API_URL}/tenant/uploads/hero`, {
      method: 'POST',
      body: apiFormData,
      headers: {
        'X-Tenant-Host': request.headers.get('X-Tenant-Host') || 'demo.localhost',
        'Authorization': authHeader,
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
