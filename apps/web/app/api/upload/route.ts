import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

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
      const errText = await res.text().catch(() => 'Upload failed');
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('Upload proxy error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
