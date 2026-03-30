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
const INTERNAL_SECRET_HEADER = "x-notification-secret";

const getInternalFunctionSecret = () =>
  (Deno.env.get("NOTIFICATION_FUNCTION_SECRET") ?? "").trim() ||
  (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ executed: true, ...payload }), {
    status,
    headers: JSON_HEADERS,
  });

const authorizeInternalRequest = (req: Request) => {
  const expectedSecret = getInternalFunctionSecret();
  if (!expectedSecret) {
    return jsonResponse(
      {
        error: "Missing internal notification secret",
        required: ["NOTIFICATION_FUNCTION_SECRET or SUPABASE_SERVICE_ROLE_KEY"],
      },
      500,
    );
  }

  const receivedSecret = (req.headers.get(INTERNAL_SECRET_HEADER) ?? "").trim();
  if (!receivedSecret || receivedSecret !== expectedSecret) {
    return jsonResponse({ error: "Unauthorized internal request" }, 401);
  }

  return null;
};

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

const normalizeMultilineText = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .trim();

const escapeAndPreserveInlineText = (value: string) =>
  escapeHtml(value).replace(/\n/g, "<br />");

const DETAIL_LINE_PATTERN = /^[A-Za-z][^:\n]{0,31}:\s+.+$/;

const isDetailLine = (value: string) => DETAIL_LINE_PATTERN.test(value.trim());

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

const buildEmailPreheader = ({
  title,
  body,
}: {
  title: string;
  body: string;
}) => normalizeMultilineText([title, body].filter(Boolean).join(" - ")).slice(0, 140);

const renderEmailBodySections = (body: string) => {
  const normalizedBody = normalizeMultilineText(body);
  if (!normalizedBody) return "";

  const sections = normalizedBody
    .split(/\n\s*\n/g)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections
    .map((section) => {
      const lines = section
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (!lines.length) return "";

      if (lines.every(isDetailLine)) {
        const rows = lines
          .map((line) => {
            const separatorIndex = line.indexOf(":");
            const label = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();

            return `
              <tr>
                <td style="padding:0 0 10px 0;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7dd3fc;">
                  ${escapeHtml(label)}
                </td>
              </tr>
              <tr>
                <td style="padding:0 0 14px 0;font-size:17px;line-height:1.45;color:#f8fafc;font-weight:600;">
                  ${escapeAndPreserveInlineText(value)}
                </td>
              </tr>
            `;
          })
          .join("");

        return `
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border-collapse:collapse;border:1px solid rgba(125,211,252,0.18);border-radius:18px;background:#0b1220;">
            <tr>
              <td style="padding:18px 18px 8px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${rows}
                </table>
              </td>
            </tr>
          </table>
        `;
      }

      const paragraphHtml = escapeAndPreserveInlineText(lines.join("\n"));
      return `
        <div style="margin:0 0 18px;padding:18px 18px 16px;border-radius:18px;background:#111c30;border:1px solid rgba(148,163,184,0.16);">
          <p style="margin:0;font-size:16px;line-height:1.75;color:#dbe7f5;">
            ${paragraphHtml}
          </p>
        </div>
      `;
    })
    .join("");
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
  const safeCtaLabel = escapeHtml(ctaLabel || "Abrir app");
  const absoluteCtaUrl = toAbsoluteUrl(ctaUrl);
  const absoluteLogoUrl = toAbsoluteUrl("/LOGO REDIL LIGHT.png") || toAbsoluteUrl("/icon-192.png");
  const preheader = escapeHtml(buildEmailPreheader({ title, body }));
  const bodySections = renderEmailBodySections(body);
  const logoMarkup = absoluteLogoUrl
    ? `
      <div style="display:inline-block;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.08);">
        <img src="${absoluteLogoUrl}" alt="Alabanza Redil" width="28" height="28" style="display:block;width:28px;height:28px;object-fit:contain;" />
      </div>
    `
    : `
      <div style="display:inline-block;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.08);font-size:12px;font-weight:800;letter-spacing:0.2em;color:#f8fafc;">
        AR
      </div>
    `;
  const ctaMarkup = absoluteCtaUrl
    ? `
      <div style="margin-top:8px;">
        <a href="${absoluteCtaUrl}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#0ea5e9;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;box-shadow:0 14px 28px rgba(14,165,233,0.28);">
          ${safeCtaLabel}
        </a>
      </div>
    `
    : "";

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:#081120;font-family:Arial,sans-serif;color:#e5eefb;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
          ${preheader}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#081120;">
          <tr>
            <td style="padding:24px 14px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td style="padding:32px 28px;border-radius:28px;background:linear-gradient(180deg,#101b32 0%,#0b1220 100%);border:1px solid rgba(148,163,184,0.18);box-shadow:0 28px 60px rgba(2,8,23,0.45);">
                    <div style="margin:0 0 18px;">
                      ${logoMarkup}
                    </div>
                    <p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:0.24em;text-transform:uppercase;color:#67e8f9;">
                      Alabanza Redil
                    </p>
                    <h1 style="margin:0 0 18px;font-size:34px;line-height:1.15;color:#ffffff;">
                      ${safeTitle}
                    </h1>
                    ${bodySections}
                    ${ctaMarkup}
                    <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(148,163,184,0.14);font-size:13px;line-height:1.6;color:#94a3b8;">
                      Ministerio de Alabanza Redil
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
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
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const unauthorizedResponse = authorizeInternalRequest(req);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey || !resendApiKey) {
      return jsonResponse(
        {
          error: "Missing required env secrets",
          required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"],
        },
        500,
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
      return jsonResponse(
        {
          error: "Invalid payload: perfil_id, titulo and contenido are required",
          received: { perfil_id: perfilId, titulo, contenido },
        },
        400,
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
      return jsonResponse({ error: "Error fetching perfil" }, 500);
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

      return jsonResponse(
        {
          error: "Perfil has no valid email assigned",
          perfil_id: perfilId,
          email,
          audited: true,
        },
        422,
      );
    }

    const resendFrom = (Deno.env.get("RESEND_FROM") ?? "").trim() || "Worship App <onboarding@resend.dev>";
    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: resendFrom,
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
      return jsonResponse({ error: "Failed to send email", details: error, audited: true }, 502);
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

    return jsonResponse(
      {
        ok: true,
        audited: true,
        notification_id: notification?.id ?? null,
        perfil_id: perfilId,
        sent_to: email,
        resend_id: data?.id ?? null,
      },
      200,
    );
  } catch (err) {
    console.error("Unhandled send-notification-email error:", err);
    return jsonResponse(
      {
        error: "Unhandled error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
