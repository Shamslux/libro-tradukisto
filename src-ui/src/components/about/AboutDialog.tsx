
import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

interface Props {
  tr: (key: string) => string;
  onClose: () => void;
}

const REPOSITORY = 'https://github.com/Shamslux/libro-tradukisto';
const LEGACY = `${REPOSITORY}/tree/Libro-Tradukisto-Legacy`;

export default function AboutDialog({ tr, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [version, setVersion] = useState('0.1.0');

  useEffect(() => {
    let active = true;

    getVersion()
      .then((value) => {
        if (active) {
          setVersion(value);
        }
      })
      .catch(() => {
      });

    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="onboarding-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <div className="about-heading">
          <span className="about-eyebrow">
            {tr('aboutHeading')}
          </span>

          <button
            type="button"
            ref={closeRef}
            className="about-close"
            onClick={onClose}
            aria-label={tr('aboutClose')}
          >
            ×
          </button>
        </div>

        <div className="about-brand">
          <img
            src="/libro-tradukisto.png"
            alt="Libro Tradukisto"
            className="about-app-icon"
            width={72}
            height={72}
            style={{
              width: 72,
              height: 72,
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />

          <div>
            <h2 id="about-title">
              Libro Tradukisto
            </h2>

            <p>{tr('aboutTagline')}</p>

            <span className="about-version">
              v{version} · Alpha
            </span>
          </div>
        </div>

        <p className="about-description">
          {tr('aboutDescription')}
        </p>

        <div className="about-section">
          <h3>{tr('aboutAuthorLabel')}</h3>

          <p>
            Shamslux · {tr('aboutMaintainer')}
          </p>
        </div>

        <div className="about-section">
          <h3>{tr('aboutContributorsLabel')}</h3>

          <p>
            {tr('aboutContributorsPlaceholder')}
          </p>
        </div>

        <div className="about-section">
          <h3>{tr('aboutHistoryLabel')}</h3>

          <p>{tr('aboutHistoryText')}</p>

          <a
            href={LEGACY}
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr('aboutLegacyLink')} ↗
          </a>
        </div>

        <div className="about-section">
          <h3>{tr('aboutTechnologiesLabel')}</h3>

          <div className="about-tags">
            <span>Tauri</span>
            <span>Rust</span>
            <span>React</span>
            <span>TypeScript</span>
          </div>
        </div>

        <footer className="about-footer">
          <span>GPL-3.0</span>

          <a
            href={REPOSITORY}
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr('aboutRepositoryLink')} ↗
          </a>
        </footer>
      </section>
    </div>
  );
}
