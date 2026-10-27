-- Alabanza: asistente local de marcadores. REAPER 7; sin extensiones.
-- Cargar una vez: Actions > Show action list > New action > Load ReaScript.
local project = reaper.EnumProjects(-1)
local notes = reaper.GetSetProjectNotes(project, false, '')
if not notes:find('ALABANZA_MAPA_V1:', 1, true) then
  reaper.ShowMessageBox('Este asistente trabaja sobre el RPP que descargas en Alabanza (Administración → REAPER → Descargar proyecto + stems). Ábrelo en REAPER y vuelve a ejecutar la acción.', 'Alabanza', 0)
  return
end
-- The only network step: opening the beta's REAPER page in the browser after saving.
local ALABANZA_URL = 'https://light2-edison-beta--alabanzaredilestadio.netlify.app'
local song_id = (notes:match('ALABANZA_MAPA_V1:([^\n]+)') or ''):match('^%s*(.-)%s*$')
local selected_id, selected_cue, status = nil, nil, ''
local draft = '[BORRADOR] '
local green = reaper.ColorToNative(50, 190, 130) | 0x1000000
local violet = reaper.ColorToNative(150, 120, 240) | 0x1000000
-- BEGIN ALABANZA_SECCIONES: generado desde public/audio/guide-es/manifest.json con
-- `npm run reaper:sections`. No editar a mano; test:reaper-sections detecta desajustes.
local SECTION_TYPES = {
  {label='Intro', cue='intro', numbered=false},
  {label='Verso', cue='verso', numbered=true},
  {label='Pre-coro', cue='pre-coro', numbered=true},
  {label='Coro', cue='coro', numbered=true},
  {label='Post-coro', cue='post-coro', numbered=false},
  {label='Puente', cue='puente', numbered=true},
  {label='Interludio', cue='interludio', numbered=false},
  {label='Instrumental', cue='instrumental', numbered=false},
  {label='Solo', cue='solo', numbered=false},
  {label='Rap', cue='rap', numbered=false},
  {label='Vamp', cue='vamp', numbered=false},
  {label='Baja intensidad', cue='baja-intensidad', numbered=false},
  {label='Estribillo', cue='refrain', numbered=false},
  {label='Exhortación', cue='exhortation', numbered=false},
  {label='Repetir', cue='repetir', numbered=false},
  {label='Outro', cue='outro', numbered=false},
  {label='Final', cue='ending', numbered=false},
}
local INSTRUCTION_TYPES = {
  {label='Sube intensidad', cue='build', numbered=false},
  {label='Pausa', cue='break', numbered=false},
  {label='Hits', cue='hits', numbered=false},
  {label='Entra batería', cue='drums-in', numbered=false},
  {label='Toda la banda', cue='all-in', numbered=false},
  {label='Sube tono', cue='key-change-up', numbered=false},
  {label='Baja tono', cue='key-change-down', numbered=false},
  {label='Suave', cue='softly', numbered=false},
  {label='A capella', cue='a-capella', numbered=false},
  {label='Swell', cue='swell', numbered=false},
  {label='Final grande', cue='big-ending', numbered=false},
  {label='Sostener', cue='hold', numbered=false},
  {label='Última vez', cue='last-time', numbered=false},
  {label='Teclado', cue='keys', numbered=false},
  {label='Bajo', cue='bass', numbered=false},
  {label='Batería', cue='drums', numbered=false},
  {label='Guitarra', cue='guitar', numbered=false},
}
local INSTRUCTION_PREFIX = '[INSTRUCCIÓN] '
-- END ALABANZA_SECCIONES
local CUSTOM = 'Otro nombre…'
-- No section type is preset: the helper suggests one from the song itself or waits for a choice.
local chosen, chosen_cue, custom_name, saved_path = nil, 1, nil, nil
local function plain(name) return (name:gsub('^%[BORRADOR%]%s*', '')) end
local display -- normalized name for the screen; defined with the section helpers below
-- Instruction markers carry a prefix; older RPPs have none, so every marker there is a section.
-- Same rule as the app's parser: any case, with or without the accent.
local function cue_name(name)
  local head, rest = name:match('^(%[[^%]]*%])%s*(.*)$')
  if head and head:lower():gsub('ó', 'o'):gsub('Ó', 'o') == '[instruccion]' then return rest end
end
local function notify(text) status = text; reaper.ShowMessageBox(text, 'Alabanza', 0) end
local function clock(seconds)
  local minutes = math.floor(seconds / 60)
  return string.format('%d:%06.3f', minutes, seconds - minutes * 60)
end
local function active()
  if reaper.EnumProjects(-1) ~= project then notify('Vuelve a la pestaña del proyecto con el que abriste el asistente.'); return false end
  return true
end
local function current()
  if not active() then return false end
  if reaper.GetPlayStateEx(project) ~= 0 then notify('Detén la reproducción y coloca el cursor de edición en la posición exacta.'); return false end
  return true
end
local function all_markers()
  local rows, i = {}, 0
  while true do
    local ok, region, pos, ending, name, id = reaper.EnumProjectMarkers3(project, i)
    if ok == 0 then break end
    if not region then rows[#rows+1] = {id=id, pos=pos, name=name} end
    i = i + 1
  end
  return rows
end
local function sections()
  local rows = {}
  for _, row in ipairs(all_markers()) do
    local name = plain(row.name)
    if name ~= 'UNO' and name ~= 'FIN AUDIO' and not cue_name(row.name) then rows[#rows+1] = row end
  end
  return rows
end
local function instructions()
  local rows = {}
  for _, row in ipairs(all_markers()) do
    local name = cue_name(row.name)
    if name then rows[#rows+1] = {id=row.id, pos=row.pos, name=name} end
  end
  return rows
end
-- Confirmed anchors only: a '[BORRADOR] FIN AUDIO' still has to be placed.
local function anchor(name)
  for _, row in ipairs(all_markers()) do if row.name == name then return row end end
end
local function locate(rows)
  for i,row in ipairs(rows) do if row.id == selected_id then return i end end
  return 1
end
local function select_index(index)
  if not current() then return end
  local rows = sections()
  if #rows == 0 then notify('No hay secciones. Añade la primera en el paso 2.'); return end
  local row = rows[math.max(1, math.min(#rows, index))]
  selected_id, selected_cue = row.id, nil
  reaper.SetEditCurPos2(project, row.pos, true, false)
  status = 'Coloca el cursor en el primer tiempo de '..display(plain(row.name))..' y pulsa Enter.'
end
local function go(delta)
  if not current() then return end
  select_index(locate(sections()) + delta)
end
local function select_cue(id)
  if not current() then return end
  for _, row in ipairs(instructions()) do
    if row.id == id then
      selected_cue = id
      reaper.SetEditCurPos2(project, row.pos, true, false)
      status = 'Instrucción '..row.name..' en '..clock(row.pos)..'. Puedes quitarla o seguir con las secciones.'
    end
  end
end
local function edit(label, fn)
  if not current() then return end
  reaper.Undo_BeginBlock2(project)
  local ok, err = pcall(fn)
  reaper.UpdateArrange()
  reaper.Undo_EndBlock2(project, label, -1)
  if not ok then notify('No se completó la acción: '..tostring(err)..'. Puedes usar Deshacer.'); return false end
  return true
end
local function set_special(name, pos)
  for _, row in ipairs(all_markers()) do
    if plain(row.name) == name then return reaper.SetProjectMarker3(project,row.id,false,pos,0,name,green) end
  end
  return reaper.AddProjectMarker2(project,false,pos,0,name,-1,green) >= 0
end
local function confirm()
  local rows = sections()
  local index = locate(rows)
  local row = rows[index]
  if not row then notify('Añade una sección primero.'); return end
  if edit('Alabanza: confirmar entrada', function()
    assert(reaper.SetProjectMarker3(project,row.id,false,reaper.GetCursorPositionEx(project),0,plain(row.name),green))
  end) then
    -- Select the next entry without moving the cursor: play from here, stop on its first beat, Enter.
    local following = rows[index + 1]
    selected_id, selected_cue = following and following.id or row.id, nil
    status = display(plain(row.name))..' confirmada.'..(following and ' Ahora: '..display(plain(following.name))..'.' or ' Era la última entrada.')
  end
end
-- 'Coro' counts as appearance 1 and 'Coro 3' as 3; any other name is not this type.
local function occurrence(name, label)
  name, label = name:lower(), label:lower()
  if name == label then return 1 end
  if name:sub(1, #label + 1) == label..' ' then return tonumber(name:sub(#label + 2):match('^(%d+)$')) end
end
local function next_name(kind, except_id)
  local highest = 0
  for _, row in ipairs(sections()) do
    if row.id ~= except_id then highest = math.max(highest, occurrence(plain(row.name), kind.label) or 0) end
  end
  -- Types with numbered voices (Coro 1…4) always carry a number; Intro or Final only from the second one.
  if kind.numbered or highest > 0 then return kind.label..' '..(highest + 1) end
  return kind.label
end
local function known(name)
  for _, kind in ipairs(SECTION_TYPES) do if occurrence(name, kind.label) then return true end end
  return false
end
local function type_of(name)
  for i, kind in ipairs(SECTION_TYPES) do if occurrence(name, kind.label) then return i end end
end
-- Shown name only: a legacy 'final' reads as 'Final'; the RPP keeps its text until renamed.
function display(name)
  local i = type_of(name)
  if not i then return name end
  return SECTION_TYPES[i].label..(name:match('%s(%d+)$') and ' '..occurrence(name, SECTION_TYPES[i].label) or '')
end
-- Most likely type at the cursor, learned from the song: what followed the previous section the last
-- time it appeared (Verso → Pre-coro → Coro repeats). Never a second Intro, Final… on its own.
local function suggestion()
  local rows, pos = sections(), reaper.GetCursorPositionEx(project)
  table.sort(rows, function(a, b) return a.pos < b.pos end)
  local fresh = function(t) return t and (SECTION_TYPES[t].numbered or next_name(SECTION_TYPES[t]) == SECTION_TYPES[t].label) and t or nil end
  local before
  for i, row in ipairs(rows) do if row.pos <= pos + 0.000001 then before = i end end
  if not before then
    for i, kind in ipairs(SECTION_TYPES) do if kind.cue == 'intro' then return fresh(i) end end
    return nil
  end
  local here = type_of(plain(rows[before].name))
  if not here then return nil end
  for j = before - 1, 1, -1 do
    if type_of(plain(rows[j].name)) == here then return fresh(type_of(plain(rows[j + 1].name))) end
  end
end
local function section_type() return chosen or suggestion() end
local function known_cue(name)
  for _, kind in ipairs(INSTRUCTION_TYPES) do if kind.label:lower() == name:lower() then return true end end
  return false
end
local function preview()
  local t = section_type()
  return custom_name or (t and next_name(SECTION_TYPES[t])) or nil
end
local function type_menu(except_id, mark)
  local names, items = {}, {}
  for i, kind in ipairs(SECTION_TYPES) do
    names[i] = next_name(kind, except_id)
    items[i] = (mark == i and '!' or '')..names[i]
  end
  -- No separators or submenus: they would shift the index gfx.showmenu returns.
  local choice = gfx.showmenu(table.concat(items, '|')..'|'..CUSTOM)
  if names[choice] then return names[choice], choice end
  if choice ~= #names + 1 then return end
  local ok, typed = reaper.GetUserInputs('Nombre de sección',1,'Nombre (ej. Coro 2):','')
  typed = (typed or ''):match('^%s*(.-)%s*$')
  if ok and typed ~= '' then return typed end
end
-- The visible dropdowns only choose the type; "Añadir" places it, so the preview never lies.
local function choose_type()
  local name, index = type_menu(nil, not custom_name and section_type() or nil)
  if not name then return end
  if index then chosen, custom_name = index, nil else custom_name = name end
  status = 'Sección elegida: se añadirá '..preview()..' en el cursor.'
end
local function choose_cue()
  local items = {}
  for i, kind in ipairs(INSTRUCTION_TYPES) do items[i] = (i == chosen_cue and '!' or '')..kind.label end
  local choice = gfx.showmenu(table.concat(items, '|'))
  if not INSTRUCTION_TYPES[choice] then return end
  chosen_cue = choice
  status = 'Instrucción elegida: '..INSTRUCTION_TYPES[choice].label..'. Se dirá antes del punto que marques.'
end
local function rejected(name, except_id)
  if name == 'UNO' or name == 'FIN AUDIO' then return 'Usa el botón específico para UNO o FIN AUDIO.' end
  if cue_name(name) then return 'Para una instrucción usa el grupo Instrucción.' end
  for _, row in ipairs(sections()) do
    if row.id ~= except_id and plain(row.name):lower() == name:lower() then return 'Ese nombre ya existe. Usa otro número para esta aparición.' end
  end
end
local function unlisted(name)
  return known(name) and '' or ' Ese nombre no está en la lista: puede quedar sin voz guía.'
end
local function add_section()
  if not current() then return end
  -- Nothing chosen and nothing to suggest: the dropdown opens and the choice is added right away.
  if not preview() then choose_type() end
  local name = preview()
  if not name then return end
  local problem = rejected(name)
  if problem then notify(problem); return end
  if edit('Alabanza: añadir sección',function()
    selected_id = reaper.AddProjectMarker2(project,false,reaper.GetCursorPositionEx(project),0,name,-1,green)
    assert(selected_id >= 0)
  end) then selected_cue, custom_name, chosen = nil, nil, nil; status = name..' añadida en '..clock(reaper.GetCursorPositionEx(project))..'.'..unlisted(name) end
end
-- Instructions may repeat (Hits, Hits…), but never twice at the same instant.
local function add_cue()
  if not current() then return end
  local kind, pos = INSTRUCTION_TYPES[chosen_cue], reaper.GetCursorPositionEx(project)
  for _, row in ipairs(instructions()) do
    if row.name == kind.label and math.abs(row.pos - pos) < 0.000001 then notify('Esa instrucción ya está en este punto.'); return end
  end
  local id
  if edit('Alabanza: añadir instrucción',function()
    id = reaper.AddProjectMarker2(project,false,pos,0,INSTRUCTION_PREFIX..kind.label,-1,violet)
    assert(id >= 0)
  end) then selected_cue = id; status = 'Instrucción '..kind.label..' en '..clock(pos)..'. No crea sección.' end
end
local function remove_cue()
  if not current() then return end
  for _, row in ipairs(instructions()) do
    if row.id == selected_cue then
      if edit('Alabanza: quitar instrucción',function() assert(reaper.DeleteProjectMarker(project,row.id,false)) end) then
        selected_cue = nil; status = 'Instrucción '..row.name..' quitada.'
      end
      return
    end
  end
  notify('Elige en la lista la instrucción que quieres quitar.')
end
local function rename()
  if not current() then return end
  local rows = sections()
  local row = rows[locate(rows)]
  if not row then notify('Añade una sección primero.'); return end
  local name = type_menu(row.id)
  if not name then return end
  local problem = rejected(name, row.id)
  if problem then notify(problem); return end
  -- Renaming keeps the position; a draft stays a draft until its entry is confirmed.
  local pending = plain(row.name) ~= row.name
  if edit('Alabanza: cambiar nombre de sección',function()
    assert(reaper.SetProjectMarker3(project,row.id,false,row.pos,0,(pending and draft or '')..name,pending and 0 or green))
  end) then selected_id = row.id; status = plain(row.name)..' ahora es '..name..'.'..unlisted(name) end
end
local function calibrate()
  if not current() then return end
  local start, ending = reaper.GetSet_LoopTimeRange2(project,false,false,0,0,false)
  if ending <= start then notify('Selecciona desde un primer tiempo hasta otro primer tiempo, contando compases completos entre ambos.'); return end
  local ok, answer = reaper.GetUserInputs('Medir tempo con compases completos',3,'Compases contados,Numerador,Denominador','8,4,4')
  if not ok then return end
  local bars,num,den = answer:match('^%s*(%d+)%s*,%s*(%d+)%s*,%s*(%d+)%s*$')
  bars,num,den = tonumber(bars),tonumber(num),tonumber(den)
  if not bars or bars < 1 or bars > 256 or num < 1 or num > 32 or not ({[1]=true,[2]=true,[4]=true,[8]=true,[16]=true,[32]=true})[den] then notify('Introduce compases completos y un compás válido, por ejemplo 8,4,4.'); return end
  local bpm = 60 * bars * num * 4 / den / (ending - start)
  if bpm < 20 or bpm > 400 then notify('El resultado está fuera de 20–400 BPM. Revisa la selección y los compases contados.'); return end
  -- Do not overwrite a variable tempo map. Equal points at the anchor may be updated.
  local target, initial_bpm, initial_meter = -1, nil, nil
  for i=0,reaper.CountTempoTimeSigMarkers(project)-1 do
    local retval,time,measure,beat,old_bpm,old_num,old_den,linear = reaper.GetTempoTimeSigMarker(project,i)
    if retval then
      local sig = old_num..'/'..old_den
      if initial_bpm and (math.abs(old_bpm-initial_bpm)>0.000001 or (old_num>0 and initial_meter~=sig) or linear) then notify('Hay un mapa variable de tempo/compás. Revísalo con las herramientas nativas de REAPER; el asistente no lo reemplazará.'); return end
      initial_bpm,initial_meter = initial_bpm or old_bpm, initial_meter or sig
      if math.abs(time-start)<0.000001 then target=i
      elseif time>0.000001 then notify('Ya hay un anclaje de tempo en otra posición. Para recalibrar, usa la misma selección inicial o edítalo en REAPER.'); return end
    end
  end
  if reaper.ShowMessageBox(string.format('Tempo medido: %.6f BPM\nCompás: %d/%d\n\nSe creará el anclaje en el inicio de la selección, sin mover el audio.\nConfirma que seleccionaste %d compases completos.',bpm,num,den,bars),'Aplicar tempo medido',1) ~= 1 then return end
  if edit('Alabanza: calibrar tempo sin estirar audio',function()
    for i=0,reaper.CountMediaItems(project)-1 do
      local item=reaper.GetMediaItem(project,i)
      reaper.SetMediaItemInfo_Value(item,'C_BEATATTACHMODE',0)
      reaper.SetMediaItemInfo_Value(item,'C_AUTOSTRETCH',0)
    end
    -- Set the same base tempo at zero, then anchor a new measure at the chosen UNO.
    -- This prevents a fictitious tempo change during the initial count-in.
    local base_index = -1
    for i=0,reaper.CountTempoTimeSigMarkers(project)-1 do
      local ok,time = reaper.GetTempoTimeSigMarker(project,i)
      if ok and math.abs(time)<0.000001 then base_index=i end
    end
    assert(reaper.SetTempoTimeSigMarker(project,base_index,0,-1,-1,bpm,num,den,false))
    if start>0.000001 then
      target=-1
      for i=0,reaper.CountTempoTimeSigMarkers(project)-1 do
        local ok,time = reaper.GetTempoTimeSigMarker(project,i)
        if ok and math.abs(time-start)<0.000001 then target=i end
      end
      assert(reaper.SetTempoTimeSigMarker(project,target,start,-1,-1,bpm,num,den,false))
    end
  end) then status = string.format('Anclaje %.6f BPM. Verifica el click al principio, mitad y final.',bpm) end
end
local function special(name)
  if edit('Alabanza: marcar '..name,function()
    assert(set_special(name,reaper.GetCursorPositionEx(project)))
  end) then status = name..' marcado en '..clock(reaper.GetCursorPositionEx(project))..'.' end
end
local function audio_end()
  local last = 0
  for i=0,reaper.CountMediaItems(project)-1 do
    local item = reaper.GetMediaItem(project,i)
    last = math.max(last, reaper.GetMediaItemInfo_Value(item,'D_POSITION') + reaper.GetMediaItemInfo_Value(item,'D_LENGTH'))
  end
  return last
end
local function go_audio_end()
  if not current() then return end
  reaper.SetEditCurPos2(project, audio_end(), true, false)
  status = 'Cursor al final del audio. Escucha la cola y marca FIN AUDIO.'
end
local function bpm_text(bpm) return (string.format('%.3f', bpm):gsub('%.?0+$', '')) end
-- What the upload review in Alabanza will ask for, checked before leaving REAPER.
local function summary()
  local rows, cues, issues = sections(), instructions(), {}
  local uno, fin = anchor('UNO'), anchor('FIN AUDIO')
  local num, den, bpm = reaper.TimeMap_GetTimeSigAtTime(project, uno and uno.pos or 0)
  local info = {sections=#rows, instructions=#cues, drafts=0, uno=uno and uno.pos, fin=fin and fin.pos, bpm=bpm, num=num, den=den,
    measured=reaper.CountTempoTimeSigMarkers(project) > 0, issues=issues, blocking=0}
  local function issue(blocks, text)
    issues[#issues+1] = {blocks=blocks, text=text}
    if blocks then info.blocking = info.blocking + 1 end
  end
  local starts = {}
  for _, row in ipairs(rows) do
    local name = plain(row.name)
    if name ~= row.name then info.drafts = info.drafts + 1 end
    if fin and row.pos >= fin.pos then issue(true, display(name)..' empieza después de FIN AUDIO.') end
    local at = string.format('%.6f', row.pos)
    if starts[at] then issue(true, 'Dos secciones empiezan en '..clock(row.pos)..'.') end
    starts[at] = true
  end
  if #rows == 0 then issue(true, 'Añade al menos una sección.') end
  if info.drafts > 0 then issue(true, info.drafts == 1 and 'Falta confirmar 1 entrada.' or 'Faltan '..info.drafts..' entradas por confirmar.') end
  if not uno then issue(true, 'Falta marcar UNO.') end
  if not fin then issue(true, 'Falta marcar FIN AUDIO.') end
  if uno and fin and uno.pos >= fin.pos then issue(true, 'UNO debe ir antes de FIN AUDIO.') end
  for _, row in ipairs(rows) do
    if not known(plain(row.name)) then issue(false, plain(row.name)..' no tiene voz guía en la lista.') end
  end
  for _, row in ipairs(cues) do
    if not known_cue(row.name) then issue(false, 'La instrucción '..row.name..' no tiene voz guía.') end
    if (uno and row.pos < uno.pos) or (fin and row.pos >= fin.pos) then issue(false, 'La instrucción '..row.name..' está fuera de UNO–FIN AUDIO; no se dirá.') end
  end
  if not info.measured then issue(false, 'Tempo sin medir: se usará '..bpm_text(bpm)..' BPM.') end
  return info
end
-- Step 1 needs UNO (tempo is advisory), 2 every entry confirmed, 3 FIN AUDIO, 4 a clean saved RPP.
local function progress(info)
  info = info or summary()
  local done = {info.uno ~= nil, info.sections > 0 and info.drafts == 0, info.fin ~= nil}
  done[4] = done[1] and done[2] and done[3] and info.blocking == 0 and reaper.IsProjectDirty(project) == 0
  for i = 1, 4 do if not done[i] then return done, i end end
  return done, 4
end
local function alabanza_url()
  local id = song_id:gsub('[^%w%-_%.~]', function(c) return string.format('%%%02X', c:byte()) end)
  return ALABANZA_URL..'/admin?area=reaper&paso=subir&song='..id
end
local function open_url(url)
  if reaper.CF_ShellExecute then reaper.CF_ShellExecute(url); return true end
  local system = reaper.GetOS()
  -- The URL only contains percent-encoded characters, so quoting it is enough.
  if system:find('Win') then return reaper.ExecProcess('cmd.exe /C start "" "'..url..'"', -2) ~= nil end
  if system:find('OSX') or system:find('macOS') then return reaper.ExecProcess('/usr/bin/open "'..url..'"', -2) ~= nil end
  return reaper.ExecProcess('xdg-open "'..url..'"', -2) ~= nil
end
local function save(open)
  if not current() then return end
  reaper.Main_SaveProject(project, false)
  local _, path = reaper.EnumProjects(-1)
  saved_path = path ~= '' and path or nil
  local info = summary()
  local where = saved_path and ' en '..saved_path or ''
  local pending = info.blocking > 0 and ' Antes de aplicar en Alabanza: '..info.issues[1].text or ''
  if not open then status = 'RPP guardado'..where..'.'..pending; return end
  local url = alabanza_url()
  if open_url(url) then status = 'RPP guardado'..where..'. En Alabanza, elige ese archivo en Subir y aplicar.'..pending
  else status = 'RPP guardado'..where..'. Abre '..url..' y súbelo allí.'..pending end
end
local function transport()
  if not active() then return end
  if reaper.GetPlayStateEx(project) & 1 == 1 then
    -- Stop where the music is, so Enter confirms the entry the user just heard.
    local pos = reaper.GetPlayPositionEx(project)
    reaper.OnStopButtonEx(project)
    reaper.SetEditCurPos2(project, pos, true, false)
    status = 'Detenido en '..clock(pos)..'. Ajusta el cursor si hace falta y pulsa Enter.'
  else reaper.OnPlayButtonEx(project) end
end
local view = select(2, progress())
-- Open on the first entry that still needs its beat confirmed.
for _, row in ipairs(sections()) do if plain(row.name) ~= row.name then selected_id = row.id; break end end
local function primary_action(info, row)
  if view == 1 then
    if info.uno then return 'Continuar a Secciones', function() view = 2 end end
    return 'Marcar UNO aquí', function() special('UNO') end
  elseif view == 2 then
    if row and plain(row.name) ~= row.name then return 'Confirmar '..display(plain(row.name))..' aquí', confirm end
    -- A confirmed entry is selected: lead to the next pending one, or out of the step when none is left.
    for i, other in ipairs(sections()) do
      if plain(other.name) ~= other.name then return 'Ir a '..display(plain(other.name))..' (pendiente)', function() select_index(i) end end
    end
    if info.sections > 0 then return 'Secciones listas · seguir a FIN AUDIO →', function() view = 3 end end
    return preview() and 'Añadir '..preview()..' aquí' or 'Elegir la primera sección…', add_section
  elseif view == 3 then
    if info.fin then return 'Continuar a Guardar', function() view = 4 end end
    return 'Marcar FIN AUDIO aquí', function() special('FIN AUDIO') end
  end
  return 'Guardar RPP y abrir Alabanza', function() save(true) end
end

-- Tests may load the real script against a stub REAPER API without starting gfx.
if ALABANZA_TEST then
  return {sections=sections,instructions=instructions,go=go,select=select_index,select_cue=select_cue,confirm=confirm,
    add=add_section,choose=choose_type,preview=preview,add_cue=add_cue,choose_cue=choose_cue,remove_cue=remove_cue,
    rename=rename,calibrate=calibrate,special=special,summary=summary,progress=progress,save=save,url=alabanza_url,
    transport=transport,audio_end=go_audio_end,types=SECTION_TYPES,cues=INSTRUCTION_TYPES,status=function() return status end,
    step=function(n) if n then view = n end; return view end,
    primary=function() local rows = sections(); return primary_action(summary(), rows[locate(rows)]) end}
end

-- Interface ---------------------------------------------------------------
local title = (notes:match('Canción: ([^\n]+)') or 'Mapa multitrack')
gfx.init('Alabanza · Asistente de secciones', 840, 740)
local C = {
  bg={0.07,0.086,0.106}, surface={0.106,0.13,0.157}, raised={0.145,0.176,0.212}, hover={0.19,0.23,0.27}, line={0.22,0.27,0.32},
  text={0.94,0.95,0.96}, muted={0.62,0.67,0.72}, accent={0.09,0.5,0.41}, accent_hi={0.11,0.58,0.47}, white={1,1,1},
  ok={0.42,0.85,0.6}, warn={0.98,0.76,0.38}, bad={1,0.56,0.53}, cue={0.72,0.64,1}, cue_bg={0.2,0.17,0.32},
  cue_card={0.125,0.118,0.176}, done_ink={0.55,0.78,0.66},
}
local BODY, BOLD, TITLE, SMALL, HEAD, LABEL = 1, 2, 3, 4, 5, 6
gfx.setfont(BODY,'Arial',15); gfx.setfont(BOLD,'Arial',15,string.byte('b')); gfx.setfont(TITLE,'Arial',22,string.byte('b'))
gfx.setfont(SMALL,'Arial',13); gfx.setfont(HEAD,'Arial',18,string.byte('b')); gfx.setfont(LABEL,'Arial',12,string.byte('b'))
local STEPS = {'Tempo y UNO', 'Secciones', 'FIN AUDIO', 'Guardar'}
local mouse, list_offset, followed = {x=0, y=0, click=false}, 0, nil
local function color(c, alpha) gfx.set(c[1], c[2], c[3], alpha or 1) end
local function text(x, y, value, font, c) gfx.setfont(font or BODY); color(c or C.text); gfx.x = x; gfx.y = y; gfx.drawstr(value) end
local function width(value, font) gfx.setfont(font or BODY); return gfx.measurestr(value) end
local function fit(value, w, font)
  if width(value, font) <= w then return value end
  while #value > 0 and width(value..'…', font) > w do value = value:sub(1, (utf8.offset(value, -1) or 1) - 1) end
  return value..'…'
end
local function wrap(value, w, font)
  local lines, line = {}, ''
  for word in value:gmatch('%S+') do
    local candidate = line == '' and word or line..' '..word
    if line ~= '' and width(candidate, font) > w then lines[#lines+1] = line; line = word else line = candidate end
  end
  if line ~= '' then lines[#lines+1] = line end
  return lines
end
local function paragraph(x, y, w, value, font, c, max)
  local lines = wrap(value, w, font)
  for i = 1, math.min(#lines, max or #lines) do text(x, y + (i - 1) * 19, lines[i], font, c) end
  return y + math.min(#lines, max or #lines) * 19
end
local function over(x, y, w, h) return mouse.x >= x and mouse.x < x + w and mouse.y >= y and mouse.y < y + h end
local function clicked(x, y, w, h)
  if mouse.click and over(x, y, w, h) then mouse.click = false; return true end
end
-- gfx has no filled rounded rectangle: two rects plus four corner discs.
local function box(x, y, w, h, c, alpha, r)
  r = math.min(r or 7, h / 2, w / 2)
  -- Blend against the background once: translucent pieces would overlap and show seams.
  alpha = alpha or 1
  gfx.set(c[1] * alpha + C.bg[1] * (1 - alpha), c[2] * alpha + C.bg[2] * (1 - alpha), c[3] * alpha + C.bg[3] * (1 - alpha), 1)
  gfx.rect(x + r, y, w - 2 * r, h, 1); gfx.rect(x, y + r, w, h - 2 * r, 1)
  for _, p in ipairs({{x + r, y + r}, {x + w - r - 1, y + r}, {x + r, y + h - r - 1}, {x + w - r - 1, y + h - r - 1}}) do gfx.circle(p[1], p[2], r, 1, 1) end
end
-- Drawn glyphs: Arial on Windows has no check mark or small triangle.
local function check(x, y, c)
  color(c); gfx.line(x, y + 5, x + 3, y + 8, 1); gfx.line(x + 3, y + 8, x + 10, y, 1)
  gfx.line(x, y + 6, x + 3, y + 9, 1); gfx.line(x + 3, y + 9, x + 10, y + 1, 1)
end
local function caret(x, y, c) color(c); gfx.triangle(x, y, x + 9, y, x + 4, y + 5) end
local function diamond(x, y, c) color(c); gfx.triangle(x, y - 5, x + 5, y, x, y + 5); gfx.triangle(x, y - 5, x - 5, y, x, y + 5) end
local function button(x, y, w, h, label, fn, style, enabled, key)
  enabled = enabled ~= false
  local hot = enabled and over(x, y, w, h)
  local fill = style == 'primary' and (hot and C.accent_hi or C.accent) or style == 'cue' and (hot and C.hover or C.cue_bg) or (hot and C.hover or C.raised)
  box(x, y, w, h, fill, enabled and 1 or 0.45)
  local font = style == 'primary' and BOLD or BODY
  local ink = not enabled and C.muted or style == 'primary' and C.white or style == 'cue' and C.cue or C.text
  local hint = key and width(key, SMALL) + 14 or 0
  if style == 'menu' then
    text(x + 12, y + (h - 17) / 2, fit(label, w - 44, font), font, ink)
    caret(x + w - 22, y + h / 2 - 2, ink)
  else
    local shown = fit(label, w - 24 - hint, font)
    text(x + (w - hint - width(shown, font)) / 2, y + (h - 17) / 2, shown, font, ink)
    if key then text(x + w - hint, y + (h - 15) / 2, key, SMALL, style == 'primary' and {0.75,0.92,0.86} or C.muted) end
  end
  -- Menus open right under the control that requested them.
  if enabled and clicked(x, y, w, h) then gfx.x = x; gfx.y = y + h; fn() end
end
-- Current step: filled accent tab. Completed: quiet tab with a green check. Pending: outline number.
local function stepper(y, done)
  local gap, h = 10, 50
  local w = (gfx.w - 32 - gap * 3) / 4
  for i, name in ipairs(STEPS) do
    local x = 16 + (i - 1) * (w + gap)
    local here = view == i
    if here then box(x, y, w, h, C.accent) elseif over(x, y, w, h) then box(x, y, w, h, C.surface) end
    if not here then color(C.line); gfx.line(x + 8, y + h - 1, x + w - 8, y + h - 1) end
    local cx, cy = x + 26, y + h / 2
    if here then
      color(C.white); gfx.circle(cx, cy, 11, 1, 1)
      if done[i] then check(cx - 5, cy - 5, C.accent) else text(cx - width(tostring(i), BOLD) / 2, cy - 9, tostring(i), BOLD, C.accent) end
    elseif done[i] then
      color(C.ok); gfx.circle(cx, cy, 11, 1, 1); check(cx - 5, cy - 5, C.bg)
    else
      color(C.line); gfx.circle(cx, cy, 11, 0, 1)
      text(cx - width(tostring(i), BOLD) / 2, cy - 9, tostring(i), BOLD, C.muted)
    end
    text(x + 46, y + 8, fit(name, w - 56, BOLD), BOLD, here and C.white or done[i] and C.text or C.muted)
    local state = here and (done[i] and 'Estás aquí · listo' or 'Estás aquí') or done[i] and 'Listo' or 'Pendiente'
    text(x + 46, y + 28, state, SMALL, here and {0.78,0.94,0.88} or done[i] and C.done_ink or C.muted)
    if clicked(x, y, w, h) then view = i end
  end
end
-- Sections and instructions in time order; only sections are navigated with the arrows.
local function entries(rows, cues)
  local list = {}
  for i, row in ipairs(rows) do list[#list+1] = {pos=row.pos, name=display(plain(row.name)), pending=plain(row.name) ~= row.name, index=i, id=row.id} end
  for _, row in ipairs(cues) do list[#list+1] = {pos=row.pos, name=row.name, cue=true, id=row.id} end
  table.sort(list, function(a, b) if a.pos == b.pos then return not a.cue and b.cue end return a.pos < b.pos end)
  return list
end
local function entry_list(x, y, w, h, rows, index, info)
  box(x, y, w, h, C.surface)
  text(x + 14, y + 14, 'Entradas', HEAD)
  local counter = (info.sections - info.drafts)..'/'..info.sections..' secciones'..(info.instructions > 0 and ' · '..info.instructions..' instr.' or '')
  text(x + w - 14 - width(counter, SMALL), y + 18, counter, SMALL, C.muted)
  local function anchor_line(ay, label, value)
    text(x + 14, ay, label, LABEL, C.muted)
    text(x + w - 14 - width(value or 'sin marcar', SMALL), ay - 1, value or 'sin marcar', SMALL, value and C.muted or C.warn)
  end
  anchor_line(y + 46, 'UNO', info.uno and clock(info.uno))
  color(C.line); gfx.line(x + 12, y + 66, x + w - 12, y + 66)
  local list = entries(rows, instructions())
  local top, row_h, bottom = y + 72, 30, y + h - 36
  local visible = math.max(1, math.floor((bottom - top) / row_h))
  -- Leave a line for the scroll hint only when the list does not fit.
  if #list > visible then visible = math.max(1, math.floor((bottom - 20 - top) / row_h)) end
  local focus = 1
  for i, item in ipairs(list) do if (item.cue and item.id == selected_cue) or (not selected_cue and not item.cue and item.index == index) then focus = i end end
  if over(x, y, w, h) and gfx.mouse_wheel ~= 0 then list_offset = list_offset + (gfx.mouse_wheel > 0 and -1 or 1) end
  -- Follow the selection only when it changes, so the wheel can still browse.
  if focus ~= followed then
    followed = focus
    if focus <= list_offset then list_offset = focus - 1 elseif focus > list_offset + visible then list_offset = focus - visible end
  end
  list_offset = math.max(0, math.min(list_offset, #list - visible))
  if #list == 0 then paragraph(x + 14, top + 6, w - 28, 'Aún no hay secciones. Añádelas en el paso 2.', SMALL, C.muted) end
  for i = list_offset + 1, math.min(#list, list_offset + visible) do
    local item, ry = list[i], top + (i - list_offset - 1) * row_h
    if i == focus and #rows > 0 then box(x + 6, ry, w - 12, row_h - 3, C.raised, 1, 5)
    elseif over(x + 6, ry, w - 12, row_h - 3) then box(x + 6, ry, w - 12, row_h - 3, C.bg, 0.6, 5) end
    if item.cue then diamond(x + 20, ry + 13, C.cue)
    elseif item.pending then color(C.warn); gfx.circle(x + 20, ry + 13, 4, 0, 1)
    else check(x + 15, ry + 8, C.ok) end
    local time = clock(item.pos)
    local tw = width(time, SMALL)
    local ink = item.cue and C.cue or (known(item.name) and C.text or C.warn)
    text(x + 36, ry + 6, fit(item.name, w - 60 - tw, item.cue and SMALL or BODY), item.cue and SMALL or BODY, ink)
    text(x + w - 16 - tw, ry + 8, time, SMALL, C.muted)
    if clicked(x + 6, ry, w - 12, row_h - 3) then if item.cue then select_cue(item.id) else select_index(item.index) end end
  end
  if #list > visible then
    local range = (list_offset + 1)..'–'..math.min(#list, list_offset + visible)..' de '..#list..' · rueda para ver más'
    text(x + 14, top + visible * row_h + 2, fit(range, w - 28, SMALL), SMALL, C.muted)
  end
  color(C.line); gfx.line(x + 12, y + h - 30, x + w - 12, y + h - 30)
  anchor_line(y + h - 22, 'FIN AUDIO', info.fin and clock(info.fin))
end
local function heading(x, y, w, value, help)
  text(x, y, value, HEAD)
  if help then return paragraph(x, y + 28, w, help, SMALL, C.muted, 2) + 12 end
  return y + 36
end
local function fact(x, y, w, label, value, c)
  text(x, y + 2, label, LABEL, C.muted)
  text(x + 120, y, fit(value, w - 120, BODY), BODY, c or C.text)
  return y + 26
end
-- One full-width card per kind, so a section and an instruction are never confused.
local function group(x, y, w, title, note, accent, card, choice, choose, actions, footer)
  box(x, y, w, 96, card)
  color(accent); gfx.rect(x, y + 12, 3, 72, 1)
  text(x + 16, y + 11, title, LABEL, accent)
  text(x + w - 14 - width(note, SMALL), y + 10, fit(note, w - 140, SMALL), SMALL, C.muted)
  local dw = math.floor((w - 40) * 0.46)
  button(x + 16, y + 32, dw, 36, choice, choose, 'menu')
  local ax, aw = x + 26 + dw, w - 42 - dw
  local each = (aw - 8 * (#actions - 1)) / #actions
  for i, act in ipairs(actions) do
    local bw = #actions == 2 and (i == 1 and aw * 0.6 - 4 or aw * 0.4 - 4) or each
    button(ax, y + 32, bw, 36, act[1], act[2], act[3], act[4], act[5])
    ax = ax + bw + 8
  end
  text(x + 16, y + 74, fit(footer, w - 32, SMALL), SMALL, C.muted)
end
local function panel(x, y, w, info, rows, row, done)
  local half, third = (w - 12) / 2, (w - 24) / 3
  local label, action = primary_action(info, row)
  if view == 1 then
    y = heading(x, y, w, 'Paso 1 · Tempo y UNO', 'Escucha el click. Coloca el cursor en el primer pulso real de la música y marca UNO.')
    box(x, y, w, 70, C.surface)
    fact(x + 14, y + 12, w - 28, 'UNO', info.uno and clock(info.uno) or 'sin marcar', info.uno and C.ok or C.warn)
    fact(x + 14, y + 38, w - 28, 'TEMPO', bpm_text(info.bpm)..' BPM · '..info.num..'/'..info.den..(info.measured and ' · medido' or ' · sin medir'), info.measured and C.text or C.warn)
    y = y + 84
    button(x, y, w, 48, label, action, 'primary', true, 'Enter'); y = y + 60
    button(x, y, half, 38, 'Medir tempo', calibrate)
    button(x + half + 12, y, half, 38, info.uno and 'Marcar UNO de nuevo' or 'Ir al inicio', info.uno and function() special('UNO') end or function() if current() then reaper.SetEditCurPos2(project, 0, true, false) end end)
    paragraph(x, y + 52, w, 'Medir tempo: selecciona en la regla de un UNO a otro UNO y cuenta los compases completos entre ambos.', SMALL, C.muted)
  elseif view == 2 then
    y = heading(x, y, w, 'Paso 2 · Secciones e instrucciones', 'Espacio reproduce y detiene; Enter hace la acción verde.')
    box(x, y, w, 60, C.surface)
    if row then
      local name, pending = display(plain(row.name)), plain(row.name) ~= row.name
      text(x + 14, y + 10, fit(name, w - 150, HEAD), HEAD)
      local chip = pending and 'Pendiente' or 'Confirmada'
      local cw = width(chip, LABEL) + 20
      box(x + w - 14 - cw, y + 10, cw, 22, pending and {0.3,0.24,0.1} or {0.1,0.26,0.18}, 1, 11)
      text(x + w - 4 - cw, y + 15, chip, LABEL, pending and C.warn or C.ok)
      local note = not known(name) and 'Sin voz guía: elige un nombre de la lista con Cambiar nombre.'
        or pending and 'Borrador en '..clock(row.pos)..' · confirma su primer pulso con Enter.' or 'Entrada en '..clock(row.pos)..'.'
      text(x + 14, y + 36, fit(note, w - 28, SMALL), SMALL, known(name) and C.muted or C.warn)
    else
      text(x + 14, y + 10, 'Sin secciones todavía', HEAD, C.muted)
      text(x + 14, y + 36, 'Elige la primera en el grupo Sección y añádela en el cursor.', SMALL, C.muted)
    end
    y = y + 70
    button(x, y, w, 46, label, action, 'primary', true, 'Enter'); y = y + 56
    button(x, y, third, 34, '← Anterior', function() go(-1) end, nil, row ~= nil)
    button(x + third + 12, y, third, 34, 'Ir a entrada', function() go(0) end, nil, row ~= nil)
    button(x + 2 * (third + 12), y, third, 34, 'Siguiente →', function() go(1) end, nil, row ~= nil)
    y = y + 46
    local t, cursor = section_type(), clock(reaper.GetCursorPositionEx(project))
    local choice = custom_name and 'Otro: '..custom_name or t and SECTION_TYPES[t].label..(chosen and '' or ' · sugerida') or 'Elige sección'
    group(x, y, w, 'SECCIÓN', 'Estructura de la canción', C.ok, C.surface, choice, choose_type,
      {{'Añadir sección', add_section, nil, true, 'A'}},
      preview() and 'Se llamará '..preview()..' · en '..cursor or 'Elige el tipo; el número se pone solo.')
    y = y + 106
    group(x, y, w, 'INSTRUCCIÓN', 'Aviso hablado · no crea sección', C.cue, C.cue_card, INSTRUCTION_TYPES[chosen_cue].label, choose_cue,
      {{'Añadir', add_cue, 'cue', true, 'I'}, {'Quitar', remove_cue, nil, selected_cue ~= nil}},
      'Se dirá antes de '..cursor..' · puede repetirse.')
    y = y + 106
    button(x, y, half, 34, 'Cambiar nombre', rename, 'menu', row ~= nil)
    button(x + half + 12, y, half, 34, 'Mover sección aquí', confirm, nil, row ~= nil and plain(row.name) == row.name)
  elseif view == 3 then
    y = heading(x, y, w, 'Paso 3 · FIN AUDIO', 'Coloca el cursor donde termina la última cola de audio, no en el último golpe del click.')
    box(x, y, w, 70, C.surface)
    fact(x + 14, y + 12, w - 28, 'FIN AUDIO', info.fin and clock(info.fin) or 'sin marcar', info.fin and C.ok or C.warn)
    fact(x + 14, y + 38, w - 28, 'FIN DEL AUDIO', clock(audio_end()))
    y = y + 84
    button(x, y, w, 48, label, action, 'primary', true, 'Enter'); y = y + 60
    button(x, y, half, 38, 'Ir al final del audio', go_audio_end)
    if info.fin then button(x + half + 12, y, half, 38, 'Marcar de nuevo aquí', function() special('FIN AUDIO') end) end
  else
    y = heading(x, y, w, 'Paso 4 · Guardar y llevar a Alabanza')
    box(x, y, w, 146, C.surface)
    local fy = y + 12
    fy = fact(x + 14, fy, w - 28, 'SECCIONES', info.sections..' ('..(info.sections - info.drafts)..' confirmadas)')
    fy = fact(x + 14, fy, w - 28, 'INSTRUCCIONES', tostring(info.instructions), info.instructions > 0 and C.cue or C.muted)
    fy = fact(x + 14, fy, w - 28, 'TEMPO', bpm_text(info.bpm)..' BPM · '..info.num..'/'..info.den..(info.measured and '' or ' · sin medir'), not info.measured and C.warn or nil)
    fy = fact(x + 14, fy, w - 28, 'UNO', info.uno and clock(info.uno) or 'sin marcar', not info.uno and C.warn or nil)
    fact(x + 14, fy, w - 28, 'FIN AUDIO', info.fin and clock(info.fin) or 'sin marcar', not info.fin and C.warn or nil)
    y = y + 160
    if info.blocking == 0 then check(x + 2, y + 4, C.ok); text(x + 20, y, 'Listo para subir a Alabanza.', BOLD, C.ok); y = y + 24 end
    for i = 1, math.min(4, #info.issues) do
      local item = info.issues[i]
      text(x, y, fit((item.blocks and 'Falta: ' or 'Aviso: ')..item.text, w, SMALL), SMALL, item.blocks and C.bad or C.warn)
      y = y + 19
    end
    if #info.issues > 4 then text(x, y, 'y '..(#info.issues - 4)..' más.', SMALL, C.muted); y = y + 19 end
    y = y + 10
    button(x, y, w, 48, label, action, 'primary', true, 'Enter'); y = y + 58
    button(x, y, half, 36, 'Solo guardar', function() save(false) end)
    y = y + 46
    if info.blocking > 0 then y = paragraph(x, y, w, 'Puedes guardar ahora; Alabanza no dejará aplicar el mapa hasta corregir lo que falta.', SMALL, C.muted, 2) + 6 end
    if saved_path then paragraph(x, y, w, 'Archivo: '..saved_path, SMALL, C.muted, 2) end
  end
end
local KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN = 0x6C656674, 0x72676874, 0x7570, 0x646F776E
local function loop()
  if not reaper.ValidatePtr(project, 'ReaProject*') then gfx.quit(); return end
  local ch = gfx.getchar(); if ch < 0 or ch == 27 then gfx.quit(); return end
  local down = (gfx.mouse_cap & 1) == 1
  mouse.click = down and not mouse.down; mouse.down = down; mouse.x = gfx.mouse_x; mouse.y = gfx.mouse_y
  local rows = sections(); local index = locate(rows); local row = rows[index]
  if row then selected_id = row.id end
  local info = summary()
  local done = progress(info)
  if ch == 13 then select(2, primary_action(info, row))()
  elseif ch == KEY_LEFT or ch == KEY_UP then go(-1)
  elseif ch == KEY_RIGHT or ch == KEY_DOWN then go(1)
  elseif ch == 32 then transport()
  elseif (ch == 97 or ch == 65) and view == 2 then add_section()
  elseif (ch == 105 or ch == 73) and view == 2 then add_cue() end
  color(C.bg); gfx.rect(0, 0, gfx.w, gfx.h, 1)
  local playing = reaper.GetPlayStateEx(project) & 1 == 1
  local where = playing and 'Reproduciendo  '..clock(reaper.GetPlayPositionEx(project)) or 'Cursor  '..clock(reaper.GetCursorPositionEx(project))
  local ww = width(where, BOLD) + 28
  box(gfx.w - 16 - ww, 18, ww, 34, C.surface, 1, 17)
  text(gfx.w - 2 - ww, 27, where, BOLD, playing and C.warn or C.ok)
  text(16, 16, fit(title, gfx.w - ww - 56, TITLE), TITLE)
  text(16, 46, 'Mapa para Alabanza · los audios no se mueven', SMALL, C.muted)
  stepper(74, done)
  local top, footer = 140, gfx.h - 78
  local list_w = math.max(250, math.floor(gfx.w * 0.37))
  entry_list(16, top, list_w, footer - top - 14, rows, index, info)
  panel(16 + list_w + 20, top, gfx.w - list_w - 52, info, rows, row, done)
  color(C.line); gfx.line(16, footer, gfx.w - 16, footer)
  local tips = {'Marca UNO en el primer pulso real; mide el tempo si el click no coincide.',
    'Espacio reproduce y detiene dejando el cursor donde paraste. Enter confirma o añade ahí.',
    'FIN AUDIO va al final de la última cola, aunque el click termine antes.',
    'Guarda y sube el RPP en Alabanza → Administración → REAPER → Subir y aplicar.'}
  paragraph(16, footer + 10, gfx.w - 32, status ~= '' and status or tips[view], SMALL, status ~= '' and C.text or C.muted, 2)
  text(16, footer + 52, fit('Enter acción principal · ←/→ entradas · Espacio reproducir/detener · A sección · I instrucción · Esc cerrar', gfx.w - 32, SMALL), SMALL, C.muted)
  gfx.mouse_wheel = 0
  gfx.update(); reaper.defer(loop)
end
loop()
