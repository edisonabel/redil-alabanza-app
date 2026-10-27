-- Run with Lua 5.3+ or: npm exec --yes --package=fengari-node-cli -- fengari scripts/test-reaper-assistant.lua
ALABANZA_TEST = true
local project, active, playing, cursor = {}, nil, 0, 12.123456789
active=project
local markers = {{id=1,pos=12,name='[BORRADOR] Intro 1'},{id=2,pos=32,name='[BORRADOR] Coro 1'},{id=10001,pos=64,name='[BORRADOR] FIN AUDIO'}}
local tempos, selection, answer, notices = {}, {4,20}, '8,4,4', {}
local items={{beat=1,stretch=1,pos=0,length=64,rate=1}}
local pick, menus, notes, dirty, saves, commands, os_name, play_pos, transport_calls = 0, {}, 'ALABANZA_MAPA_V1:test\nCanción: Prueba', 1, 0, {}, 'macOS-arm64', 0, {}
gfx={showmenu=function(menu) menus[#menus+1]=menu;return pick end}
-- Menu fields without the check-mark flag REAPER uses for the chosen type.
local function options() local rows={};for field in (menus[#menus]..'|'):gmatch('(.-)|') do rows[#rows+1]=(field:gsub('^!','')) end;return rows end
local function has(list,text) for _,row in ipairs(list) do if row.text==text then return row end end end
reaper={
  EnumProjects=function() return active,'/Users/coro/Prueba/Prueba - revisar.RPP' end,
  GetSetProjectNotes=function() return notes end,
  ColorToNative=function(r) return r end,
  ShowMessageBox=function(message,title,kind) notices[#notices+1]=message; return kind==1 and 1 or 0 end,
  GetPlayStateEx=function() return playing end,
  EnumProjectMarkers3=function(_,i) local m=markers[i+1];if not m then return 0 end;return 1,false,m.pos,0,m.name,m.id end,
  SetEditCurPos2=function(_,pos) cursor=pos end,
  GetCursorPositionEx=function() return cursor end,
  Undo_BeginBlock2=function() end,Undo_EndBlock2=function() end,UpdateArrange=function() end,
  SetProjectMarker3=function(_,id,_,pos,_,name) for _,m in ipairs(markers) do if m.id==id then m.pos=pos;m.name=name;return true end end;return false end,
  AddProjectMarker2=function(_,_,pos,_,name,_,color) markers[#markers+1]={id=10002+#markers,pos=pos,name=name,color=color};return markers[#markers].id end,
  DeleteProjectMarker=function(_,id) for i,m in ipairs(markers) do if m.id==id then table.remove(markers,i);return true end end;return false end,
  GetUserInputs=function() return true,answer end,
  GetSet_LoopTimeRange2=function() return selection[1],selection[2] end,
  CountTempoTimeSigMarkers=function() return #tempos end,
  GetTempoTimeSigMarker=function(_,i) local t=tempos[i+1];return true,t.pos,0,0,t.bpm,t.num,t.den,t.linear or false end,
  SetTempoTimeSigMarker=function(_,i,pos,_,_,bpm,num,den) tempos[i<0 and #tempos+1 or i+1]={pos=pos,bpm=bpm,num=num,den=den};return true end,
  CountMediaItems=function() return #items end,GetMediaItem=function(_,i) return items[i+1] end,
  GetMediaItemInfo_Value=function(item,key) return ({D_POSITION=item.pos,D_LENGTH=item.length})[key] end,
  TimeMap_GetTimeSigAtTime=function() local t=tempos[1];if t then return t.num,t.den,t.bpm end;return 4,4,120 end,
  IsProjectDirty=function() return dirty end,Main_SaveProject=function() saves=saves+1;dirty=0 end,
  GetOS=function() return os_name end,ExecProcess=function(command) commands[#commands+1]=command;return '' end,
  GetPlayPositionEx=function() return play_pos end,
  OnStopButtonEx=function() transport_calls[#transport_calls+1]='stop';playing=0 end,OnPlayButtonEx=function() transport_calls[#transport_calls+1]='play';playing=1 end,
  SetMediaItemInfo_Value=function(item,key,value) if key=='C_BEATATTACHMODE' then item.beat=value elseif key=='C_AUTOSTRETCH' then item.stretch=value else error('Unexpected media mutation') end end,
}
local assistant=dofile('public/downloads/Alabanza-Asistente.lua')
assert(assistant.step()==1 and assistant.primary()=='Marcar UNO aquí','Opens on the first unfinished step with its main action')
assistant.confirm();assert(markers[1].name=='Intro 1' and markers[1].pos==12.123456789,'Confirmation must keep precise cursor')
assistant.go(1);assert(cursor==32,'Navigate to next draft')
assistant.special('UNO');assert(markers[#markers].name=='UNO')
local old=#markers;cursor=64;assistant.special('FIN AUDIO');assert(#markers==old,'Update the existing final marker')
playing=1;cursor=10;assistant.confirm();assert(markers[2].name=='[BORRADOR] Coro 1','No edits during playback');playing=0
active={};assistant.special('UNO');assert(markers[#markers].pos==32,'Do not act on another project');active=project
assistant.calibrate();assert(tempos[1].bpm==120 and tempos[1].pos==0 and tempos[2].pos==4 and tempos[1].num==4,'Eight bars in 16 seconds is 120 quarter notes/minute')
assert(items[1].beat==0 and items[1].stretch==0 and items[1].pos==0 and items[1].length==64 and items[1].rate==1,'Audio timing conserved')
selection={4,28};answer='8,6,8';assistant.calibrate();assert(tempos[1].bpm==60 and tempos[1].den==8,'Compound meter converted to quarter notes')
local count=#tempos;tempos[#tempos+1]={pos=32,bpm=80,num=6,den=8};assistant.calibrate();assert(#tempos==count+1 and tempos[1].bpm==60,'Variable map preserved')
-- Visible type dropdown: no preset type; a suggestion only from the song's own pattern.
local custom=#assistant.types+1
cursor=5;assert(assistant.preview()==nil,'Song start with an Intro already there: no suggestion, never Intro 2')
old=#markers;pick=0;assistant.choose();assert(#markers==old and assistant.preview()==nil,'Closing the dropdown changes nothing')
local shown=options();assert(#shown==custom and shown[custom]=='Otro nombre…','Every type plus a custom option')
assert(not menus[#menus]:find('!',1,true),'Nothing is checked until a type is chosen or suggested')
for i,kind in ipairs(assistant.types) do assert(shown[i]:sub(1,#kind.label)==kind.label,'Dropdown follows the generated list') end
assert(shown[1]=='Intro 2' and shown[4]=='Coro 2' and shown[2]=='Verso 1','Next appearance is numbered from existing markers')
pick=4;assistant.choose();assert(assistant.preview()=='Coro 2' and #markers==old,'Choosing a type only updates the preview')
cursor=40;assistant.add();assert(markers[#markers].name=='Coro 2' and markers[#markers].pos==40,'Preview placed at the cursor')
assert(assistant.preview()=='Coro 3','After Coro 1 came Coro 2, so the song suggests the next Coro');cursor=44;assistant.add();assert(markers[#markers].name=='Coro 3')
pick=custom;answer='Coro 2';assistant.choose();old=#markers;assistant.add();assert(#markers==old,'Typed duplicates rejected')
answer='Coro (a capela)';assistant.choose();cursor=44;assistant.add();assert(markers[#markers].name=='Coro (a capela)','Custom names still allowed')
assert(assistant.preview()~='Coro (a capela)','A custom name is used once')
assistant.go(-3);assert(cursor==32,'Select the draft Coro 1')
pick=6;assistant.rename();assert(markers[2].name=='[BORRADOR] Puente 1' and markers[2].pos==32,'Rename keeps position and draft state')
pick=4;assistant.rename();assert(markers[2].name=='[BORRADOR] Coro 4','Renamed marker is not counted against itself')
-- Instructions: their own dropdown and marker prefix; they never count as sections.
local section_count=#assistant.sections()
pick=3;assistant.choose_cue();assert(options()[3]=='Hits' and #options()==#assistant.cues,'Instruction dropdown lists only instructions')
cursor=36;assistant.add_cue();local hits=markers[#markers]
assert(hits.name=='[INSTRUCCIÓN] Hits' and hits.pos==36 and hits.color%0x1000000==150,'Instruction marker is prefixed and violet')
assert(#assistant.sections()==section_count and #assistant.instructions()==1,'An instruction never becomes a section')
old=#markers;assistant.add_cue();assert(#markers==old,'Same instruction twice at one instant rejected')
cursor=38;assistant.add_cue();assert(#markers==old+1,'Instructions may repeat at other points')
pick=4;assistant.choose();assert(assistant.preview()=='Coro 5','Instructions do not change section numbering')
pick=custom;answer='[INSTRUCCIÓN] Pausa';assistant.choose();old=#markers;assistant.add();assert(#markers==old,'Sections cannot take the instruction prefix')
pick=4;assistant.choose()
markers[#markers+1]={id=500,pos=39,name='[instrucción] Pausa'};markers[#markers+1]={id=501,pos=58,name='Sostener'}
assert(#assistant.instructions()==3 and #assistant.sections()==section_count+1,'Unaccented prefix is an instruction; old unprefixed names stay sections')
table.remove(markers);table.remove(markers);table.remove(markers)
assistant.select_cue(hits.id);assert(cursor==36,'Selecting an instruction moves the cursor');assistant.remove_cue()
assert(#assistant.instructions()==0,'Remove the selected instruction')
cursor=36;pick=3;assistant.choose_cue();assistant.add_cue()
for _=1,5 do assistant.go(-1) end;assistant.go(1)
-- Steps and summary mirror what the upload review in Alabanza will ask for.
local info=assistant.summary()
assert(info.sections==5 and info.instructions==1 and info.drafts==1 and info.uno==32 and info.fin==64 and info.measured,'Summary counts sections, instructions and anchors')
assert(has(info.issues,'Falta confirmar 1 entrada.').blocks and has(info.issues,'Dos secciones empiezan en 0:44.000.').blocks,'Blocking issues listed')
assert(not has(info.issues,'Coro (a capela) no tiene voz guía en la lista.').blocks,'Names without a voice are a warning, not a block')
local done,step=assistant.progress();assert(done[1] and not done[2] and done[3] and not done[4] and step==2,'Pending entries keep step 2 open')
assistant.step(2);assert(assistant.primary()=='Confirmar Coro 4 aquí','Step 2 main action confirms the selected draft')
assistant.go(-1);local label,lead=assistant.primary();assert(label=='Ir a Coro 4 (pendiente)','A confirmed selection leads to the next pending entry')
lead();assert(assistant.primary()=='Confirmar Coro 4 aquí')
cursor=50;assistant.confirm();assert(markers[2].name=='Coro 4' and markers[2].pos==50 and cursor==50,'Confirm keeps the cursor')
assert(assistant.status():find('Ahora: Coro 2',1,true),'Selection moves to the next entry')
assert(assistant.primary()=='Secciones listas · seguir a FIN AUDIO →','A complete step leads on; adding becomes secondary')
local _,advance=assistant.primary();advance();assert(assistant.step()==3)
assistant.step(4);assert(assistant.primary()=='Guardar RPP y abrir Alabanza')
assistant.save(true);assert(saves==1 and commands[1]=='/usr/bin/open "https://alabanzaredilestadio.com/admin?area=reaper&paso=subir&song=test"','Save, then open the beta upload page')
assert(assistant.status():find('/Users/coro/Prueba/Prueba - revisar.RPP',1,true) and assistant.status():find('Antes de aplicar',1,true),'Says where the file is and what still blocks')
os_name='Win64';assistant.save(false);assert(saves==2 and #commands==1,'Solo guardar does not open the browser')
assistant.save(true);assert(commands[2]:find('^cmd%.exe /C start "" "https://'),'Windows opens the default browser')
reaper.CF_ShellExecute=function(url) commands[#commands+1]='sws '..url end;assistant.save(true);assert(commands[3]:find('^sws https://'),'SWS is used when present');reaper.CF_ShellExecute=nil
playing=1;play_pos=77.5;assistant.transport();assert(transport_calls[1]=='stop' and cursor==77.5,'Space stops where the music is')
assistant.transport();assert(transport_calls[2]=='play','Space plays again');playing=0
assistant.audio_end();assert(cursor==64,'Jump to the end of the longest item')
-- Every option, three appearances each in a fresh project; test-reaper-section-catalog.mjs resolves these names.
for i=#markers,1,-1 do markers[i]=nil end
for i,kind in ipairs(assistant.types) do
  local names={}
  for n=1,3 do pick=i;assistant.choose();cursor=i*10+n;assistant.add();names[n]=markers[#markers].name end
  print('OPTION\t'..kind.cue..'\t'..table.concat(names,'|'))
end
for i,kind in ipairs(assistant.cues) do
  pick=i;assistant.choose_cue();cursor=300+i;assistant.add_cue();print('CUE\t'..kind.cue..'\t'..markers[#markers].name)
end
-- New song: no drafts or tempo yet, only the prepared FIN AUDIO draft.
markers={{id=10001,pos=64,name='[BORRADOR] FIN AUDIO'}};tempos={};dirty=1;commands={}
notes='ALABANZA_MAPA_V1:canción 1/b\nCanción: Nueva'
assistant=dofile('public/downloads/Alabanza-Asistente.lua')
assert(assistant.step()==1 and assistant.url():find('song=canci%%C3%%B3n%%201%%2Fb$'),'Song id is percent-encoded in the link')
cursor=2;assistant.special('UNO');assert(assistant.progress()[1],'UNO completes step 1')
cursor=4;assert(assistant.preview()=='Intro','An empty song suggests Intro at its start')
assistant.step(2);assert(assistant.primary()=='Añadir Intro aquí','With no sections the main action adds the first one')
for _,entry in ipairs({{1,4},{2,20},{4,40},{2,60}}) do pick=entry[1];assistant.choose();cursor=entry[2];assistant.add() end
assert(markers[3].name=='Intro' and markers[4].name=='Verso 1' and markers[5].name=='Coro 1' and markers[6].name=='Verso 2','New song numbered from the dropdown')
cursor=1;assert(assistant.preview()==nil,'Never a second Intro on its own')
cursor=61;assert(assistant.preview()=='Coro 2','After Verso 2 the song repeats Verso → Coro')
markers[#markers+1]={id=777,pos=50,name='final'}
assistant.audio_end();assistant.special('FIN AUDIO')
info=assistant.summary();assert(info.blocking==0 and #info.issues==1 and info.issues[1].text=='Tempo sin medir: se usará 120 BPM.','Only the tempo warning remains')
done,step=assistant.progress();assert(done[3] and not done[4] and step==4,'Unsaved changes keep step 4 open')
assistant.save(true);done,step=assistant.progress();assert(done[4] and step==4 and #commands==1,'Saved and ready for Alabanza')
-- UI smoke test: run the real gfx loop with a recording stub, visit every step and use the shortcuts.
ALABANZA_TEST=nil
local fonts, font, deferred, drawn, queue, closed = {}, 15, nil, {}, {}, false
gfx={w=840,h=740,mouse_x=0,mouse_y=0,mouse_cap=0,mouse_wheel=0,texth=15,x=0,y=0,
  init=function() end,set=function() end,line=function() end,triangle=function() end,circle=function() end,update=function() end,
  setfont=function(i,_,size) if size then fonts[i]=size end;font=fonts[i] or 15;gfx.texth=font end,
  measurestr=function(text) return utf8.len(text)*font*0.55 end,
  rect=function(x,y,w,h) assert(x>=0 and y>=0 and x+w<=gfx.w+0.5 and y+h<=gfx.h+0.5,'Shape outside the window at '..x..','..y) end,
  drawstr=function(text) drawn[#drawn+1]=text;assert(gfx.x>=0 and gfx.x+gfx.measurestr(text)<=gfx.w+0.5 and gfx.y+gfx.texth<=gfx.h,'Text outside the window: '..text) end,
  getchar=function() return table.remove(queue,1) or 0 end,quit=function() closed=true end,showmenu=function() return 0 end}
reaper.defer=function(fn) deferred=fn end;reaper.ValidatePtr=function() return true end
local function frame(key,x,y) drawn={};queue={key};gfx.mouse_x,gfx.mouse_y,gfx.mouse_cap=x or 0,y or 0,x and 1 or 0;deferred();gfx.mouse_cap=0 end
local function truncated() for _,row in ipairs(drawn) do if row:find('…',1,true) and not row:find('Otro',1,true) then return row end end end
local function seen_exact(text) for _,row in ipairs(drawn) do if row==text then return true end end end
local function seen(text) for _,row in ipairs(drawn) do if row:find(text,1,true) then return true end end end
dofile('public/downloads/Alabanza-Asistente.lua')
local pill=(gfx.w-32-30)/4
for step,title in ipairs({'Paso 1 · Tempo y UNO','Paso 2 · Secciones e instrucciones','Paso 3 · FIN AUDIO','Paso 4 · Guardar y llevar a Alabanza'}) do
  frame(nil,16+(step-1)*(pill+10)+pill/2,98);frame();assert(seen(title),'Step '..step..' is drawn');assert(not truncated(),'Label cut at the default size: '..(truncated() or ''))
end
assert(seen('Guardar RPP y abrir Alabanza') and seen('Enter') and seen('Listo para subir a Alabanza.'),'Summary and main action visible')
local before=#commands;frame(13);assert(#commands==before+1,'Enter runs the main action of the step')
frame(nil,16+(pill+10)+pill/2,98);frame();assert(seen('SECCIÓN') and seen('INSTRUCCIÓN') and seen('Añadir sección') and seen('Quitar') and seen('Coro · sugerida'),'Both dropdown groups visible in step 2')
local count=#markers;cursor=70;frame(97);assert(#markers==count+1 and markers[#markers].name=='Coro 2','A adds the previewed section')
assert(seen('Final') and not seen_exact('final') and markers[7].name=='final','Legacy lowercase name is shown normalized, RPP untouched')
frame(0x6C656674);assert(cursor==50,'Left arrow selects the previous entry')
playing=1;play_pos=12;frame(32);assert(cursor==12 and playing==0,'Space stops at the play position')
local cues=#markers;frame(105);assert(#markers==cues+1 and markers[#markers].name:find('INSTRUCCIÓN',1,true),'I adds the chosen instruction')
frame(27);assert(closed,'Esc closes the window')
print('REAPER assistant: exact confirmation, navigation, anchors, tempo, compound meter, unchanged media, active-project guards, section dropdown, steps, summary, save-and-open, new-song flow and UI smoke passed.')
