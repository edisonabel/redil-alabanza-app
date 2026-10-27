const AUTH_RETRY_STATUS = 401;

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

const createReplayableRequest = (input, init) => {
  const baseUrl = globalThis.location?.href || 'http://localhost/';
  const normalizedInput = typeof input === 'string' || input instanceof URL
    ? new URL(String(input), baseUrl)
    : input;
  const request = new Request(normalizedInput, init);
  return () => request.clone();
};

export const createFetchWithSessionRecovery = ({
  fetchImpl,
  ensureServerSession,
  expireSession,
  shouldHandle = () => true,
  isDefinitiveAuthError = () => false,
}) => async (input, init = {}) => {
  if (!shouldHandle(input)) {
    return fetchImpl(input, init);
  }

  const nextRequest = createReplayableRequest(input, init);

  try {
    const synchronized = await ensureServerSession({ force: false, refresh: false });
    if (!synchronized) {
      // There may still be a valid server cookie. Let the API response decide
      // whether this is an anonymous/public request or a dead auth session.
    }
  } catch (syncError) {
    try {
      await ensureServerSession({ force: true, refresh: true });
    } catch (refreshError) {
      if (isDefinitiveAuthError(refreshError) || isDefinitiveAuthError(syncError)) {
        await expireSession({ reason: 'session-refresh-rejected' });
      }
    }
  }

  let response = await fetchImpl(nextRequest());
  if (response.status !== AUTH_RETRY_STATUS) {
    return response;
  }

  let refreshed = false;
  try {
    refreshed = await ensureServerSession({ force: true, refresh: true });
  } catch (refreshError) {
    if (isDefinitiveAuthError(refreshError)) {
      await expireSession({ reason: 'session-refresh-rejected' });
    }
    return response;
  }

  if (!refreshed) {
    await expireSession({ reason: 'session-missing' });
    return response;
  }

  response = await fetchImpl(nextRequest());
  if (response.status === AUTH_RETRY_STATUS) {
    await expireSession({ reason: 'session-rejected-after-refresh' });
  }

  return response;
};

export const fetchWithSessionRetry = async (input, init = {}) => {
  const managedFetch = getAuthManager()?.fetchWithSessionRecovery;
  if (typeof managedFetch === 'function') {
    return managedFetch(input, init);
  }

  return createFetchWithSessionRecovery({
    fetchImpl: globalThis.fetch,
    ensureServerSession: (options) => synchronizeAuthenticatedSession({
      refresh: options?.refresh === true,
    }),
    expireSession: async (options) => {
      await getAuthManager()?.expireSession?.(options);
    },
  })(input, init);
};
