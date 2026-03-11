import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const R2_ACCOUNT_ID = import.meta.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = import.meta.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = import.meta.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = import.meta.env.R2_BUCKET_NAME;
const PUBLIC_R2_URL = import.meta.env.PUBLIC_R2_URL;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

function limpiarNombreArchivo(nombre) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes y diacríticos
    .replace(/[^a-zA-Z0-9.-]/g, '_')   // Remueve espacios y caracteres especiales
    .toLowerCase();
}

export const POST = async ({ request, cookies }) => {
  try {
    const token = cookies.get('sb-access-token')?.value;

    if (!token) {
      return new Response(JSON.stringify({ error: 'No autorizado. Falta token de acceso.' }), { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'No autorizado. Token inválido o expirado.' }), { status: 401 });
    }

    const body = await request.json();
    const { fileName } = body;

    if (!fileName) {
      return new Response(JSON.stringify({ error: 'Se requiere el nombre del archivo (fileName).' }), { status: 400 });
    }

    const cleanedFileName = limpiarNombreArchivo(fileName);
    const uniqueFileName = `${Date.now()}_${cleanedFileName}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: uniqueFileName,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const publicUrl = `${PUBLIC_R2_URL}/${uniqueFileName}`;

    return new Response(JSON.stringify({ presignedUrl, publicUrl }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error generando Presigned URL:', error);
    return new Response(JSON.stringify({ error: 'Error interno del servidor.' }), { status: 500 });
  }
};
