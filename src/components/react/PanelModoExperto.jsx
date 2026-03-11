import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Terminal, Loader2, ChevronRight } from 'lucide-react';

export default function PanelModoExperto() {
  const [loading, setLoading] = useState(false);

  const handleAccess = async () => {
    try {
      setLoading(true);
      // Validar sesión activa antes de redirigir
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        alert('Sesión expirada. Por favor, inicia sesión nuevamente.');
        window.location.href = '/login';
        return;
      }
      
      window.location.href = '/admin';
    } catch (err) {
      console.error('Error verificando sesión:', err);
      alert('Error de autenticación.');
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden mb-6 transition-all hover:shadow-md">
      <div className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4 md:gap-5">
          <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center shrink-0 border border-slate-700 shadow-inner">
            <Terminal className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-content tracking-tight">Gestión de Repertorio</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-action/10 text-action border border-action/20">Modo Experto</span>
            </div>
            <p className="text-content-muted text-sm max-w-lg leading-relaxed">
              Acceso a herramientas avanzadas de administración, edición de metadatos en línea y carga directa de contenido multimedia a <strong className="font-semibold">Cloudflare R2</strong>.
            </p>
          </div>
        </div>
        
        <button
          onClick={handleAccess}
          disabled={loading}
          className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-action hover:bg-action/90 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-action/30 hover:-translate-y-0.5 disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              Entrar como Experto
              <ChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
