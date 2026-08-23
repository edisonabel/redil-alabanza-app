const AUTH_RETRY_STATUSES = new Set([401, 403]);

const getAuthManager = () => {
  if (typeof window === 'undefined') return null;
  return window.__REDIL_AUTH_MANAGER__ || null;
};

export const synchronizeAuthenticatedSession = async ({ refresh = false } = {}) => {
  const ensureServerSession = getAuthManager()?.ensureServerSession;
  if (typeof ensureServerSession !== 'function') return false;

  return ensureServerSession({
    force: true,
    refresh,
  });
};

export const fetchWithSessionRetry = async (input, init = {}) => {
  try {
    await synchronizeAuthenticatedSession();
  } catch {
    await synchronizeAuthenticatedSession({ refresh: true });
  }

  let response = await fetch(input, init);
  if (!AUTH_RETRY_STATUSES.has(response.status)) {
    return response;
  }

  await synchronizeAuthenticatedSession({ refresh: true });
  response = await fetch(input, init);
  return response;
};
