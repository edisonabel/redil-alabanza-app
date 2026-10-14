// General incluye todas las canciones autorizadas; Sin Filtros es un subconjunto.
export const matchesSongLibrary = (repertoire = 'general', library = 'general') => (
  library !== 'sin_filtros' || repertoire === 'sin_filtros'
);
