import { useEffect, useState } from 'react';
import './theme-toggle.css';

type Theme = 'light' | 'dark';

/**
 * Live light/dark switch. Flips the single `data-theme` attribute on <html>; every component
 * recolors instantly because they all read from the CSS variables in tokens.css. The choice is
 * persisted in localStorage and re-applied before paint by the inline script in index.html, so it
 * survives reloads. Default is dark (no attribute → the `:root` dark palette).
 *
 * Use when: adding the theme switch to the app shell (mounted once in main.tsx).
 */
function getInitialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Storage can throw in private mode; the toggle still works for the session.
    }
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? (
        // Sun — click to go light.
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Moon — click to go dark.
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
