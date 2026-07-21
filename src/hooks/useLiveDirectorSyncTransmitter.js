import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  buildLiveDirectorSyncChannelName,
  isLiveDirectorLeaseFresh,
  LIVE_DIRECTOR_SYNC_HEARTBEAT_MS,
  LIVE_DIRECTOR_SYNC_LEASE_TTL_MS,
  LIVE_DIRECTOR_SYNC_PROBE_MS,
  normalizeLiveDirectorLease,
} from '../utils/liveDirectorSync';

const createSyncId = (prefix) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const useLiveDirectorSyncTransmitter = ({ eventId = '', playlistId = '' } = {}) => {
  const channelName = useMemo(
    () => buildLiveDirectorSyncChannelName({ eventId, playlistId }),
    [eventId, playlistId],
  );
  const clientIdRef = useRef(createSyncId('director'));
  const channelRef = useRef(null);
  const localLeaseRef = useRef(null);
  const remoteLeaseRef = useRef(null);
  const isBroadcastingRef = useRef(false);
  const probeTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [remoteDirectorActive, setRemoteDirectorActive] = useState(false);
  const [takeoverPromptOpen, setTakeoverPromptOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');

  const showNotice = useCallback((message) => {
    setStatusNotice(String(message || '').trim());
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setStatusNotice('');
    }, 4200);
  }, []);

  const publish = useCallback((event, payload) => {
    const channel = channelRef.current;
    if (!channel) return Promise.resolve(false);
    return channel.send({ type: 'broadcast', event, payload });
  }, []);

  const setLocalBroadcasting = useCallback((nextValue) => {
    isBroadcastingRef.current = nextValue;
    setIsBroadcasting(nextValue);
  }, []);

  const emitHeartbeat = useCallback(() => {
    const lease = localLeaseRef.current;
    if (!isBroadcastingRef.current || !lease) return Promise.resolve(false);
    const timestamp = Date.now();
    lease.timestamp = timestamp;
    return publish('DIRECTOR_HEARTBEAT', { ...lease, timestamp });
  }, [publish]);

  const releaseBroadcasting = useCallback((announce = true) => {
    const lease = localLeaseRef.current;
    localLeaseRef.current = null;
    setLocalBroadcasting(false);
    setIsChecking(false);
    setTakeoverPromptOpen(false);
    if (lease && announce) {
      void publish('DIRECTOR_RELEASED', { ...lease, timestamp: Date.now() });
    }
  }, [publish, setLocalBroadcasting]);

  const claimBroadcasting = useCallback((takeover = false) => {
    const timestamp = Date.now();
    const lease = {
      clientId: clientIdRef.current,
      leaseId: createSyncId('lease'),
      leaseStartedAt: timestamp,
      timestamp,
    };

    localLeaseRef.current = lease;
    remoteLeaseRef.current = null;
    setRemoteDirectorActive(false);
    setIsChecking(false);
    setTakeoverPromptOpen(false);
    setLocalBroadcasting(true);
    void publish('DIRECTOR_CLAIMED', { ...lease, takeover });
  }, [publish, setLocalBroadcasting]);

  const hasFreshRemoteDirector = useCallback(() => {
    const remoteLease = remoteLeaseRef.current;
    const isFresh = isLiveDirectorLeaseFresh(remoteLease);
    if (!isFresh && remoteLease) {
      remoteLeaseRef.current = null;
      setRemoteDirectorActive(false);
    }
    return isFresh;
  }, []);

  const toggleBroadcasting = useCallback(() => {
    if (isBroadcastingRef.current) {
      releaseBroadcasting(true);
      return;
    }

    if (!isConnected) {
      showNotice('LIVE no tiene conexión. Intenta de nuevo.');
      return;
    }

    if (hasFreshRemoteDirector()) {
      setTakeoverPromptOpen(true);
      return;
    }

    setIsChecking(true);
    void publish('DIRECTOR_QUERY', {
      clientId: clientIdRef.current,
      timestamp: Date.now(),
    });

    if (probeTimerRef.current !== null) {
      window.clearTimeout(probeTimerRef.current);
    }
    probeTimerRef.current = window.setTimeout(() => {
      probeTimerRef.current = null;
      if (hasFreshRemoteDirector()) {
        setIsChecking(false);
        setTakeoverPromptOpen(true);
        return;
      }
      claimBroadcasting(false);
    }, LIVE_DIRECTOR_SYNC_PROBE_MS);
  }, [claimBroadcasting, hasFreshRemoteDirector, isConnected, publish, releaseBroadcasting, showNotice]);

  const confirmTakeover = useCallback(() => {
    claimBroadcasting(true);
  }, [claimBroadcasting]);

  const cancelTakeover = useCallback(() => {
    setTakeoverPromptOpen(false);
    setIsChecking(false);
  }, []);

  const sendSectionChange = useCallback((payload) => {
    const lease = localLeaseRef.current;
    if (!isBroadcastingRef.current || !lease || !channelRef.current) {
      return Promise.resolve(false);
    }
    return publish('SECTION_CHANGE', {
      ...payload,
      directorClientId: lease.clientId,
      directorLeaseId: lease.leaseId,
      leaseStartedAt: lease.leaseStartedAt,
      timestamp: Date.now(),
    });
  }, [publish]);

  useEffect(() => {
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    const acceptRemoteLease = (rawPayload, isClaim = false) => {
      const lease = normalizeLiveDirectorLease(rawPayload);
      if (!lease || lease.clientId === clientIdRef.current) return;

      const localLease = localLeaseRef.current;
      const shouldYieldLocal = Boolean(
        isBroadcastingRef.current
        && localLease
        && (
          rawPayload?.takeover === true
          || lease.leaseStartedAt > localLease.leaseStartedAt
          || (
            lease.leaseStartedAt === localLease.leaseStartedAt
            && lease.leaseId > localLease.leaseId
          )
        )
      );

      if (isBroadcastingRef.current && !shouldYieldLocal) return;

      const currentRemote = remoteLeaseRef.current;
      if (
        currentRemote
        && isLiveDirectorLeaseFresh(currentRemote)
        && currentRemote.leaseStartedAt > lease.leaseStartedAt
      ) {
        return;
      }

      remoteLeaseRef.current = lease;
      setRemoteDirectorActive(true);
      if (shouldYieldLocal) {
        localLeaseRef.current = null;
        setLocalBroadcasting(false);
        setIsChecking(false);
        setTakeoverPromptOpen(false);
        showNotice('Otro dispositivo tomó LIVE. Sigues en modo local.');
      } else if (isClaim) {
        setIsChecking(false);
      }
    };

    channel
      .on('broadcast', { event: 'DIRECTOR_QUERY' }, () => {
        void emitHeartbeat();
      })
      .on('broadcast', { event: 'DIRECTOR_CLAIMED' }, ({ payload }) => {
        acceptRemoteLease(payload, true);
      })
      .on('broadcast', { event: 'DIRECTOR_HEARTBEAT' }, ({ payload }) => {
        acceptRemoteLease(payload, false);
      })
      .on('broadcast', { event: 'DIRECTOR_RELEASED' }, ({ payload }) => {
        const releasedClientId = String(payload?.clientId || '').trim();
        const releasedLeaseId = String(payload?.leaseId || '').trim();
        const remoteLease = remoteLeaseRef.current;
        if (
          remoteLease
          && remoteLease.clientId === releasedClientId
          && remoteLease.leaseId === releasedLeaseId
        ) {
          remoteLeaseRef.current = null;
          setRemoteDirectorActive(false);
        }
      })
      .subscribe((status) => {
        const connected = status === 'SUBSCRIBED';
        setIsConnected(connected);
        if (connected) {
          void channel.send({
            type: 'broadcast',
            event: 'DIRECTOR_QUERY',
            payload: { clientId: clientIdRef.current, timestamp: Date.now() },
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          localLeaseRef.current = null;
          setLocalBroadcasting(false);
          setIsChecking(false);
        }
      });

    const expiryTimer = window.setInterval(() => {
      const remoteLease = remoteLeaseRef.current;
      if (remoteLease && !isLiveDirectorLeaseFresh(remoteLease, Date.now(), LIVE_DIRECTOR_SYNC_LEASE_TTL_MS)) {
        remoteLeaseRef.current = null;
        setRemoteDirectorActive(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(expiryTimer);
      if (probeTimerRef.current !== null) {
        window.clearTimeout(probeTimerRef.current);
        probeTimerRef.current = null;
      }
      const lease = localLeaseRef.current;
      if (lease && isBroadcastingRef.current) {
        void channel.send({
          type: 'broadcast',
          event: 'DIRECTOR_RELEASED',
          payload: { ...lease, timestamp: Date.now() },
        });
      }
      channelRef.current = null;
      supabase.removeChannel(channel);
      localLeaseRef.current = null;
      remoteLeaseRef.current = null;
      isBroadcastingRef.current = false;
    };
  }, [channelName, emitHeartbeat, setLocalBroadcasting, showNotice]);

  useEffect(() => {
    if (!isConnected || !isBroadcasting) return undefined;
    void emitHeartbeat();
    const heartbeatTimer = window.setInterval(() => {
      void emitHeartbeat();
    }, LIVE_DIRECTOR_SYNC_HEARTBEAT_MS);
    return () => window.clearInterval(heartbeatTimer);
  }, [emitHeartbeat, isBroadcasting, isConnected]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const broadcastState = isBroadcasting
    ? 'active'
    : isChecking
      ? 'checking'
      : remoteDirectorActive
        ? 'occupied'
        : isConnected
          ? 'off'
          : 'unavailable';

  return {
    broadcastState,
    cancelTakeover,
    confirmTakeover,
    isBroadcasting,
    isConnected,
    sendSectionChange,
    statusNotice,
    takeoverPromptOpen,
    toggleBroadcasting,
  };
};
