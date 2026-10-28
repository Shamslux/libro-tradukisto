import { useEffect, useRef } from 'react';

interface Props {
  tr: (key: string) => string;
  onClose: () => void;
  onStartTour: () => void;
}

export default function WelcomeDialog({ tr, onClose, onStartTour }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="onboarding-overlay" role="presentation">
      <section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description">
        <div className="onboarding-emblem" aria-hidden="true">✦</div>
        <h2 id="onboarding-title">{tr('onboardingWelcomeTitle')}</h2>
        <p id="onboarding-description">{tr('onboardingWelcomeDescription')}</p>
        <div className="onboarding-intro-list">
          <p>{tr('onboardingImport')}</p>
          <p>{tr('onboardingConfigure')}</p>
          <p>{tr('onboardingExport')}</p>
        </div>
        <p className="onboarding-note">{tr('tourIntro')}</p>
        <div className="onboarding-welcome-actions"><button ref={closeRef} type="button" className="onboarding-primary" onClick={onStartTour}>{tr('tourStart')}</button><button type="button" className="tour-secondary" onClick={onClose}>{tr('onboardingExplore')}</button></div>
      </section>
    </div>
  );
}
