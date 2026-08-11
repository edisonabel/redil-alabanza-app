import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Terminal, Loader2, ChevronRight } from 'lucide-react';

export default function PanelModoExperto() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleAccess = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      // Validar sesión activa antes de redirigir
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        window.location.href = '/login';
        return;
      }
      
      window.location.href = '/admin';
    } catch (err) {
      console.error('Error verificando sesión:', err);
      setErrorMessage('No se pudo verificar tu sesión. Intenta de nuevo.');
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby="repertoire-management-title">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="flex items-start gap-4 md:gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 shadow-inner">
            <Terminal className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 id="repertoire-management-title" className="text-xl font-bold tracking-tight text-content">Gestión de Repertorio</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-action/10 text-action border border-action/20">Modo Experto</span>
            </div>
            <p className="text-content-muted text-sm max-w-lg leading-relaxed">
              Edita canciones, metadatos y archivos desde el panel avanzado.
            </p>
            {errorMessage && (
              <p className="mt-3 text-sm font-semibold text-danger" role="alert">{errorMessage}</p>
            )}
          </div>
        </div>
        
        <button
          onClick={handleAccess}
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-action px-6 py-3 font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-action/90 hover:shadow-action/30 disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none md:w-auto"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              Abrir modo experto
              <ChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </button>
      </div>
    </section>
  );
}
