const getErrorHaystack = (error) =>
  `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
    .toLowerCase()
    .trim();

export const isPredicadorColumnMissingError = (error) => {
  if (!error) return false;
  const haystack = getErrorHaystack(error);
  return haystack.includes('predicador') && (
    haystack.includes('column') ||
    haystack.includes('schema cache') ||
    haystack.includes('select')
  );
};

export const withPredicadorFallbackRow = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  return {
    ...row,
    predicador: typeof row.predicador === 'string' ? row.predicador : '',
  };
};

export const withPredicadorFallbackRows = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map((row) => withPredicadorFallbackRow(row));
