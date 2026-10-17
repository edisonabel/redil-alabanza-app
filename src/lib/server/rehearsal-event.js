// Older playlist-ready emails used the playlist UUID instead of the event UUID.
// Resolve both through the caller's authenticated client so RLS still applies.
export async function resolveRehearsalEventById(client, routeId, eventColumns) {
  const eventResult = await client.from('eventos').select(eventColumns)
    .eq('id', routeId).maybeSingle();
  if (eventResult.error || eventResult.data) return eventResult;

  const playlistResult = await client.from('playlists').select('evento_id')
    .eq('id', routeId).maybeSingle();
  if (playlistResult.error) return { data: null, error: playlistResult.error };
  if (!playlistResult.data?.evento_id) return eventResult;

  return client.from('eventos').select(eventColumns)
    .eq('id', playlistResult.data.evento_id).maybeSingle();
}
