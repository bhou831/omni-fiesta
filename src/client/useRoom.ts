import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Command, CommandResult, Role, RoomSnapshot } from '../shared/contracts.js';
import { post, requestId, RequestError } from './api.js';

export function useRoom(role: Role, code: string | null, displayToken?: string) {
  const [state, setState] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [clockOffset, setClockOffset] = useState(0);
  // The command in flight, e.g. `phase.host:settle`, so the clicked button can say it is working.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const sending = useRef(false);
  const pending = useRef<{ key: string; command: Command } | null>(null);
  useEffect(() => {
    setState(null);
    setError('');
    setConnected(false);
    pending.current = null;
    if (!code) return;
    const socket = io({
      auth: { role, code, ...(displayToken ? { displayToken } : {}) },
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;
    const clock = () => {
      const start = Date.now();
      socket.timeout(3000).emit('clock', (err: Error | null, reply: { serverTime: number }) => {
        if (!err) setClockOffset(reply.serverTime - (start + Date.now()) / 2);
      });
    };
    socket.on('connect', () => {
      setConnected(true);
      setError('');
      socket.emit('sync');
      clock();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      setError(err.message);
    });
    socket.on('session-expired', () => {
      setConnected(false);
      setError('Your session expired. Reload to sign in or join again.');
    });
    socket.on('room-archived', () => {
      setConnected(false);
      setState(null);
      setError('This party is archived. Ask the host to restore it.');
    });
    socket.on('state', (next: RoomSnapshot) =>
      setState((previous) =>
        previous?.serverInstance === next.serverInstance &&
        previous.snapshotSequence >= next.snapshotSequence
          ? previous
          : next,
      ),
    );
    const sync = () => {
      if (socket.connected) {
        socket.emit('sync');
        clock();
      }
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    const clockTimer = setInterval(sync, 30_000);
    return () => {
      clearInterval(clockTimer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, code, displayToken]);
  const command = useCallback(
    async (type: Command['type'], payload?: Command['payload']) => {
      if (!state || !code || role === 'display' || sending.current || !connected) return;
      sending.current = true;
      const key = JSON.stringify({ code, phaseInstance: state.room.phaseInstance, type, payload });
      if (!pending.current || pending.current.key !== key)
        pending.current = {
          key,
          command: {
            requestId: requestId(),
            phaseInstance: state.room.phaseInstance,
            type,
            ...(payload ? { payload } : {}),
          },
        };
      setBusyKey(`${type}:${payload?.action ?? ''}`);
      setError('');
      try {
        const response = await post<CommandResult>(
          `/api/rooms/${code}/commands?role=${role}`,
          pending.current.command,
        );
        pending.current = null;
        socketRef.current?.emit('sync');
        return response;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Please try again.');
        if (!(err instanceof RequestError) || err.code !== 'NETWORK') pending.current = null;
        socketRef.current?.emit('sync');
      } finally {
        sending.current = false;
        setBusyKey(null);
      }
    },
    [state, code, role, connected],
  );
  // An error from the previous round would read as a failure in the new one.
  const phaseInstance = state?.room.phaseInstance;
  useEffect(() => setError(''), [phaseInstance]);
  return { state, connected, error, clockOffset, command, busy: busyKey !== null, busyKey };
}
