import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function limpiarNombreArchivo(nombre) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes y diacríticos
    .replace(/[^a-zA-Z0-9.-]/g, '_')   // Remueve espacios y caracteres especiales
    .toLowerCase();
}

export const POST = async ({ request, cookies }) => {
  try {
    // 1. Extracción y limpieza extrema de variables (quita espacios ocultos y evita undefined)
    const r2Endpoint = String(import.meta.env.R2_ENDPOINT || '').trim();
    const r2AccessKey = String(import.meta.env.R2_ACCESS_KEY_ID || '').trim();
    const r2SecretKey = String(import.meta.env.R2_SECRET_ACCESS_KEY || '').trim();
    const r2Bucket = String(import.meta.env.R2_BUCKET_NAME || '').trim();
    const publicR2Url = String(import.meta.env.PUBLIC_R2_URL || '').trim();

    // Verificación de seguridad en consola
    console.log("[API R2] Endpoint Limpio:", r2Endpoint);
    console.log("[API R2] Bucket Limpio:", r2Bucket);

    if (!r2Endpoint || !r2Bucket) {
      throw new Error("Faltan variables vitales de Cloudflare en el .env");
    }

    // 2. Autenticación Supabase
    const token = cookies.get('sb-access-token')?.value;
    if (!token) {
      return new Response(JSON.stringify({ error: 'No autorizado. Falta token de acceso.' }), { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'No autorizado. Token inválido o expirado.' }), { status: 401 });
    }

    const body = await request.json();
    const { fileName, fileType } = body;

    if (!fileName) {
      return new Response(JSON.stringify({ error: 'Se requiere el nombre del archivo (fileName).' }), { status: 400 });
    }

    // 3. Inicializar cliente S3
    const s3Client = new S3Client({
      region: "auto",
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: r2AccessKey,
        secretAccessKey: r2SecretKey,
      },
    });

    const cleanedFileName = limpiarNombreArchivo(fileName);
    const uniqueFileName = `${Date.now()}_${cleanedFileName}`;

    // 4. Crear el comando con el Bucket limpio
    const command = new PutObjectCommand({
      Bucket: r2Bucket,
      Key: uniqueFileName,
      ContentType: fileType || 'application/octet-stream', 
    });

    // 5. Generar URL (Aquí es donde explotaba antes, ya no lo hará)
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    const publicUrl = `${publicR2Url}/${uniqueFileName}`;

    return new Response(JSON.stringify({ presignedUrl, publicUrl }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Error generando Presigned URL:', error);
    return new Response(JSON.stringify({ error: 'Error interno del servidor detallado: ' + error.message }), { status: 500 });
  }
};
