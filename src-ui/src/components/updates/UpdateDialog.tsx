import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';

type Phase = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'installing' | 'installed' | 'error' | 'unsupported';
interface Props { tr: (key: string, params?: Record<string, string | number>) => string; open: boolean; onClose: () => void; }

export default function UpdateDialog({ tr, open, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentVersion, setCurrentVersion] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const checkedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; updateRef.current?.close().catch(() => {}); };
  }, []);

  const checkUpdates = async (silent = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    if (!silent) setPhase('checking');
    try {
      if (!isTauri()) { if (!silent) setPhase('unsupported'); return; }
      const version = await getVersion();
      const found = await check();
      if (!mountedRef.current) { await found?.close(); return; }
      setCurrentVersion(version);
      if (found) {
        if (updateRef.current && updateRef.current !== found) await updateRef.current.close();
        updateRef.current = found;
        setNewVersion(found.version);
        setNotes(found.body || '');
        setPhase('available');
      } else if (!silent) {
        setPhase('current');
      }
    } catch (e) {
      if (!silent) { setError(String(e)); setPhase('error'); }
    } finally { busyRef.current = false; }
  };

  // One background check per application session, only in packaged production builds.
  useEffect(() => {
    if (checkedRef.current || !import.meta.env.PROD || !isTauri()) return;
    checkedRef.current = true;
    void checkUpdates(true);
  }, []);

  useEffect(() => {
    if (open && (phase === 'idle' || phase === 'error' || phase === 'current' || phase === 'unsupported')) void checkUpdates();
  }, [open]);

  const install = async () => {
    if (!updateRef.current || busyRef.current) return;
    busyRef.current = true;
    setReceived(0); setTotal(0); setPhase('downloading');
    try {
      await updateRef.current.downloadAndInstall((event) => {
        if (!mountedRef.current) return;
        if (event.event === 'Started') { setTotal(event.data.contentLength ?? 0); setReceived(0); }
        if (event.event === 'Progress') setReceived(v => v + event.data.chunkLength);
        if (event.event === 'Finished') setPhase('installing');
      });
      if (mountedRef.current) setPhase('installed');
    } catch (e) {
      if (mountedRef.current) { setError(String(e)); setPhase('error'); }
    } finally { busyRef.current = false; }
  };

  if (!open && phase !== 'available') return null;
  // An update discovered in the background is shown only when the welcome/tour is no longer active.
  if (!open) return null;
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const message = phase === 'checking' ? tr('updateChecking') :
    phase === 'available' ? tr('updateAvailable') :
    phase === 'current' ? tr('updateCurrent') :
    phase === 'downloading' ? tr('updateDownloading') :
    phase === 'installing' ? tr('updateInstalling') :
    phase === 'installed' ? tr('updateInstalled') :
    phase === 'unsupported' ? tr('updateDesktopOnly') :
    phase === 'error' ? tr('updateCheckError', { error }) : '';
  return (
    <div className="onboarding-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <div className="update-dialog-header"><h2 id="update-dialog-title">{tr('updateTitle')}</h2><button className="about-close" type="button" disabled={busy} aria-label={tr('updateClose')} onClick={onClose}>×</button></div>
        <p role="status">{message}</p>
        {currentVersion && <p className="update-version">{tr('updateCurrentVersion')}: {currentVersion}</p>}
        {(phase === 'available' || phase === 'downloading' || phase === 'installing') && <>
          <p className="update-version">{tr('updateNewVersion')}: <strong>{newVersion}</strong></p>
          <div><strong>{tr('updateNotes')}</strong><p className="update-release-notes">{notes || tr('updateNoNotes')}</p></div>
        </>}
        {(phase === 'downloading' || phase === 'installing') && <div className="update-progress-track" role="progressbar" aria-label={tr('updateDownloading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.min(100, Math.round(received / total * 100)) : undefined}><div className="update-progress-fill" style={{ width: total ? `${Math.min(100, received / total * 100)}%` : '12%' }} /></div>}
        <div className="update-dialog-actions">
          <button type="button" className="tour-secondary" disabled={busy} onClick={onClose}>{phase === 'available' ? tr('updateLater') : tr('updateClose')}</button>
          {phase === 'available' && <button type="button" className="onboarding-primary" onClick={() => void install()}>{tr('updateInstall')}</button>}
          {(phase === 'error' || phase === 'current') && <button type="button" className="onboarding-primary" onClick={() => void checkUpdates()}>{tr('updateCheck')}</button>}
        </div>
      </section>
    </div>
  );
}
