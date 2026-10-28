import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tourSteps } from './tourSteps';

interface Props { tr: (key: string) => string; onClose: () => void; }
type Rectangle = { top: number; left: number; width: number; height: number };

export default function InteractiveTour({ tr, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rectangle | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const panelRef = useRef<HTMLDivElement>(null);
  const step = tourSteps[index];

  useLayoutEffect(() => {
    const element = document.querySelector(step.selector) ?? (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null);
    if (element) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const target = document.querySelector(step.selector) ?? (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null);
      if (!target) { setRect(null); return; }
      const r = target.getBoundingClientRect();
      setRect({ top: Math.max(0, r.top - 6), left: Math.max(0, r.left - 6), width: r.width + 12, height: r.height + 12 });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [step]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'ArrowRight') setIndex(i => Math.min(tourSteps.length - 1, i + 1));
      if (event.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const panelWidth = Math.min(360, viewport.width - 32);
  const left = rect ? Math.min(Math.max(16, rect.left), viewport.width - panelWidth - 16) : Math.max(16, (viewport.width - panelWidth) / 2);
  const below = rect ? rect.top + rect.height + 16 : 24;
  const top = rect ? (below + 235 < viewport.height ? below : Math.max(16, rect.top - 245)) : Math.max(16, (viewport.height - 240) / 2);
  const cutout = rect ? `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left}px ${rect.top}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left}px ${rect.top}px)` : undefined;

  return (
    <div className="tour-root" role="presentation">
      <div className="tour-dimmer" style={cutout ? { clipPath: cutout, clipRule: 'evenodd' } : undefined} />
      {rect && <div className="tour-focus-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />}
      <div className="tour-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-heading" style={{ top, left, width: panelWidth }}>
        <div className="tour-panel-top"><span>{tr('tourProgress').replace('{current}', String(index + 1)).replace('{total}', String(tourSteps.length))}</span><button type="button" className="tour-close" onClick={onClose} aria-label={tr('tourSkip')}>×</button></div>
        <div className="tour-progress-track"><div style={{ width: `${(index + 1) / tourSteps.length * 100}%` }} /></div>
        <h2 id="tour-heading">{tr(step.title)}</h2>
        <p>{tr(step.description)}</p>
        <div className="tour-controls"><button type="button" className="tour-secondary" onClick={onClose}>{tr('tourSkip')}</button><div><button type="button" className="tour-secondary" disabled={index === 0} onClick={() => setIndex(i => i - 1)}>{tr('tourBack')}</button><button type="button" className="onboarding-primary" onClick={() => index === tourSteps.length - 1 ? onClose() : setIndex(i => i + 1)}>{tr(index === tourSteps.length - 1 ? 'tourFinish' : 'tourNext')}</button></div></div>
      </div>
    </div>
  );
}
