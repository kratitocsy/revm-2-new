import { useEffect, useRef, useState, useCallback } from 'react';
import { sb } from './supabaseClient';
import {
  applyAddTopic,
  applyMarkReviewed,
  applyRemoveTopic,
  rowsToTopics,
  type TrackerRow,
} from './wynkoTracker';
import type { Topic } from '../MobileHome';

export type AuthState = 'loading' | 'signed-out' | 'ready';

const SAVE_DEBOUNCE_MS = 1500; // matches src/features/tracker/tracker-sync.js

export function useWynkoTopics() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const userIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadForSession = useCallback(async (userId: string) => {
    setLoadingRows(true);
    const { data, error } = await sb
      .from('user_profiles')
      .select('tracker_data')
      .eq('id', userId)
      .single();
    if (!error && data?.tracker_data) {
      setRows(data.tracker_data as TrackerRow[]);
    } else {
      setRows([]);
    }
    setLoadingRows(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    sb.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (!session) {
        setAuthState('signed-out');
        setLoadingRows(false);
        return;
      }
      userIdRef.current = session.user.id;
      setAuthState('ready');
      loadForSession(session.user.id);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        userIdRef.current = null;
        setAuthState('signed-out');
        setRows([]);
        return;
      }
      userIdRef.current = session.user.id;
      setAuthState('ready');
      loadForSession(session.user.id);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadForSession]);

  // Debounced write-back to Supabase, same 1.5s debounce as
  // syncTrackerToSupabase in tracker-sync.js so the two don't fight
  // over save timing if both happen to be open at once.
  const persist = useCallback((nextRows: TrackerRow[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const userId = userIdRef.current;
      if (!userId) return;
      try {
        await sb
          .from('user_profiles')
          .update({ tracker_data: nextRows, last_active_at: new Date().toISOString() })
          .eq('id', userId);
      } catch {
        // sync must never break the app — same policy as tracker-sync.js
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const mutate = useCallback(
    (updater: (prev: TrackerRow[]) => TrackerRow[]) => {
      setRows((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const addTopic = useCallback((subject: string, topicName: string) => mutate((prev) => applyAddTopic(prev, subject, topicName)), [mutate]);
  const removeTopic = useCallback((id: number) => mutate((prev) => applyRemoveTopic(prev, id)), [mutate]);
  const markAsReviewed = useCallback((id: number) => mutate((prev) => applyMarkReviewed(prev, id)), [mutate]);

  const topics: Topic[] = rowsToTopics(rows);

  return { authState, topics, loading: loadingRows, addTopic, removeTopic, markAsReviewed };
}
