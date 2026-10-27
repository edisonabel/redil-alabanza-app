// Administración → Importar ChordPro: una canción + capturas o PDF pegados → borrador de ChordPro.
// No guarda en la canción: devuelve el borrador para revisarlo; guardar lo hace el panel con su sesión.
// Usa el OCR de macOS, así que solo funciona en el servidor del laboratorio en la Mac.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv, getSupabaseServiceRoleKey, readEnv } from '../../lib/server/supabase-env.js';
import { createChordProReader, isChordProReaderAvailable } from '../../lib/server/chordproFromImages.js';
import { hasChordPro } from '../../utils/chordProImport.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
const serviceRoleKey = getSupabaseServiceRoleKey();
const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const serviceRoleClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const MAX_FILES = 8, MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/tiff': 'tiff', 'application/pdf': 'pdf' };
const readers = {};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const requireAdmin = async (cookies) => {
  if (!serviceRoleClient) throw Object.assign(new Error('Falta SUPABASE_SERVICE_ROLE_KEY.'), { status: 500 });
  const token = cookies.get('sb-access-token')?.value;
  if (!token) throw Object.assign(new Error('No autorizado.'), { status: 401 });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) throw Object.assign(new Error('No autorizado.'), { status: 401 });
  const { data: profile, error } = await serviceRoleClient.from('perfiles').select('id, is_admin').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (profile?.is_admin !== true) throw Object.assign(new Error('Solo un administrador puede importar ChordPro.'), { status: 403 });
  return user;
};

export const POST = async ({ request, cookies }) => {
  const dir = join(tmpdir(), 'alabanza-chordpro', randomUUID());
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: 'Origen no permitido.' }, 403);
    await requireAdmin(cookies);
    if (!isChordProReaderAvailable()) {
      return jsonResponse({ error: 'Esta función usa el OCR de macOS: ábrela desde el laboratorio en tu Mac.' }, 501);
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BYTES * 1.4) return jsonResponse({ error: 'Las imágenes superan 20 MB.' }, 413);
    const payload = await request.json().catch(() => null);
    const songId = String(payload?.songId || '').trim();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    if (!songId) return jsonResponse({ error: 'Elige la canción.' }, 400);
    if (!files.length || files.length > MAX_FILES) return jsonResponse({ error: `Pega entre 1 y ${MAX_FILES} imágenes o PDF.` }, 400);

    const { data: song, error } = await serviceRoleClient.from('canciones').select('id, titulo, chordpro').eq('id', songId).maybeSingle();
    if (error) throw error;
    if (!song) return jsonResponse({ error: 'No encontré esa canción.' }, 404);
    // Las canciones que ya tienen ChordPro no se transcriben: no se gastan tokens en ellas.
    if (hasChordPro(song.chordpro)) return jsonResponse({ error: `«${song.titulo}» ya tiene ChordPro: no se transcribe.` }, 409);

    mkdirSync(dir, { recursive: true });
    let total = 0;
    const paths = files.map((file, index) => {
      const extension = EXTENSIONS[file?.type];
      if (!extension) throw Object.assign(new Error('Solo imágenes (PNG, JPG, WEBP, HEIC) o PDF.'), { status: 415 });
      const bytes = Buffer.from(String(file.data || '').replace(/^data:[^,]+,/, ''), 'base64');
      total += bytes.length;
      if (!bytes.length || total > MAX_BYTES) throw Object.assign(new Error('Las imágenes están vacías o superan 20 MB.'), { status: 413 });
      const path = join(dir, `${String(index + 1).padStart(2, '0')}.${extension}`);
      writeFileSync(path, bytes);
      return path;
    });

    // «normal» es barato; «preciso» (modelo fuerte) solo cuando la persona lo pide con el botón.
    const mode = payload?.precise === true ? 'preciso' : 'normal';
    readers[mode] ??= createChordProReader({ root: process.cwd(), openaiKey: readEnv('OPENAI_API_KEY'), mode });
    const reader = readers[mode];
    const pages = reader.preparePages(paths, join(dir, 'paginas'));
    const result = await reader.transcribe(pages, join(dir, 'paginas'), { title: song.titulo });
    return jsonResponse({ songId: song.id, titulo: song.titulo, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('Admin ChordPro image import failed:', error);
    return jsonResponse({ error: error?.message || 'No se pudo leer la imagen.' }, status);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
