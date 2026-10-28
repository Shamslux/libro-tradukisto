
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'error'
  | 'unsupported';

interface Props {
  tr: (
    key: string,
    params?: Record<string, string | number>
  ) => string;
  open: boolean;
  onClose: () => void;
  onUpdateAvailable: () => void;
}

const STARTUP_DELAY_MS = 4000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export default function UpdateDialog({
  tr,
  open,
  onClose,
  onUpdateAvailable,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);

  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);
  const notifiedVersionRef = useRef<string | null>(null);

  const onUpdateAvailableRef = useRef(onUpdateAvailable);
  const openRef = useRef(open);
  const phaseRef = useRef<Phase>('idle');

  // Indicates that a manual dialog was opened while a
  // silent check was already running.
  const manualCheckRequestedRef = useRef(false);

  useEffect(() => {
    onUpdateAvailableRef.current = onUpdateAvailable;
  }, [onUpdateAvailable]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const changePhase = (nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    if (mountedRef.current) {
      setPhase(nextPhase);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      const update = updateRef.current;
      updateRef.current = null;

      if (update) {
        void update.close().catch(() => {});
      }
    };
  }, []);

  const checkUpdates = async (silent = false) => {
    if (
      phaseRef.current === 'downloading' ||
      phaseRef.current === 'installing' ||
      phaseRef.current === 'installed'
    ) {
      return;
    }

    // Reuse the active check instead of starting another.
    if (busyRef.current) {
      if (!silent && checkingRef.current) {
        manualCheckRequestedRef.current = true;
        setError('');
        changePhase('checking');
      }
      return;
    }

    busyRef.current = true;
    checkingRef.current = true;

    if (!silent) {
      setError('');
      changePhase('checking');
    }

    try {
      if (!isTauri()) {
        if (!silent && mountedRef.current) {
          changePhase('unsupported');
        }
        return;
      }

      const version = await getVersion();
      const found = await check();

      if (!mountedRef.current) {
        if (found) {
          await found.close().catch(() => {});
        }
        return;
      }

      setCurrentVersion(version);

      if (found) {
        const previousUpdate = updateRef.current;

        if (previousUpdate && previousUpdate !== found) {
          await previousUpdate.close().catch(() => {});
        }

        updateRef.current = found;
        setNewVersion(found.version);
        setNotes(found.body || '');
        setError('');

        changePhase('available');

        // Notify only once per version, and only when
        // the update dialog is not already visible.
        if (
          silent &&
          !openRef.current &&
          notifiedVersionRef.current !== found.version
        ) {
          notifiedVersionRef.current = found.version;
          onUpdateAvailableRef.current();
        }
      } else {
        if (updateRef.current) {
          await updateRef.current.close().catch(() => {});
          updateRef.current = null;
        }

        setNewVersion('');
        setNotes('');
        notifiedVersionRef.current = null;

        // Keep the background check silent, unless
        // the user opened the dialog during the check.
        if (
          !silent ||
          manualCheckRequestedRef.current ||
          openRef.current
        ) {
          changePhase('current');
        } else {
          changePhase('idle');
        }
      }
    } catch (e) {
      if (mountedRef.current) {
        if (
          !silent ||
          manualCheckRequestedRef.current ||
          openRef.current
        ) {
          setError(String(e));
          changePhase('error');
        }
      }
    } finally {
      checkingRef.current = false;
      manualCheckRequestedRef.current = false;
      busyRef.current = false;
    }
  };

  // Automatic checks only in production Tauri builds:
  // first after 4 seconds, then every 6 hours.
  useEffect(() => {
    if (!import.meta.env.PROD || !isTauri()) {
      return;
    }

    const startupTimer = window.setTimeout(() => {
      void checkUpdates(true);
    }, STARTUP_DELAY_MS);

    const intervalTimer = window.setInterval(() => {
      void checkUpdates(true);
    }, CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalTimer);
    };
  }, []);

  // Manual checks, including opening the dialog while
  // an automatic check is already in progress.
  useEffect(() => {
    if (!open) {
      manualCheckRequestedRef.current = false;
      return;
    }

    if (checkingRef.current) {
      manualCheckRequestedRef.current = true;
      changePhase('checking');
      return;
    }

    if (
      phaseRef.current === 'idle' ||
      phaseRef.current === 'error' ||
      phaseRef.current === 'current' ||
      phaseRef.current === 'unsupported'
    ) {
      void checkUpdates(false);
    }
  }, [open]);

  const install = async () => {
    if (!updateRef.current || busyRef.current) {
      return;
    }

    busyRef.current = true;

    setReceived(0);
    setTotal(0);
    setError('');

    changePhase('downloading');

    try {
      await updateRef.current.downloadAndInstall((event) => {
        if (!mountedRef.current) {
          return;
        }

        if (event.event === 'Started') {
          setTotal(event.data.contentLength ?? 0);
          setReceived(0);
        }

        if (event.event === 'Progress') {
          setReceived((value) => value + event.data.chunkLength);
        }

        if (event.event === 'Finished') {
          changePhase('installing');
        }
      });

      if (mountedRef.current) {
        changePhase('installed');
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(String(e));
        changePhase('error');
      }
    } finally {
      busyRef.current = false;
    }
  };

  if (!open) {
    return null;
  }

  const busy =
    phase === 'checking' ||
    phase === 'downloading' ||
    phase === 'installing';

  const message =
    phase === 'checking'
      ? tr('updateChecking')
      : phase === 'available'
        ? tr('updateAvailable')
        : phase === 'current'
          ? tr('updateCurrent')
          : phase === 'downloading'
            ? tr('updateDownloading')
            : phase === 'installing'
              ? tr('updateInstalling')
              : phase === 'installed'
                ? tr('updateInstalled')
                : phase === 'unsupported'
                  ? tr('updateDesktopOnly')
                  : phase === 'error'
                    ? tr('updateCheckError', { error })
                    : '';

  return (
    <div
      className="onboarding-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <div className="update-dialog-header">
          <h2 id="update-dialog-title">
            {tr('updateTitle')}
          </h2>

          <button
            className="about-close"
            type="button"
            disabled={busy}
            aria-label={tr('updateClose')}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p role="status">{message}</p>

        {currentVersion && (
          <p className="update-version">
            {tr('updateCurrentVersion')}: {currentVersion}
          </p>
        )}

        {(phase === 'available' ||
          phase === 'downloading' ||
          phase === 'installing') && (
          <>
            <p className="update-version">
              {tr('updateNewVersion')}:{' '}
              <strong>{newVersion}</strong>
            </p>

            <div>
              <strong>{tr('updateNotes')}</strong>
              <p className="update-release-notes">
                {notes || tr('updateNoNotes')}
              </p>
            </div>
          </>
        )}

        {(phase === 'downloading' ||
          phase === 'installing') && (
          <div
            className="update-progress-track"
            role="progressbar"
            aria-label={tr('updateDownloading')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              total
                ? Math.min(
                    100,
                    Math.round((received / total) * 100)
                  )
                : undefined
            }
          >
            <div
              className="update-progress-fill"
              style={{
                width: total
                  ? `${Math.min(
                      100,
                      (received / total) * 100
                    )}%`
                  : '12%',
              }}
            />
          </div>
        )}

        <div className="update-dialog-actions">
          <button
            type="button"
            className="tour-secondary"
            disabled={busy}
            onClick={onClose}
          >
            {phase === 'available'
              ? tr('updateLater')
              : tr('updateClose')}
          </button>

          {phase === 'available' && (
            <button
              type="button"
              className="onboarding-primary"
              onClick={() => void install()}
            >
              {tr('updateInstall')}
            </button>
          )}

          {(phase === 'error' || phase === 'current') && (
            <button
              type="button"
              className="onboarding-primary"
              onClick={() => void checkUpdates(false)}
            >
              {tr('updateCheck')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
