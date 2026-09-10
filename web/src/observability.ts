import * as Sentry from "@sentry/react";

// Analytics (Umami) and error tracking (Sentry) initialize only when their
// build-time env vars are present. Both are no-ops otherwise, so local dev runs
// without either service configured.

export function initObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (dsn) {
    Sentry.init({ dsn, tracesSampleRate: 0 });
  }

  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
  const umamiUrl = import.meta.env.VITE_UMAMI_URL;
  if (websiteId && umamiUrl) {
    const script = document.createElement("script");
    script.defer = true;
    script.src = umamiUrl;
    script.setAttribute("data-website-id", websiteId);
    document.head.appendChild(script);
  }
}
