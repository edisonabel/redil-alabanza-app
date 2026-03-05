import { defineMiddleware } from "astro:middleware";

/**
 * Enterprise SSR Authentication Middleware
 * ----------------------------------------
 * Este middleware actúa como la primera línea de defensa (Guardia Frontal) 
 * interceptando todas las peticiones al servidor antes de renderizar las páginas Astro.
 * 
 * Flujo de Seguridad:
 * 1. Omitir recursos estáticos para maximizar rendimiento.
 * 2. Extraer el token de acceso nativo desde las cookies.
 * 3. Prevenir acceso a rutas protegidas sin un token válido, forzando redirección a /login.
 * 4. Optimizar UX redirigiendo usuarios ya autenticados lejos de las rutas de registro y login.
 */
export const onRequest = defineMiddleware(async (context, next) => {
    const { cookies, url, redirect } = context;
    const path = url.pathname;

    // 1. Optimización: Omitir verificación en assets estáticos y recursos internos de Astro
    if (
        path.startsWith('/_astro') ||
        path.startsWith('/assets') ||
        path.match(/\.(png|ico|svg|webmanifest|css)$/)
    ) {
        return next();
    }

    // 2. Extracción Robusta de Cookie (Safe Navigations vs Undefined)
    const tokenCookie = cookies.get('sb-access-token');
    const accessToken = tokenCookie ? tokenCookie.value : null;

    // 3. Gestión de Rutas Públicas (Login / Landing)
    if (path === '/login') {
        if (accessToken) {
            console.log(`[Middleware Guardia] Usuario autenticado detectado intentando acceder a ${path}. Redirigiendo a zona segura.`);
            return redirect('/programacion');
        }
        return next();
    }

    // 4. Protección de Rutas Internas
    const protectedRoutes = ["/", "/programacion", "/repertorio", "/perfil", "/equipo", "/herramientas"];

    // Verifica si la ruta solicitada coincide o es subruta de alguna protegida
    const isProtectedRoute = protectedRoutes.some(route => path === route || path.startsWith(route + "/"));

    // 5. Regla de Bloqueo Crítica
    if (isProtectedRoute && !accessToken) {
        console.warn(`[Middleware Guardia] 🛑 ACCESO DENEGADO - Cookie ausente o inválida en ruta protegida: ${path}`);
        return redirect('/login');
    }

    // 6. Acceso Concedido
    if (isProtectedRoute) {
        console.log(`[Middleware Guardia] ✅ ACCESO CONCEDIDO a ${path}`);
    }

    return next();
});
