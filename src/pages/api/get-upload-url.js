import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSupabaseServerEnv, readEnv } from '../../lib/server/supabase-env.js';

const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();

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
    const r2Endpoint = readEnv('R2_ENDPOINT');
    const r2AccessKey = readEnv('R2_ACCESS_KEY_ID');
    const r2SecretKey = readEnv('R2_SECRET_ACCESS_KEY');
    const r2Bucket = readEnv('R2_BUCKET_NAME');
    const publicR2Url = readEnv('PUBLIC_R2_URL');

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
