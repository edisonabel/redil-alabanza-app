import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.1.2";

type NotificationRow = {
  id?: string;
  perfil_id?: string;
  titulo?: string;
  contenido?: string;
  source?: string;
  url?: string;
  cta_label?: string;
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

const toAbsoluteUrl = (value: string) => {
  const safeValue = value.trim();
  if (!safeValue) return "";

  const baseUrl =
    Deno.env.get("PUBLIC_SITE_URL") ??
    Deno.env.get("SITE_URL") ??
    Deno.env.get("URL") ??
    "https://alabanzaredilestadio.com";

  try {
    return new URL(safeValue, `${baseUrl.replace(/\/$/, "")}/`).toString();
  } catch {
    return "";
  }
};

const renderNotificationEmailHtml = ({
  title,
  body,
  ctaUrl,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
}) => {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeCtaLabel = escapeHtml(ctaLabel || "Abrir app");
  const absoluteCtaUrl = toAbsoluteUrl(ctaUrl);
  const ctaMarkup = absoluteCtaUrl
    ? `
      <div style="margin-top:24px;">
        <a href="${absoluteCtaUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0ea5e9;color:#ffffff;text-decoration:none;font-weight:700;">
          ${safeCtaLabel}
        </a>
      </div>
    `
    : "";

  return `
    <div style="margin:0;padding:24px;background:#0f172a;font-family:Arial,sans-serif;color:#e5eefb;">
      <div style="max-width:560px;margin:0 auto;padding:28px;border:1px solid rgba(148,163,184,0.2);border-radius:20px;background:#111827;">
        <p style="margin:0 0 10px;font-size:11px;letter-spacing:0.22em;font-weight:700;text-transform:uppercase;color:#67e8f9;">
          Alabanza Redil
        </p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#ffffff;">
          ${safeTitle}
        </h1>
        <p style="margin:0;font-size:15px;line-height:1.65;color:#cbd5e1;">
          ${safeBody}
        </p>
        ${ctaMarkup}
      </div>
    </div>
  `;
};

const writeAudit = async (
  supabase: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) => {
  try {
    const { error } = await supabase.from("notification_delivery_audit").insert([row]);
    if (error) {
      console.error("notification_delivery_audit insert error:", error);
    }
  } catch (error) {
    console.error("notification_delivery_audit unexpected error:", error);
  }
};

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
    const source = notification?.source?.trim() ?? "system";
    const url = notification?.url?.trim() ?? "";
    const ctaLabel = notification?.cta_label?.trim() ?? "Abrir app";

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
      await writeAudit(supabase, {
        channel: "email",
        status: "skipped",
        perfil_id: perfilId,
        notification_id: notification?.id ?? null,
        email: email || null,
        title: titulo,
        body: contenido,
        provider: "resend-edge-function",
        source,
        error_message: "missing-email",
        metadata: {
          url: toAbsoluteUrl(url) || null,
          cta_label: ctaLabel,
        },
      });

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
      html: renderNotificationEmailHtml({
        title: titulo,
        body: contenido,
        ctaUrl: url,
        ctaLabel,
      }),
    });

    if (error) {
      console.error("Resend send error:", error);
      await writeAudit(supabase, {
        channel: "email",
        status: "failed",
        perfil_id: perfilId,
        notification_id: notification?.id ?? null,
        email,
        title: titulo,
        body: contenido,
        provider: "resend-edge-function",
        source,
        error_message: typeof error === "object" ? JSON.stringify(error) : String(error),
        metadata: {
          url: toAbsoluteUrl(url) || null,
          cta_label: ctaLabel,
        },
      });
      return new Response(JSON.stringify({ error: "Failed to send email", details: error }), {
        status: 502,
        headers: JSON_HEADERS,
      });
    }

    await writeAudit(supabase, {
      channel: "email",
      status: "sent",
      perfil_id: perfilId,
      notification_id: notification?.id ?? null,
      email,
      title: titulo,
      body: contenido,
      provider: "resend-edge-function",
      provider_message_id: data?.id ?? null,
      source,
      metadata: {
        url: toAbsoluteUrl(url) || null,
        cta_label: ctaLabel,
      },
    });

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
