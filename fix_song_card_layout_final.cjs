const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src', 'pages', 'repertorio.astro');
let content = fs.readFileSync(file, 'utf8');

const updatedScript = `
 // =============================================
 // DETECCIÓN DE MODOS DE LA PÁGINA (Setlist Semanal vs Playlist vs Normal)
 // =============================================
 const urlParams = new URLSearchParams(window.location.search);
 const seleccionarPara = urlParams.get('seleccionar_para');
 const setlistParam = urlParams.get('setlist');
 const isSelectionMode = !!seleccionarPara;
 const isSetlistSemana = !!setlistParam;

 let selectedSongs = [];
 const playlistBar = document.getElementById('playlistBar');
 const playlistCountEl = document.getElementById('playlistCount');

 // Helper local para setlist normal
 let setlist = JSON.parse(localStorage.getItem('setlist') || '[]');

 function updateSetlistUI() {
 if (setlistCount) setlistCount.textContent = setlist.length.toString();
 if (setlistPanel) {
 if (setlist.length > 0) {
 setlistPanel.classList.remove('hidden');
 } else {
 setlistPanel.classList.add('hidden');
 }
 }
 }

 function updatePlaylistCount() {
 if (playlistCountEl) playlistCountEl.textContent = selectedSongs.length.toString();
 }

 // =============================================
 // BLOQUE 1: MODO SETLIST DE LA SEMANA (Solo ver, no buscar ni scrollear)
 // =============================================
 if (isSetlistSemana) {
 try {
 const decodedData = decodeURIComponent(atob(setlistParam));
 const setlistArray = JSON.parse(decodedData);
 
 if (searchControls) searchControls.style.display = 'none';
 if (setlistPanel) setlistPanel.style.display = 'none';
 if (mainTitle) mainTitle.innerHTML = 'Setlist de la <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">Semana</span>';

 cards.forEach(card => {
 const cancionTitulo = card.getAttribute('data-cancion') || '';
 
 if (setlistArray.includes(cancionTitulo)) {
 card.classList.remove('cancion-oculta'); // Critical FIX: Remover clase !important
 card.style.display = 'block';
 const addBtn = card.querySelector('.btn-add-setlist');
 if(addBtn) addBtn.style.display = 'none';
 } else {
 card.classList.add('cancion-oculta');
 card.style.display = 'none';
 }
 });
 // Detenemos la ejecución aquí porque no necesitamos modo infinito ni filtros
 return; 

 } catch (e) {
 console.error("Error validando el link del setlist:", e);
 window.location.href = window.location.pathname;
 return; // Detener ejecución para evitar bugs de pintado 
 }
 }

 // =============================================
 // BLOQUE 2: PREPARACIÓN DE UI PARA SELECCIÓN O MODO NORMAL
 // =============================================
 if (isSelectionMode) {
 if (mainTitle) mainTitle.innerHTML = 'Seleccionar <span class="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">Playlist</span>';
 if (setlistPanel) setlistPanel.style.display = 'none';
 if (playlistBar) playlistBar.classList.remove('hidden');

 // Pre-cargar canciones de la playlist existente
 (async () => {
 const { data: pl } = await supabase.from('playlists').select('id').eq('evento_id', seleccionarPara).single();
 if (pl) {
 const { data: items } = await supabase.from('playlist_canciones').select('canciones(titulo)').eq('playlist_id', pl.id);
 if (items) {
 items.forEach(item => {
 if (item.canciones?.titulo) selectedSongs.push(item.canciones.titulo);
 });
 cards.forEach(card => {
 const cancion = card.getAttribute('data-cancion') || '';
 if (selectedSongs.includes(cancion)) {
 const btn = card.querySelector('.btn-add-setlist');
 if (btn) {
 const svg = btn.querySelector('svg');
 if (svg) svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
 btn.classList.replace('text-blue-400', 'text-green-400');
 btn.classList.replace('bg-blue-500/10', 'bg-green-500/10');
 }
 }
 });
 updatePlaylistCount();
 }
 }
 })();

 // Listeners de Guardar y Cancelar Playlist
 document.getElementById('btn-cancel-playlist')?.addEventListener('click', () => { window.location.href = '/programacion'; });
 
 document.getElementById('btn-save-playlist')?.addEventListener('click', async () => {
 const btn = document.getElementById('btn-save-playlist');
 btn.disabled = true;
 btn.innerHTML = 'Guardando...';

 try {
 const { data: playlist, error: plErr } = await supabase.from('playlists').upsert({ evento_id: seleccionarPara }, { onConflict: 'evento_id' }).select('id').single();
 if (plErr) throw plErr;

 await supabase.from('playlist_canciones').delete().eq('playlist_id', playlist.id);

 if (selectedSongs.length > 0) {
 const { data: cancionesDB } = await supabase.from('canciones').select('id, titulo').in('titulo', selectedSongs);
 if (cancionesDB && cancionesDB.length > 0) {
 const insertPayload = cancionesDB.map((c, i) => ({ playlist_id: playlist.id, cancion_id: c.id, orden: i }));
 const { error: insErr } = await supabase.from('playlist_canciones').insert(insertPayload);
 if (insErr) throw insErr;
 }
 }
 window.location.href = '/programacion';
 } catch (err) {
 alert('Error al guardar: ' + (err.message || 'Error desconocido'));
 btn.disabled = false;
 btn.innerHTML = 'Guardar Playlist';
 }
 });

 } else {
 // Modo local / Setlist normal temporal
 updateSetlistUI();

 if (btnCopySetlist) {
 btnCopySetlist.addEventListener('click', () => {
 const base64Str = btoa(encodeURIComponent(JSON.stringify(setlist)));
 const url = window.location.origin + window.location.pathname + '?setlist=' + encodeURIComponent(base64Str);
 navigator.clipboard.writeText(url).then(() => {
 alert('¡Setlist copiado y abierto en una nueva pestaña!');
 window.open(url, '_blank');
 });
 });
 }

 if (btnClearSetlist) {
 btnClearSetlist.addEventListener('click', () => {
 setlist = [];
 localStorage.removeItem('setlist');
 updateSetlistUI();
 window.location.href = window.location.pathname;
 });
 }
 }

 // Listener Universal para el botón + de las tarjetas
 document.addEventListener('click', (e) => {
 const btn = e.target.closest('.btn-add-setlist');
 if (!btn) return;
 e.preventDefault();
 e.stopPropagation();

 const cancion = btn.getAttribute('data-cancion');
 if (!cancion) return;
 const svg = btn.querySelector('svg');

 if (isSelectionMode) {
 const idx = selectedSongs.indexOf(cancion);
 if (idx > -1) {
 selectedSongs.splice(idx, 1);
 if (svg) svg.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
 btn.classList.replace('text-green-400', 'text-blue-400');
 btn.classList.replace('bg-green-500/10', 'bg-blue-500/10');
 } else {
 selectedSongs.push(cancion);
 if (svg) svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
 btn.classList.replace('text-blue-400', 'text-green-400');
 btn.classList.replace('bg-blue-500/10', 'bg-green-500/10');
 }
 updatePlaylistCount();
 } else {
 if (!setlist.includes(cancion)) {
 setlist.push(cancion);
 localStorage.setItem('setlist', JSON.stringify(setlist));
 updateSetlistUI();
 if (svg) {
 svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
 btn.classList.replace('text-blue-400', 'text-green-400');
 btn.classList.replace('bg-blue-500/10', 'bg-green-500/10');
 }
 }
 }
 }, true);

 // =============================================
 // BLOQUE 3: INFINITE SCROLL & BÚSQUEDA (COMPARTIDO MODO NORMAL Y PLAYLIST)
 // =============================================
 const sentinel = document.getElementById('scroll-sentinel');
 const todasLasCanciones = Array.from(cards);
 let cancionesFiltradas = [...todasLasCanciones];
 let indiceActual = 0;
 const limite = 15;
 let isLoading = false;
 
 function cargarMasCanciones() {
 if (isLoading) return;
 isLoading = true;

 const fragmento = cancionesFiltradas.slice(indiceActual, indiceActual + limite);
 if (fragmento.length === 0) {
 if (sentinel) sentinel.style.display = 'none';
 isLoading = false;
 return;
 }
 
 fragmento.forEach(card => {
 card.classList.remove('cancion-oculta');
 card.style.display = ''; // Resetear el display modificado por el filtrado
 });
 indiceActual += limite;
 
 if (sentinel) {
 sentinel.style.display = (indiceActual >= cancionesFiltradas.length) ? 'none' : 'block';
 }

 requestAnimationFrame(() => {
 isLoading = false;
 if (sentinel && sentinel.style.display !== 'none') {
 const rect = sentinel.getBoundingClientRect();
 if (rect.top <= window.innerHeight + 150) {
 cargarMasCanciones();
 }
 }
 });
 }
 
 const observer = new IntersectionObserver((entries) => {
 if (entries[0].isIntersecting) cargarMasCanciones();
 }, { root: null, rootMargin: '150px', threshold: 0 });
 
 if (sentinel) observer.observe(sentinel);

 const normalizeStr = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';

 function debounce(func, wait) {
 let timeout;
 return function(...args) {
 clearTimeout(timeout);
 timeout = setTimeout(() => func(...args), wait);
 };
 }

 function filterCards() {
 const searchTerm = normalizeStr(searchInput.value).trim();
 const vozTerm = filterVoz.value;
 const categoriaTerm = filterCategoria.value;
 const temaTerm = filterTema.value;

 todasLasCanciones.forEach(card => card.classList.add('cancion-oculta'));
 indiceActual = 0;

 cancionesFiltradas = todasLasCanciones.filter(card => {
 const titulo = normalizeStr(card.getAttribute('data-titulo') || '');
 const artista = normalizeStr(card.getAttribute('data-artista') || '');
 const voz = card.getAttribute('data-voz') || '';
 const categoria = card.getAttribute('data-categoria') || '';
 const tema = card.getAttribute('data-tema') || '';

 const matchesSearch = titulo.includes(searchTerm) || artista.includes(searchTerm);
 const matchesVoz = vozTerm === 'Todas' || voz.includes(vozTerm);
 const matchesCategoria = categoriaTerm === 'Todas' || categoria.includes(categoriaTerm);
 const matchesTema = temaTerm === 'Todas' || tema.includes(temaTerm);

 return matchesSearch && matchesVoz && matchesCategoria && matchesTema;
 });

 todasLasCanciones.forEach(card => card.style.display = 'none');
 cargarMasCanciones();
 }

 const debouncedFilterCards = debounce(filterCards, 300);

 if(searchInput) searchInput.addEventListener('input', debouncedFilterCards);
 if(filterVoz) filterVoz.addEventListener('change', debouncedFilterCards);
 if(filterCategoria) filterCategoria.addEventListener('change', debouncedFilterCards);
 if(filterTema) filterTema.addEventListener('change', debouncedFilterCards);

`;

const startIdx = content.indexOf('// =============================================\n // MÓDULO PLAYLIST');
if (startIdx === -1) {
  // Try another approach if format has changed
  const altStart = content.indexOf('// MÓDULO PLAYLIST');
  const altEnd = content.indexOf('// ----- Metrónomo Interactivo Logic -----');
  if (altStart !== -1 && altEnd !== -1) {
    // Find the previous // === block to cut properly
    const realStart = content.lastIndexOf('// ==', altStart);
    content = content.substring(0, realStart) + updatedScript + "\n " + content.substring(altEnd);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Script regenerado con exito via fallback');
    process.exit(0);
  }
  console.log('No se encontro // MODULO PLAYLIST');
  process.exit(1);
}

const endIdx = content.indexOf('// ----- Metrónomo Interactivo Logic -----');

if (startIdx !== -1 && endIdx !== -1) {
  content = content.substring(0, startIdx) + updatedScript + "\n " + content.substring(endIdx);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Script regenerado con éxito');
} else {
  console.error('No se encontraron los indices exactos:', startIdx, endIdx);
}
