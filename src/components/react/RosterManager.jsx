import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

export default function RosterManager({ evId, evFechaStr, evTituloStr, evTemaStr, evEstadoStr, esAcustico = false, isStrictModerator, dbData }) {
    const [asignaciones, setAsignaciones] = useState(dbData?.asignaciones || []);
    const [roles, setRoles] = useState([]);

    // Pickers State
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerRolId, setPickerRolId] = useState(null);
    const [pickerRolName, setPickerRolName] = useState('');
    const [pickerSlotIndex, setPickerSlotIndex] = useState(null);
    const [pickerList, setPickerList] = useState([]);
    const [pickerLoading, setPickerLoading] = useState(false);

    const [equipoPickerOpen, setEquipoPickerOpen] = useState(false);
    const [equiposList, setEquiposList] = useState([]);
    const [equipoLoading, setEquipoLoading] = useState(false);

    useEffect(() => {
        if (dbData?.asignaciones) {
            setAsignaciones(dbData.asignaciones);
        }
    }, [dbData]);

    useEffect(() => {
        const hasCajaRole = (list = []) =>
            list.some((rol) => /(^|_)(caja|cajon)(_|$)/.test(String(rol.codigo || '')));
        const fetchRoles = async () => {
            const cachedRoles = Array.isArray(window.appStateRoles) ? window.appStateRoles : [];
            const shouldUseCache = cachedRoles.length > 0 && (!esAcustico || hasCajaRole(cachedRoles));
            if (shouldUseCache) {
                setRoles(cachedRoles);
                return;
            }
            const { data } = await supabase.from('roles').select('*').order('nombre');
            if (data) {
                setRoles(data);
                window.appStateRoles = data;
            }
        };
        fetchRoles();
    }, [esAcustico]);

    const effectiveRoles = useMemo(() => {
        const hasCajaRole = roles.some((rol) => /(^|_)(caja|cajon)(_|$)/.test(String(rol.codigo || '')));
        if (!esAcustico || hasCajaRole) return roles;

        return [
            ...roles,
            {
                id: '__virtual_caja__',
                codigo: 'caja',
                nombre: 'Caja',
                isVirtual: true
            }
        ];
    }, [roles, esAcustico]);

    const fetchCurrentRoster = async () => {
        if (!evId || evId.startsWith('virtual|')) return;
        const { data } = await supabase
            .from('eventos')
            .select('asignaciones(id, perfil_id, rol_id, perfiles(id, nombre, email, avatar_url))')
            .eq('id', evId)
            .single();
        if (data) {
            setAsignaciones(data.asignaciones || []);
        }
    };

    const handleRemove = async (assignmentId, rolId = null) => {
        if (!evId || evId.startsWith('virtual|')) return;
        const confirmDelete = window.confirm("¿Estás seguro de remover esta asignación?");
        if (!confirmDelete) return;

        let query = supabase.from('asignaciones').delete().eq('evento_id', evId);
        query = assignmentId ? query.eq('id', assignmentId) : query.eq('rol_id', rolId);
        const { error } = await query;

        if (!error) {
            await fetchCurrentRoster();
        } else {
            alert('Error: ' + error.message);
        }
    };

    const openPicker = async (rId, rName, slotIndex = null) => {
        if (!evId || evId.startsWith('virtual|')) {
            alert('Guarda/crea primero este evento para asignarle equipo.');
            return;
        }

        if (rId === '__virtual_caja__') {
            alert('Falta crear el rol "Caja" en la base de datos. Ejecuta la migración y recarga la vista.');
            return;
        }

        setPickerRolId(rId);
        setPickerRolName(rName);
        setPickerSlotIndex(slotIndex);
        setPickerOpen(true);
        setPickerLoading(true);
        setPickerList([]);

        const isVoicePool = rId === '_voz_pool';
        const voiceRoles = effectiveRoles.filter((rol) => String(rol.codigo || '').startsWith('voz_'));
        const voiceRoleIds = voiceRoles.map((rol) => rol.id);

        const [perfilesRoles, ausenciasResp] = await Promise.all([
            isVoicePool
                ? supabase
                    .from('perfil_roles')
                    .select('rol_id, perfiles!inner(*)')
                    .in('rol_id', voiceRoleIds)
                : supabase
                    .from('perfil_roles')
                    .select('rol_id, perfiles!inner(*)')
                    .eq('rol_id', rId),

            // Consulta B: Ausencias que choquen con la fecha del evento
            supabase
                .from('ausencias')
                .select('perfil_id, motivo')
                .lte('fecha_inicio', evFechaStr)
                .gte('fecha_fin', evFechaStr)
        ]);

        setPickerLoading(false);
        if (!perfilesRoles.error && perfilesRoles.data) {
            const mappedList = perfilesRoles.data.map(d => {
                const p = d.perfiles;
                const ausencia = ausenciasResp.data?.find(a => a.perfil_id === p.id);
                return {
                    ...p,
                    realRolId: d.rol_id,
                    realRolNombre: effectiveRoles.find(rol => rol.id === d.rol_id)?.nombre || rName,
                    ausente: Boolean(ausencia),
                    ausenteMotivo: ausencia?.motivo || ''
                };
            });
            setPickerList(mappedList);
        }
    };

    const selectUserForRole = async (perfilId, forcedRolId = null) => {
        setPickerLoading(true);
        const saveRolId = forcedRolId || pickerRolId;
        const isVoicePool = pickerRolId === '_voz_pool';
        const voiceRoleIds = effectiveRoles
            .filter((rol) => String(rol.codigo || '').startsWith('voz_'))
            .map((rol) => rol.id);

        if (isVoicePool) {
            const existingVoiceAssignments = asignaciones.filter((a) => voiceRoleIds.includes(a.rol_id));
            const duplicateVoice = existingVoiceAssignments.some((a) => (a.perfil_id || a.perfiles?.id) === perfilId);

            if (duplicateVoice) {
                alert('Esta persona ya está asignada en la sección de Voces para este evento.');
                setPickerLoading(false);
                return;
            }

            if (pickerSlotIndex !== null && existingVoiceAssignments[pickerSlotIndex]) {
                alert('Ese slot de voces ya está ocupado. Elige uno vacío.');
                setPickerLoading(false);
                return;
            }

            const { error } = await supabase.from('asignaciones').insert([{
                evento_id: evId,
                perfil_id: perfilId,
                rol_id: saveRolId
            }]);

            setPickerLoading(false);
            if (!error) {
                setPickerOpen(false);
                setPickerSlotIndex(null);
                await fetchCurrentRoster();
            } else {
                alert('Error: ' + error.message);
            }
            return;
        }

        // Validation for exclusive instrument assignment
        const newRol = effectiveRoles.find(r => r.id === saveRolId);
        if (newRol) {
            const isN1 = ['lider_alabanza', 'talkback'].includes(newRol.codigo);
            const isN2 = ['encargado_letras'].includes(newRol.codigo);
            const isVoz = String(newRol.codigo || '').startsWith('voz_');
            const isInstrumento = !isN1 && !isN2 && !isVoz;

            if (isInstrumento) {
                // Check if user already has an instrument role
                const userExistingAsig = asignaciones.filter(a => a.perfil_id === perfilId);
                const hasConflictingInstrument = userExistingAsig.some(a => {
                    if (a.rol_id === saveRolId) return false; // same role is fine to overwrite
                    const existingRol = effectiveRoles.find(r => r.id === a.rol_id);
                    if (!existingRol) return false;
                    const eIsN1 = ['lider_alabanza', 'talkback'].includes(existingRol.codigo);
                    const eIsN2 = ['encargado_letras'].includes(existingRol.codigo);
                    const eIsVoz = String(existingRol.codigo || '').startsWith('voz_');
                    const eIsInstrumento = !eIsN1 && !eIsN2 && !eIsVoz;
                    return eIsInstrumento;
                });

                if (hasConflictingInstrument) {
                    alert('Este músico/a ya está asignado a otro instrumento en la banda para este evento. (Un integrante puede cantar y tocar a la vez, pero no tocar 2 instrumentos simultáneamente).');
                    setPickerLoading(false);
                    return;
                }
            }
        }

        // Clean first
        await supabase.from('asignaciones').delete()
            .eq('evento_id', evId)
            .eq('rol_id', saveRolId);

        // Insert new
        const { error } = await supabase.from('asignaciones').insert([{
            evento_id: evId,
            perfil_id: perfilId,
            rol_id: saveRolId
        }]);

        setPickerLoading(false);
        if (!error) {
            setPickerOpen(false);
            setPickerSlotIndex(null);
            await fetchCurrentRoster();
        } else {
            alert('Error: ' + error.message);
        }
    };

    const openEquipoPicker = async () => {
        // Enforce virtual event persistence before loading equipo
        if (!evId || evId.startsWith('virtual|')) {
            alert('Debes guardar el evento al menos una vez antes de auto-cargar una plantilla de equipo.');
            return;
        }

        setEquipoPickerOpen(true);
        setEquipoLoading(true);
        setEquiposList([]);

        const { data, error } = await supabase.from('equipos').select('id, nombre, letra').order('created_at', { ascending: false });
        setEquipoLoading(false);
        if (data && !error) {
            setEquiposList(data);
        }
    };

    const selectEquipo = async (equipo) => {
        const confirm = window.confirm(`Cargar "${equipo.nombre}" sobrescribirá el equipo actual. ¿Continuar?`);
        if (!confirm) return;

        setEquipoLoading(true);
        try {
            const { data: blueprint, error: bpError } = await supabase
                .from('equipo_integrantes')
                .select('perfil_id, rol_maestro')
                .eq('equipo_id', equipo.id);

            if (bpError) throw bpError;
            if (!blueprint || blueprint.length === 0) {
                alert('Este equipo está vacío.');
                setEquipoLoading(false);
                return;
            }

            await supabase.from('asignaciones').delete().eq('evento_id', evId);

            const bulkPayload = blueprint.map(item => ({
                evento_id: evId,
                perfil_id: item.perfil_id,
                rol_id: item.rol_maestro
            }));

            const { error: insError } = await supabase.from('asignaciones').insert(bulkPayload);
            if (insError) throw insError;

            setEquipoPickerOpen(false);
            await fetchCurrentRoster();
            alert('Equipo cargado correctamente.');
        } catch (err) {
            alert('Error aplicando equipo: ' + err.message);
        }
        setEquipoLoading(false);
    };

    const renderEmptySlot = (rolMap, { forceVisible = false, label = null, keySuffix = '' } = {}) => {
        const isDisabled = isStrictModerator && !forceVisible;
        if (isDisabled) return null;
        return (
            <button
                key={`empty-${rolMap.id}-${label || rolMap.nombre}-${keySuffix}`}
                type="button"
                onClick={() => {
                    if (isStrictModerator) return;
                    openPicker(
                        rolMap.id,
                        label || rolMap.nombre,
                        Number.isInteger(keySuffix) ? keySuffix : null
                    );
                }}
                className={`btn-roster-inline empty-slot inline-flex whitespace-nowrap px-4 h-9 items-center justify-center gap-1.5 rounded-full border border-dashed border-border text-[11px] font-bold leading-none text-content-muted uppercase tracking-widest transition-all ${isStrictModerator ? 'cursor-default opacity-55' : 'hover:border-brand/30 hover:text-brand hover:bg-brand/10'}`}
                disabled={isStrictModerator}
            >
                {(label || rolMap.nombre).split(' ')[0]} <span className="font-normal opacity-60 text-lg leading-none mt-[-2px]">+</span>
            </button>
        );
    };

    const renderAvatar = (asig, rolMatch) => {
        const p = asig.perfiles;
        if (!p) return null;

        const names = p.nombre.trim().split(' ');
        const displayName = `${names[0]}`.trim();
        const iniciales = names.length > 1 ? `${names[0].charAt(0)}${names[1].charAt(0)}` : names[0].charAt(0);

        const isN1 = ['lider_alabanza', 'talkback'].includes(rolMatch.codigo);
        const isN2 = ['encargado_letras'].includes(rolMatch.codigo);
        const isVoz = String(rolMatch.codigo || '').startsWith('voz_');
        const colorSeccion = isN1 ? 'bg-rol-dir' : (isN2 ? 'bg-rol-let' : (isVoz ? 'bg-rol-voc' : 'bg-rol-ban'));

        return (
            <div key={`${asig.rol_id}-${asig.perfil_id}`} className="flex flex-col items-center gap-1 group relative cursor-pointer hover:bg-neutral/20 rounded-xl p-2 -m-2 transition-colors" title={`${p.nombre} (${rolMatch.nombre})`} onClick={() => !isStrictModerator && openPicker(rolMatch.id, rolMatch.nombre)}>
                <div className="relative">
                    {p.avatar_url ? (
                        <img src={p.avatar_url} alt={p.nombre} loading="lazy" decoding="async" className="w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] shrink-0 rounded-full object-cover shadow-sm border border-border" />
                    ) : (
                        <div className={`w-[42px] h-[42px] sm:w-[46px] sm:h-[46px] shrink-0 rounded-full text-white flex items-center justify-center font-bold text-sm shadow-sm ${colorSeccion}`}>
                            {iniciales.toUpperCase()}
                        </div>
                    )}
                    {!isStrictModerator && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(asig.id, asig.rol_id); }} className="btn-remove-roster absolute -top-1.5 -left-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 shadow-md z-20 opacity-0 group-hover:opacity-100 transition-opacity" title="Remover">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </button>
                    )}
                </div>
                <span className="text-[11px] font-semibold text-content capitalize max-w-[60px] truncate text-center leading-none tracking-tight">{displayName}</span>
            </div>
        );
    };

    if (roles.length === 0) return <div className="p-4 text-center animate-pulse text-sm text-content-muted">Cargando Roster...</div>;

    const direccion = [];
    const letras = [];
    const banda = [];
    const MAX_VOZ_SLOTS = 4;
    const voiceRoles = effectiveRoles.filter(rol => String(rol.codigo || '').startsWith('voz_'));
    const voiceRoleIds = new Set(voiceRoles.map((rol) => rol.id));
    const voicePoolRole = { id: '_voz_pool', nombre: 'Voz' };
    const vocesAsignadas = asignaciones
        .filter((asig) => voiceRoleIds.has(asig.rol_id))
        .slice(0, MAX_VOZ_SLOTS)
        .map((asig) => {
            const rolMatch = effectiveRoles.find((rol) => rol.id === asig.rol_id) || voiceRoles[0];
            return rolMatch ? renderAvatar(asig, rolMatch) : null;
        })
        .filter(Boolean);

    effectiveRoles.forEach(rolMatch => {
        const isN1 = ['lider_alabanza', 'talkback'].includes(rolMatch.codigo);
        const isN2 = ['encargado_letras'].includes(rolMatch.codigo);
        const isVoz = String(rolMatch.codigo || '').startsWith('voz_');
        const isCajaRole = /(^|_)(caja|cajon)(_|\b)/.test(String(rolMatch.codigo || ''));

        const assigned = asignaciones.filter(a => a.rol_id === rolMatch.id);

        if (isCajaRole && !esAcustico && assigned.length === 0) {
            return;
        }

        if (isVoz) {
            return;
        }

        // Vocabulario especifico de vacios segun cÃ³digo
        if (assigned.length > 0) {
            assigned.forEach(a => {
                const node = renderAvatar(a, rolMatch);
                if (isN1) direccion.push(node);
                else if (isN2) letras.push(node);
                else banda.push(node);
            });
        } else {
            const emptyBtn = renderEmptySlot(rolMatch);
            if (emptyBtn) {
                if (isN1) direccion.push(emptyBtn);
                else if (isN2) letras.push(emptyBtn);
                else if (isVoz) return;
                else banda.push(emptyBtn);
            }
        }
    });

    const voces = Array.from({ length: MAX_VOZ_SLOTS }, (_, index) => {
        if (vocesAsignadas[index]) return vocesAsignadas[index];
        return renderEmptySlot(
            voicePoolRole,
            {
                forceVisible: true,
                label: 'Voz',
                keySuffix: index
            }
        );
    }).filter(Boolean);

    return (
        <div className="flex flex-col gap-4">
            <div id="modal-roster-container" className="bg-background rounded-2xl p-4 md:p-5 border border-border flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-2 w-full">
                    <span className="text-[10px] font-bold text-rol-dir uppercase tracking-widest leading-none mt-0.5">Dirección</span>
                            <div className="h-px flex-1 bg-rol-dir/10 ml-3"></div>
                        </div>
                        <div className="flex flex-wrap gap-2.5 items-start">{direccion.length > 0 ? direccion : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                    </div>
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-2 w-full">
                            <span className="text-[10px] font-bold text-rol-let uppercase tracking-widest leading-none mt-0.5">Letras</span>
                            <div className="h-px flex-1 bg-rol-let/10 ml-3"></div>
                        </div>
                        <div className="flex flex-wrap gap-2.5 items-start">{letras.length > 0 ? letras : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                    </div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2 w-full">
                        <span className="text-[10px] font-bold text-rol-ban uppercase tracking-widest leading-none mt-0.5">Banda</span>
                        <div className="h-px flex-1 bg-rol-ban/10 ml-3"></div>
                    </div>
                    <div className="flex flex-wrap gap-2.5 items-start">{banda.length > 0 ? banda : <span className="text-xs text-content-muted font-medium">Vacío</span>}</div>
                </div>

                <div>
                    <div className="flex items-center justify-between mb-2 w-full">
                        <span className="text-[10px] font-bold text-rol-voc uppercase tracking-widest leading-none mt-0.5">Voces</span>
                        <div className="h-px flex-1 bg-rol-voc/10 ml-3"></div>
                    </div>
                    <div className="flex flex-wrap gap-2.5 items-start">{voces}</div>
                </div>
            </div>

            {!isStrictModerator && (
                <button type="button" onClick={openEquipoPicker} className="w-full py-3.5 bg-info/10 text-info border border-info/30 border-dashed rounded-xl text-sm font-bold hover:bg-info/20 hover:text-info transition-colors flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m19 11-4-4v8" /><path d="m11 15 4 4" /></svg> Autocompletar Equipo Base
                </button>
            )}

            {pickerOpen && (
                <div className="fixed inset-0 z-[100] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col max-h-[70vh]">
                        <div className="p-4 border-b border-border flex justify-between items-center bg-background">
                            <h3 className="font-bold text-content">{pickerRolName}</h3>
                            <button type="button" onClick={() => setPickerOpen(false)} className="text-content-muted hover:text-content bg-background hover:bg-border rounded-full p-2 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1">
                            {pickerLoading ? (
                                <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-info/30 border-t-info rounded-full animate-spin"></div></div>
                            ) : pickerList.length === 0 ? (
                                <div className="text-center text-sm text-content-muted py-6">Nadie capacitado en este rol.</div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {pickerList.map(p => (
                                        <button
                                            type="button"
                                            key={`${p.id}-${p.realRolId || pickerRolId}`}
                                            onClick={() => !p.ausente && selectUserForRole(p.id, p.realRolId || pickerRolId)}
                                            className={`flex items-center justify-between gap-3 p-3 rounded-xl border border-border text-left transition-colors relative ${p.ausente ? 'opacity-50 cursor-not-allowed bg-background/50 grayscale-[20%]' : 'hover:border-brand/30 hover:bg-background'}`}
                                        >
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="relative shrink-0">
                                                    {p.ausente ? (
                                                        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-500 border border-red-200">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                                        </div>
                                                    ) : p.avatar_url ? (
                                                        <img src={p.avatar_url} loading="lazy" decoding="async" className="w-10 h-10 rounded-full object-cover shadow-sm border border-border" alt={p.nombre} />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-full bg-neutral/20 text-content-muted flex items-center justify-center font-bold text-xs shadow-sm border border-border">{p.nombre.substring(0, 2).toUpperCase()}</div>
                                                    )}
                                                </div>
                                                <div className="flex-1 overflow-hidden min-w-0">
                                                    <p className={`font-bold text-sm truncate ${p.ausente ? 'text-content-muted line-through' : 'text-content'}`}>{p.nombre}</p>
                                                    <p className="text-xs text-content-muted truncate">
                                                        {pickerRolId === '_voz_pool' ? (p.realRolNombre || p.email) : p.email}
                                                    </p>
                                                </div>
                                            </div>

                                            {p.ausente && (
                                                <span className="shrink-0 max-w-[40%] text-right inline-flex flex-col items-end">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase tracking-widest border border-red-200">
                                                        Ausente
                                                    </span>
                                                    {p.ausenteMotivo && <span className="text-[10px] text-red-500 truncate mt-0.5 max-w-full leading-tight" title={p.ausenteMotivo}>{p.ausenteMotivo}</span>}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {equipoPickerOpen && (
                <div className="fixed inset-0 z-[100] bg-overlay/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                        <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-3xl">
                            <div>
                                <h3 className="font-bold text-xl text-content">Cargar Equipo Base</h3>
                                <p className="text-xs text-content-muted mt-1">Sobrescribirá las asignaciones actuales de este evento.</p>
                            </div>
                            <button type="button" onClick={() => setEquipoPickerOpen(false)} className="text-content-muted hover:text-content bg-background hover:bg-border p-2 rounded-full border border-border shadow-sm transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto flex-1">
                            {equipoLoading ? (
                                <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-brand/30 border-t-brand rounded-full animate-spin"></div></div>
                            ) : equiposList.length === 0 ? (
                                <div className="text-center text-sm text-content-muted py-6">No hay equipos creados. Usa el Constructor en Equipo.</div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {equiposList.map((eq, i) => {
                                        const colors = ['bg-danger/10 text-danger', 'bg-info/10 text-info', 'bg-success/10 text-success', 'bg-accent/10 text-accent'];
                                        const c = colors[i % colors.length];
                                        return (
                                            <button type="button" key={eq.id} onClick={() => selectEquipo(eq)} className="flex items-center justify-between p-4 rounded-2xl border border-border hover:border-brand/30 group bg-background text-left transition-colors">
                                                <div>
                                                    <span className="text-[10px] font-bold text-content-muted uppercase tracking-widest">Plantilla</span>
                                                    <p className="font-bold text-base text-content group-hover:text-brand">{eq.nombre}</p>
                                                </div>
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black ${c}`}>
                                                    {eq.letra || 'A'}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}









