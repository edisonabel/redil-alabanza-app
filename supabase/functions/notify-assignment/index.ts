import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

interface WebhookPayload {
  asignacion_id?: string;
  perfil_id?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const INTERNAL_SECRET_HEADER = "x-notification-secret";

const isExpiredPushError = (error: unknown) => {
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : NaN;
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : NaN;
  return statusCode === 404 || statusCode === 410 || status === 404 || status === 410;
};

const configureWebPush = () => {
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? Deno.env.get("PUBLIC_VAPID_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? Deno.env.get("PRIVATE_VAPID_KEY") ?? "";
  const rawVapidSubject = Deno.env.get("VAPID_SUBJECT") ?? Deno.env.get("VAPID_EMAIL") ?? "";
  const vapidSubject = rawVapidSubject.includes(":") ? rawVapidSubject : (rawVapidSubject ? `mailto:${rawVapidSubject}` : "");

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return false;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return true;
};

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
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const unauthorizedResponse = authorizeInternalRequest(req);
    if (unauthorizedResponse) {
      return unauthorizedResponse;
    }

    const payload = (await req.json()) as WebhookPayload;
    const perfilId = String(payload?.perfil_id || "").trim();

    if (!perfilId) {
      return jsonResponse({ error: "perfil_id is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Missing Supabase env vars" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: musico, error: musicoError } = await supabase
      .from("perfiles")
      .select("id, email, nombre")
      .eq("id", perfilId)
      .maybeSingle();

    if (musicoError || !musico) {
      return jsonResponse({ error: "Musico no encontrado" }, 404);
    }

    const title = "Nueva asignacion de servicio";
    const body = `Hola ${musico.nombre || "musico"}, revisa tu agenda. Tienes una nueva asignacion en el equipo.`;

    let emailSent = false;
    let emailError: string | null = null;

    try {
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [INTERNAL_SECRET_HEADER]: getInternalFunctionSecret(),
        },
        body: JSON.stringify({
          perfil_id: perfilId,
          titulo: title,
          contenido: body,
          source: "assignment_notification",
          url: "/equipo",
          cta_label: "Ver agenda",
        }),
      });

      emailSent = emailResponse.ok;
      if (!emailResponse.ok) {
        emailError = await emailResponse.text();
      }
    } catch (error) {
      emailError = error instanceof Error ? error.message : String(error);
    }

    let push = {
      enabled: false,
      sent: 0,
      failed: 0,
      deleted: 0,
      total: 0,
    };

    if (configureWebPush()) {
      push.enabled = true;
      const { data: subscriptions, error: subscriptionsError } = await supabase
        .from("suscripciones_push")
        .select("id, suscripcion")
        .eq("user_id", perfilId);

      if (subscriptionsError) {
        push.failed += 1;
      } else {
        const uniqueSubscriptions = new Map<string, { id: string; suscripcion: Record<string, unknown> }>();

        for (const row of subscriptions || []) {
          const endpoint = typeof row?.suscripcion?.endpoint === "string" ? row.suscripcion.endpoint : "";
          if (!endpoint || uniqueSubscriptions.has(endpoint)) continue;
          uniqueSubscriptions.set(endpoint, {
            id: String(row?.id || ""),
            suscripcion: row?.suscripcion || {},
          });
        }

        push.total = uniqueSubscriptions.size;

        if (uniqueSubscriptions.size === 0) {
          await writeAudit(supabase, {
            channel: "push",
            status: "skipped",
            perfil_id: perfilId,
            title,
            body,
            provider: "web-push",
            source: "assignment_notification",
            error_message: "no-subscription",
            metadata: {
              url: "/equipo",
            },
          });
        }

        const results = await Promise.allSettled(
          Array.from(uniqueSubscriptions.values()).map(async (row) => {
            try {
              await webpush.sendNotification(row.suscripcion, JSON.stringify({
                title,
                body,
                url: "/equipo",
              }));
              return { status: "sent" as const };
            } catch (error) {
              if (isExpiredPushError(error) && row.id) {
                const { error: deleteError } = await supabase
                  .from("suscripciones_push")
                  .delete()
                  .eq("id", row.id);

                if (!deleteError) {
                  return { status: "deleted" as const };
                }
              }

              return {
                status: "failed" as const,
                errorMessage: error instanceof Error ? error.message : String(error),
              };
            }
          }),
        );

        for (const [index, result] of results.entries()) {
          const row = Array.from(uniqueSubscriptions.values())[index];
          if (result.status !== "fulfilled") {
            push.failed += 1;
            await writeAudit(supabase, {
              channel: "push",
              status: "failed",
              perfil_id: perfilId,
              endpoint: typeof row?.suscripcion?.endpoint === "string" ? row.suscripcion.endpoint : null,
              title,
              body,
              provider: "web-push",
              source: "assignment_notification",
              error_message: result.reason instanceof Error ? result.reason.message : String(result.reason),
              metadata: {
                url: "/equipo",
                subscription_id: row?.id || null,
              },
            });
            continue;
          }

          if (result.value.status === "sent") push.sent += 1;
          else if (result.value.status === "deleted") push.deleted += 1;
          else push.failed += 1;

          await writeAudit(supabase, {
            channel: "push",
            status: result.value.status,
            perfil_id: perfilId,
            endpoint: typeof row?.suscripcion?.endpoint === "string" ? row.suscripcion.endpoint : null,
            title,
            body,
            provider: "web-push",
            source: "assignment_notification",
            error_message: "errorMessage" in result.value ? result.value.errorMessage : null,
            metadata: {
              url: "/equipo",
              subscription_id: row?.id || null,
            },
          });
        }
      }
    } else {
      await writeAudit(supabase, {
        channel: "push",
        status: "skipped",
        perfil_id: perfilId,
        title,
        body,
        provider: "web-push",
        source: "assignment_notification",
        error_message: "missing-vapid",
        metadata: {
          url: "/equipo",
        },
      });
    }

    return jsonResponse(
      {
        success: true,
        perfil_id: perfilId,
        email: {
          sent: emailSent,
          error: emailError,
        },
        push,
      },
      200,
    );
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }
});
