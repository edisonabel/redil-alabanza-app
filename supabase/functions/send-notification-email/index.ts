import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.1.2";

type NotificationRow = {
  id?: string;
  perfil_id?: string;
  titulo?: string;
  contenido?: string;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRow;
  new?: NotificationRow;
} & NotificationRow;

const JSON_HEADERS = { "Content-Type": "application/json" };

const getNotificationFromPayload = (payload: WebhookPayload): NotificationRow => {
  if (payload?.record && typeof payload.record === "object") return payload.record;
  if (payload?.new && typeof payload.new === "object") return payload.new;
  return payload;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey || !resendApiKey) {
      return new Response(
        JSON.stringify({
          error: "Missing required env secrets",
          required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"],
        }),
        { status: 500, headers: JSON_HEADERS },
      );
    }

    const payload = (await req.json()) as WebhookPayload;
    const notification = getNotificationFromPayload(payload);

    const perfilId = notification?.perfil_id?.trim() ?? "";
    const titulo = notification?.titulo?.trim() ?? "";
    const contenido = notification?.contenido?.trim() ?? "";

    if (!perfilId || !titulo || !contenido) {
      return new Response(
        JSON.stringify({
          error: "Invalid payload: perfil_id, titulo and contenido are required",
          received: { perfil_id: perfilId, titulo, contenido },
        }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: perfil, error: perfilError } = await supabase
      .from("perfiles")
      .select("id, email, nombre")
      .eq("id", perfilId)
      .maybeSingle();

    if (perfilError) {
      console.error("Error fetching perfil:", perfilError);
      return new Response(JSON.stringify({ error: "Error fetching perfil" }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }

    const email = (perfil?.email ?? "").trim();
    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({
          error: "Perfil has no valid email assigned",
          perfil_id: perfilId,
          email,
        }),
        { status: 422, headers: JSON_HEADERS },
      );
    }

    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: "Worship App <onboarding@resend.dev>",
      to: [email],
      subject: titulo,
      html: `<strong>${escapeHtml(titulo)}</strong><p>${escapeHtml(contenido)}</p>`,
    });

    if (error) {
      console.error("Resend send error:", error);
      return new Response(JSON.stringify({ error: "Failed to send email", details: error }), {
        status: 502,
        headers: JSON_HEADERS,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        notification_id: notification?.id ?? null,
        perfil_id: perfilId,
        sent_to: email,
        resend_id: data?.id ?? null,
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (err) {
    console.error("Unhandled send-notification-email error:", err);
    return new Response(
      JSON.stringify({
        error: "Unhandled error",
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
});

