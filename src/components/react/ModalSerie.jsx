import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function ModalSerie({ sessionUser }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [previewText, setPreviewText] = useState('');
    const [collisionDate, setCollisionDate] = useState(null);

    const [formData, setFormData] = useState({
        titulo: '',
        dia: '0',
        horaInicio: '',
        horaFin: '',
        estado: 'Publicado',
        fechaInicio: '',
        fechaLimite: ''
    });

    useEffect(() => {
        window.openSerieModal = () => {
            const today = new Date();
            // Evitar problemas timezone UTC al sacar la start date reusando un constructor timezone-safe
            const todayStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[0];

            setFormData(prev => ({
                ...prev,
                fechaInicio: todayStr,
                fechaLimite: `${today.getFullYear()}-12-31`
            }));

            setIsOpen(true);
        };

        return () => {
            delete window.openSerieModal;
        }
    }, []);

    useEffect(() => {
        const calculatePreview = () => {
            if (!formData.fechaInicio || !formData.fechaLimite || !formData.dia) return;
            const dia = parseInt(formData.dia);

            // To prevent UTC bug, count using an isolated absolute noon clock.
            let count = 0;
            const start = new Date(formData.fechaInicio + 'T12:00:00Z');
            const end = new Date(formData.fechaLimite + 'T12:00:00Z');

            let cursor = new Date(start);
            while (cursor <= end) {
                if (cursor.getUTCDay() === dia) count++;
                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }

            if (count > 0) {
                const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                setPreviewText(`Se generarán ${count} eventos cada ${dias[dia]} desde el ${formData.fechaInicio} hasta el ${formData.fechaLimite}`);
            } else {
                setPreviewText('No se encontraron fechas coincidentes en este rango.');
            }
        };
        calculatePreview();
    }, [formData.fechaInicio, formData.fechaLimite, formData.dia]);

    const handleChange = (e) => {
        let { name, value } = e.target;
        if (name === 'fechaLimite') {
            const currentYear = new Date().getFullYear();
            const selectedYear = parseInt(value.substring(0, 4), 10);
            if (selectedYear > currentYear) {
                alert(`La fecha límite no puede pasar del año en curso (${currentYear}).`);
                value = `${currentYear}-12-31`;
            }
        }
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGenerate = async (e) => {
        e.preventDefault();

        if (!formData.titulo || !formData.dia || !formData.horaInicio || !formData.fechaInicio || !formData.fechaLimite) {
            alert('Completa todos los campos obligatorios.');
            return;
        }

        const currentYear = new Date().getFullYear();
        if (parseInt(formData.fechaLimite.substring(0, 4), 10) > currentYear) {
            alert(`La fecha límite no puede pasar del año en curso (${currentYear}).`);
            return;
        }

        setIsLoading(true);

        try {
            // 1. Check for Collisions
            const startCheck = new Date(formData.fechaInicio + 'T00:00:00Z').toISOString();
            const endCheck = new Date(formData.fechaLimite + 'T23:59:59Z').toISOString();

            const { data: existingEvents, error: fetchErr } = await supabase
                .from('eventos')
                .select('fecha_hora')
                .gte('fecha_hora', startCheck)
                .lte('fecha_hora', endCheck);

            if (fetchErr) {
                alert("Error al verificar eventos existentes: " + fetchErr.message);
                setIsLoading(false);
                return;
            }

            const existingDatesSet = new Set(
                (existingEvents || []).map(ev => {
                    if (!ev.fecha_hora) return null;
                    // Extraer "YYYY-MM-DD" de manera segura local si el servidor manda ISO UTC puro.
                    return ev.fecha_hora.split('T')[0];
                }).filter(Boolean)
            );

            const dia = parseInt(formData.dia);
            const uuidSerie = crypto.randomUUID();
            const eventos = [];

            // 2. Generate robust times
            const start = new Date(formData.fechaInicio + 'T12:00:00Z');
            const end = new Date(formData.fechaLimite + 'T12:00:00Z');
            const cursor = new Date(start);

            while (cursor <= end) {
                if (cursor.getUTCDay() === dia) {
                    const dStr = cursor.toISOString().slice(0, 10);

                    // COLLISION VALIDATION
                    if (existingDatesSet.has(dStr)) {
                        setCollisionDate(dStr);
                        setIsLoading(false);
                        return;
                    }

                    const localDate = new Date(`${dStr}T00:00:00`);
                    const [h, m] = formData.horaInicio.split(':').map(Number);
                    localDate.setHours(h, m, 0, 0);

                    eventos.push({
                        titulo: formData.titulo,
                        fecha_hora: localDate.toISOString(),
                        hora_fin: formData.horaFin || null,
                        estado: formData.estado,
                        created_by: sessionUser?.id || null,
                        serie_id: uuidSerie
                    });
                }
                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }

            if (eventos.length === 0) {
                alert("No hay fechas seleccionadas en ese rango coincidiendo con ese día de la semana.");
                setIsLoading(false);
                return;
            }

            // 3. Batch push
            for (let i = 0; i < eventos.length; i += 50) {
                const batch = eventos.slice(i, i + 50);
                const { error } = await supabase.from('eventos').insert(batch);
                if (error && !error.message?.includes('No rows returned') && error.code !== '201') throw error;
            }

            alert(`¡Serie creada! Se insertaron masivamente ${eventos.length} programaciones en el sistema.`);
            setIsOpen(false);
            window.location.reload();

        } catch (error) {
            console.error(error);
            alert("Error del sistema guardando la serie: " + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div role="dialog" aria-modal="true" data-ui-modal="true" className="fixed inset-0 z-[85] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity animate-in fade-in">
            <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
                <div className="p-6 border-b border-border flex justify-between items-center bg-background sticky top-0 z-10">
                    <h2 className="text-xl font-bold text-content flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-500"><path d="M17 2.1l4 4-4 4" /><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4" /><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2" /></svg>
                        Generador de Series
                    </h2>
                    <button type="button" onClick={() => setIsOpen(false)} className="text-content-muted hover:text-content p-2 -mr-2 bg-background hover:bg-border rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <form onSubmit={handleGenerate} className="p-6 flex flex-col gap-5 text-left">
                    <div>
                        <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">TÍTULO DEL EVENTO (RECURRENTE) <span className="text-red-500">*</span></label>
                        <input type="text" name="titulo" value={formData.titulo} onChange={handleChange} required className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" placeholder="Ej: Culto de Adoración" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">DÍA DE LA SEMANA <span className="text-red-500">*</span></label>
                            <select name="dia" value={formData.dia} onChange={handleChange} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors appearance-none">
                                <option value="0">Domingo</option>
                                <option value="1">Lunes</option>
                                <option value="2">Martes</option>
                                <option value="3">Miércoles</option>
                                <option value="4">Jueves</option>
                                <option value="5">Viernes</option>
                                <option value="6">Sábado</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Hora Inicio <span className="text-red-500">*</span></label>
                            <input type="time" name="horaInicio" value={formData.horaInicio} onChange={handleChange} required className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Hora Fin <span className="text-content-muted font-normal lowercase">(opc)</span></label>
                            <input type="time" name="horaFin" value={formData.horaFin} onChange={handleChange} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Estado</label>
                            <select name="estado" value={formData.estado} onChange={handleChange} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors appearance-none">
                                <option value="Publicado">Publicado</option>
                                <option value="Borrador">Borrador</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">Fecha Inicio <span className="text-red-500">*</span></label>
                            <input type="date" name="fechaInicio" value={formData.fechaInicio} onChange={handleChange} required className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-content uppercase tracking-wider mb-2">FECHA LÍMITE <span className="text-red-500">*</span></label>
                            <input type="date" name="fechaLimite" value={formData.fechaLimite} onChange={handleChange} required max={`${new Date().getFullYear()}-12-31`} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-content focus:outline-none focus:border-brand transition-colors" />
                            <p className="text-[10px] text-content-muted mt-1">Máximo: 31 de Diciembre del año en curso</p>
                        </div>
                    </div>

                    {previewText && (
                        <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 text-sm text-brand font-medium">
                            {previewText}
                        </div>
                    )}

                    <div className="flex gap-3 pt-4 border-t border-border">
                        <button type="button" onClick={() => setIsOpen(false)} className="flex-1 py-3.5 px-4 bg-background hover:bg-border border border-border text-sm text-content rounded-xl font-bold transition-colors">Cancelar</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3.5 px-4 bg-brand hover:bg-brand/90 text-white text-sm rounded-xl font-ui-strong transition-colors flex justify-center items-center gap-2">
                            <span>{isLoading ? 'Generando...' : 'Generar Serie'}</span>
                            {isLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                        </button>
                    </div>
                </form>
            </div>

            {/* ERROR MODAL NATIVO OVERRIDE (COLISIÃ“N) */}
            {collisionDate && (
                <div className="fixed inset-0 z-[100] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4" style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
                    <div className="bg-surface rounded-[2rem] shadow-2xl max-w-sm w-full overflow-hidden border border-red-100" style={{ animation: 'scaleUp 0.3s ease-in-out' }}>
                        <style>{`
                            @keyframes scaleUp { from { transform: scale(0.95) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
                            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        `}</style>
                        <div className="p-8 text-center pb-6">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-50 text-red-500 border-4 border-white shadow-[0_0_0_4px_rgba(254,226,226,0.5)] mx-auto mb-5 relative">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-ping"></div>
                                </div>
                            </div>
                            <h3 className="text-xl font-extrabold text-content mb-3 tracking-tight">¡Día Ocupado!</h3>
                            <p className="text-sm text-content-muted leading-relaxed">
                                Ya existe un evento en la base de datos para el día <br /> <strong className="text-red-500 bg-red-50 px-2 py-1 rounded-lg inline-block mt-2 mb-1">{collisionDate}</strong>
                            </p>
                            <p className="text-xs text-content-muted mt-4 px-2">
                                Para evitar sobreescribir o duplicar eventos, por favor ajusta tu límite de fecha o borra el evento conflictivo.
                            </p>
                        </div>
                        <div className="flex bg-background p-4 border-t border-red-100/50">
                            <button
                                type="button"
                                onClick={() => setCollisionDate(null)}
                                className="w-full py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold transition-colors shadow-sm shadow-red-500/20 active:scale-[0.98]"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

