import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle, UploadCloud, Loader2, Plus } from 'lucide-react';

const EditableCell = ({ cancionId, campoBd, valorInicial, onSave, isSaving, anchoClases = "min-w-[8rem]", customInputClasses = "" }) => {
  const [valor, setValor] = useState(valorInicial || '');

  const defaultInputClasses = "w-full min-h-[44px] px-3 py-2 bg-transparent border border-transparent focus:border-brand focus:ring-1 focus:ring-brand hover:border-border transition-colors outline-none text-sm text-content truncate";
  const inputClasses = customInputClasses || defaultInputClasses;

  useEffect(() => {
    setValor(valorInicial || '');
  }, [valorInicial]);

  const handleBlur = () => {
    if (valor !== (valorInicial || '')) {
      onSave(cancionId, campoBd, valor);
    }
  };

  return (
    <div className={`relative flex items-center w-full ${anchoClases}`}>
      <input
        type="text"
        className={inputClasses}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={handleBlur}
        title={valor}
      />
      {isSaving && (
        <div className="absolute right-2 text-brand bg-surface rounded-full p-0.5 z-10">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
    </div>
  );
};

export default function AdminRepertorio() {
  const [canciones, setCanciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorTexto, setErrorTexto] = useState(null);

  // Estados
  const [uploading, setUploading] = useState({});
  const [savingCell, setSavingCell] = useState({});

  const [sessionUser, setSessionUser] = useState(null);

  useEffect(() => {
    verificarSesion();
  }, []);

  const verificarSesion = async () => {
    try {
      setLoading(true);
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        setSessionUser(null);
        setLoading(false);
        return;
      }
      
      setSessionUser(session.user);
      await cargarCanciones();
    } catch (err) {
      console.error('Error al verificar sesión:', err);
      setSessionUser(null);
      setLoading(false);
    }
  };

  const cargarCanciones = async () => {
    try {
      const { data, error } = await supabase
        .from('canciones')
        // eslint-disable-next-line max-len
        .select('id, titulo, cantante, tonalidad, bpm, categoria, voz, tema, estado, link_youtube, mp3, link_acordes, link_letras, link_voces, link_secuencias, chordpro')
        .order('titulo', { ascending: true });

      if (error) throw error;
      setCanciones(data || []);
    } catch (error) {
      console.error('Error al cargar:', error);
      setErrorTexto('Ocurrió un error al cargar el repertorio. Verifique sus permisos (RLS).');
    } finally {
      setLoading(false);
    }
  };

  const agregarCancion = async () => {
    try {
      setLoading(true);
      const nuevaCancion = {
        titulo: 'Nueva Canción',
        estado: 'Activa',
      };
      const { data, error } = await supabase
        .from('canciones')
        .insert([nuevaCancion])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setCanciones(prev => [data, ...prev]);
      }
    } catch (err) {
      console.error('Error al agregar:', err);
      alert('Error al añadir la canción.');
    } finally {
      setLoading(false);
    }
  };

  const guardarMetadata = async (cancionId, campoBd, nuevoValor) => {
    const keyContext = `${cancionId}_${campoBd}`;
    setSavingCell(prev => ({ ...prev, [keyContext]: true }));

    try {
      const updateData = { [campoBd]: nuevoValor === '' ? null : nuevoValor };
      const { error } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (error) throw error;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: nuevoValor };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error al guardar:', err);
      alert(`Error al guardar ${campoBd}`);
      // Revertir a DB value (reload) - opcional
    } finally {
      setSavingCell(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const manejarSubida = async (event, cancionId, campoBd) => {
    const file = event.target.files[0];
    if (!file) return;

    const keyContext = `${cancionId}_${campoBd}`;
    setUploading(prev => ({ ...prev, [keyContext]: true }));

    try {
      const response = await fetch('/api/get-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });

      if (!response.ok) throw new Error('No estás autorizado o hubo un error en el servidor.');

      const { presignedUrl, publicUrl } = await response.json();

      const uploadResponse = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      if (!uploadResponse.ok) throw new Error('Fallo al subir el archivo a R2.');

      const updateData = { [campoBd]: publicUrl };
      const { error: updateError } = await supabase
        .from('canciones')
        .update(updateData)
        .eq('id', cancionId);

      if (updateError) throw updateError;

      setCanciones(prev => prev.map(c => {
        if (c.id === cancionId) {
          return { ...c, [campoBd]: publicUrl };
        }
        return c;
      }));
    } catch (err) {
      console.error('Error subida:', err);
      alert(`Error multimedia: ${err.message}`);
    } finally {
      event.target.value = '';
      setUploading(prev => ({ ...prev, [keyContext]: false }));
    }
  };

  const renderizarCeldaArchivo = (cancion, campoBd) => {
    const valor = cancion[campoBd];
    const keyContext = `${cancion.id}_${campoBd}`;
    const estaCargando = uploading[keyContext];

    if (estaCargando) {
      return (
        <div className="flex justify-center items-center h-full text-brand min-w-[8rem]">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      );
    }

    if (valor && valor.trim() !== '') {
      return (
        <div className="flex justify-center items-center h-full text-green-500 min-w-[8rem]" title={valor}>
          <CheckCircle className="w-5 h-5" />
        </div>
      );
    }

    return (
      <div className="flex justify-center items-center h-full min-w-[8rem]">
        <label className="cursor-pointer group flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface text-action transition-all shadow-sm">
          <UploadCloud className="w-4 h-4" />
          <span className="text-xs font-semibold text-content group-hover:text-action transition-colors">Subir</span>
          <input
            type="file"
            hidden
            onChange={(e) => manejarSubida(e, cancion.id, campoBd)}
          />
        </label>
      </div>
    );
  };

  if (!loading && !sessionUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6 text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h2 className="text-2xl font-bold text-content mb-3">Acceso Restringido</h2>
        <p className="text-content-muted max-w-md mb-8">
          Debe iniciar sesión para gestionar el repertorio. Las políticas de seguridad (RLS) bloquean el acceso anónimo a esta sección.
        </p>
        <a 
          href="/login" 
          className="inline-flex items-center justify-center px-6 py-3 bg-action hover:bg-action/90 text-white font-semibold rounded-xl shadow-sm transition-all"
        >
          Ir a Iniciar Sesión
        </a>
      </div>
    );
  }

  return (
    <div className="antialiased w-full h-full flex flex-col">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 max-w-7xl mx-auto w-full">
        <div>
          <p className="text-content-muted leading-relaxed max-w-2xl text-sm">
            Gestor tipo Excel. Edita los metadatos directamente en las celdas y sube los archivos de forma instantánea.
          </p>
        </div>
        <button
          onClick={agregarCancion}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand text-white rounded-xl font-bold hover:bg-brand/90 transition-colors shadow disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Añadir Canción
        </button>
      </div>

      {errorTexto && (
        <div className="mx-4 p-4 mb-6 bg-red-50/10 border border-red-500/20 rounded-xl text-red-500 font-medium max-w-7xl">
          {errorTexto}
        </div>
      )}

      {loading && canciones.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 text-brand animate-spin" />
          <span className="text-content-muted font-medium tracking-wide">Cargando base de datos...</span>
        </div>
      ) : (
        <div className="w-full overflow-hidden border-y border-border bg-surface shadow-sm">
          <div className="overflow-x-auto h-[calc(100vh-280px)] min-h-[500px] bg-background">
            <table className="w-max text-left border-collapse bg-surface relative">
              <thead className="sticky top-0 z-20 bg-background border-b border-border shadow-sm">
                <tr className="text-xs uppercase tracking-wider text-content-muted font-bold divide-x divide-border">
                  {/* Fijas */}
                  <th className="sticky left-0 z-30 bg-background top-0 px-0 py-0 border-r border-border text-center overflow-hidden min-w-[14rem] max-w-[14rem]">
                    <div className="px-4 py-4 w-full h-full text-left truncate">Título / Cantante</div>
                  </th>
                  {/* Metadata */}
                  <th className="px-4 py-4 min-w-[6rem]">Tonalidad</th>
                  <th className="px-4 py-4 min-w-[5rem]">BPM</th>
                  <th className="px-4 py-4 min-w-[8rem]">Categoría</th>
                  <th className="px-4 py-4 min-w-[8rem]">Voz</th>
                  <th className="px-4 py-4 min-w-[8rem]">Tema</th>
                  <th className="px-4 py-4 min-w-[8rem]">Estado</th>
                  <th className="px-4 py-4 min-w-[10rem]">Youtube (URL)</th>
                  {/* Archivos R2 */}
                  <th className="px-4 py-4 text-center min-w-[8rem]">MP3</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Acordes</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Letras</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Voces</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">Secuencias</th>
                  <th className="px-4 py-4 text-center min-w-[8rem]">ChordPro</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {canciones.map((cancion) => (
                  <tr key={cancion.id} className="hover:bg-background/40 transition-colors group divide-x divide-border">
                    {/* Fijas */}
                    <td className="sticky left-0 z-10 bg-surface group-hover:bg-background/80 border-r border-border align-top min-w-[14rem] max-w-[14rem]">
                      <div className="flex flex-col justify-center gap-0.5 py-1.5 px-3">
                        <EditableCell
                          cancionId={cancion.id}
                          campoBd="titulo"
                          valorInicial={cancion.titulo}
                          onSave={guardarMetadata}
                          isSaving={savingCell[`${cancion.id}_titulo`]}
                          anchoClases="w-full"
                          customInputClasses="text-[13px] font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                        />
                        <div className="w-full">
                          <EditableCell
                            cancionId={cancion.id}
                            campoBd="cantante"
                            valorInicial={cancion.cantante}
                            onSave={guardarMetadata}
                            isSaving={savingCell[`${cancion.id}_cantante`]}
                            anchoClases="w-full"
                            customInputClasses="text-[11px] text-gray-500 dark:text-gray-400 bg-transparent border-none p-0 m-0 leading-none focus:ring-0 w-full h-auto shadow-none truncate"
                          />
                        </div>
                      </div>
                    </td>
                    
                    {/* Metadata */}
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="tonalidad" valorInicial={cancion.tonalidad} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tonalidad`]} anchoClases="min-w-[6rem] max-w-[6rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="bpm" valorInicial={cancion.bpm} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_bpm`]} anchoClases="min-w-[5rem] max-w-[5rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="categoria" valorInicial={cancion.categoria} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_categoria`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="voz" valorInicial={cancion.voz || cancion.voz_principal} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_voz`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="tema" valorInicial={cancion.tema} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_tema`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="estado" valorInicial={cancion.estado} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_estado`]} anchoClases="min-w-[8rem] max-w-[8rem]" />
                    </td>
                    <td className="p-0 align-top">
                      <EditableCell cancionId={cancion.id} campoBd="link_youtube" valorInicial={cancion.link_youtube} onSave={guardarMetadata} isSaving={savingCell[`${cancion.id}_link_youtube`]} anchoClases="min-w-[10rem] max-w-[10rem]" />
                    </td>

                    {/* Archivos R2 */}
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'mp3')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_acordes')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_letras')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_voces')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'link_secuencias')}</td>
                    <td className="p-1 align-middle">{renderizarCeldaArchivo(cancion, 'chordpro')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canciones.length === 0 && !loading && (
            <div className="p-12 text-center text-content-muted font-medium bg-surface">
              Aún no hay canciones creadas. Haz clic en "Añadir Canción" para comenzar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
