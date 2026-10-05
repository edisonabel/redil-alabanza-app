import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ChevronRight, ListMusic, Loader2 } from 'lucide-react';

export default function PanelGestionRepertorio({ libraryScope = 'general' }) {
  const isSinFiltros = libraryScope === 'sin_filtros';
  const headingId = `repertoire-management-${isSinFiltros ? 'sin-filtros' : 'general'}-title`;
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleAccess = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        window.location.href = '/login';
        return;
      }

      window.location.href = isSinFiltros ? '/admin/sin-filtros' : '/admin';
    } catch (err) {
      console.error('Error verificando sesión:', err);
      setErrorMessage('No se pudo verificar tu sesión. Intenta de nuevo.');
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="flex items-start gap-4 md:gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <ListMusic className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
          </div>
          <div>
            <h2 id={headingId} className="text-xl font-bold tracking-tight text-content">{isSinFiltros ? 'Repertorio de Sin Filtros' : 'Repertorio general'}</h2>
            <p className="mt-1 text-sm leading-relaxed text-content-muted max-w-lg">
              {isSinFiltros ? 'Carga y edita canciones exclusivas para los servicios de Sin Filtros.' : 'Edita canciones y recursos del repertorio general de la iglesia.'}
            </p>
            {errorMessage && (
              <p className="mt-3 text-sm font-semibold text-danger" role="alert">{errorMessage}</p>
            )}
          </div>
        </div>

        <button
          onClick={handleAccess}
          disabled={loading}
          aria-busy={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-action px-6 py-3 font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-action/90 hover:shadow-action/30 disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none md:w-auto"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              {isSinFiltros ? 'Gestionar Sin Filtros' : 'Gestionar repertorio general'}
              <ChevronRight className="ml-1 h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </section>
  );
}
