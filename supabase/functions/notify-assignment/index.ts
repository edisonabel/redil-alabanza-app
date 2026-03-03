import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Interfaz para el Payload del Trigger de Postgres que invoca esta función
interface WebhookPayload {
    asignacion_id: string;
    perfil_id: string;
}

serve(async (req) => {
    try {
        // 1. Validar el Request Method
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
        }

        // 2. Extraer Payload JWT Seguro
        const payload: WebhookPayload = await req.json()

        // Inicializar Supabase Admin Client usando Storage Secrets
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // 3. Buscar la información del músico y su asignación
        const { data: musico, error: musicoError } = await supabase
            .from('perfiles')
            .select('email, nombre, push_token')
            .eq('id', payload.perfil_id)
            .single()

        if (musicoError || !musico) throw new Error('Músico no encontrado')

        // 4. Integraciones de Notificación (Placeholder de Fases)
        console.log(`[ALERTA] Preparando envío para: ${musico.email}`)

        // 4A. Simulación: Enviar OTP/Email de Asignación por Supabase Auth Admin
        /*
          await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: musico.email,
            options: { redirectTo: 'https://tu-app.com/mi-agenda' }
          })
        */

        // 4B. Simulación: SMTP / Resend.com (Descomentar al implementar)
        /*
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Redil App <no-reply@redil.com>',
              to: musico.email,
              subject: `Nueva Asignación Dominical`,
              html: `<p>Hola ${musico.nombre}, has sido programado...</p>`
            })
          });
        */

        // 4C. Simulación: Expo Push Notifications (Mobile App)
        if (musico.push_token) {
            console.log(`[PUSH] Disparando a dispositivo móvil: ${musico.push_token}`)
            // const expoPushParams = { to: musico.push_token, title: "Nueva Asignación", body: "Revisa tu agenda." }...
        }

        return new Response(
            JSON.stringify({ success: true, message: `Email & Push programados para ${musico.email}` }),
            { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { "Content-Type": "application/json" }, status: 400 }
        )
    }
})
