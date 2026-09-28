/**
 * Otakuria Companion - Content Script Bridge (v1.0.0)
 *
 * Runs on all web pages:
 * 1. On Otakuria web app: Acts as the network bridge for the client app.
 * 2. On manga source websites (e.g. Bokugents, Manga-Oni, LeerCapitulo): Detects when Cloudflare/Turnstile challenges
 *    are completed and allows extracting the live rendered DOM directly to Otakuria.
 */

(function () {
  if (window.__OTAKURIA_COMPANION_INJECTED__) return;

  const currentHost = (typeof window !== 'undefined' && window.location ? window.location.hostname : '').toLowerCase();
  const EXTENSION_VERSION = '1.0.0';

  // Helper to determine if the current page is an Otakuria instance
  function isOtakuriaPage() {
    if (typeof document === 'undefined') return false;
    const host = window.location.hostname.toLowerCase();
    const title = (document.title || '').toLowerCase();
    const docEl = document.documentElement;

    return (
      host.includes('otakuria') ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      title.includes('otakuria') ||
      (docEl && (docEl.hasAttribute('data-otakuria') || docEl.getAttribute('data-app') === 'otakuria')) ||
      Boolean(document.querySelector('meta[name="application-name"][content*="Otakuria" i]')) ||
      Boolean(document.querySelector('meta[property="og:site_name"][content*="Otakuria" i]')) ||
      Boolean(document.querySelector('#otakuria-app')) ||
      Boolean(document.querySelector('[data-otakuria]'))
    );
  }

  function markAsOtakuriaApp() {
    if (document.documentElement) {
      document.documentElement.setAttribute('data-otakuria-extension', EXTENSION_VERSION);
    }
  }

  function announcePresence() {
    markAsOtakuriaApp();

    window.postMessage({
      source: 'otakuria-companion-extension',
      type: 'EXTENSION_READY',
      version: EXTENSION_VERSION,
      timestamp: Date.now()
    }, '*');

    window.dispatchEvent(new CustomEvent('otakuria-extension-ready', {
      detail: { version: EXTENSION_VERSION, active: true }
    }));
  }

  // -------------------------------------------------------------
  // UNIVERSAL MESSAGE LISTENER
  // If ANY tab sends a message with source 'otakuria-web-client',
  // we know for certain this page is an Otakuria instance!
  // -------------------------------------------------------------
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    const { source, id, payload } = event.data;
    if (source !== 'otakuria-web-client' || !id || !payload) return;

    // Immediately mark DOM and announce so Otakuria recognizes extension
    markAsOtakuriaApp();

    try {
      if (!chrome.runtime || !chrome.runtime.id || !chrome.runtime.sendMessage) {
        throw new Error('Extension context invalidated');
      }

      chrome.runtime.sendMessage(payload, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          const errMsg = lastError.message || '';
          if (errMsg.includes('invalidated') || errMsg.includes('context')) {
            window.postMessage({
              source: 'otakuria-companion-extension',
              id: id,
              response: { ok: false, error: 'La extensión fue recargada en Chrome. Reconectando página...' }
            }, '*');
            if (isOtakuriaPage()) {
              setTimeout(() => window.location.reload(), 600);
            }
            return;
          }
        }

        window.postMessage({
          source: 'otakuria-companion-extension',
          id: id,
          response: response || { ok: false, error: 'Respuesta vacía de la extensión' }
        }, '*');
      });
    } catch (err) {
      window.postMessage({
        source: 'otakuria-companion-extension',
        id: id,
        response: { ok: false, error: 'La extensión fue recargada en Chrome. Reconectando página...' }
      }, '*');
      if (isOtakuriaPage()) {
        setTimeout(() => window.location.reload(), 600);
      }
    }
  });

  // Listen for push notifications from background worker (e.g. challenge solved in another tab)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'CHALLENGE_RESOLVED') {
      window.postMessage({
        source: 'otakuria-companion-extension',
        type: 'CHALLENGE_RESOLVED',
        domain: msg.domain,
        url: msg.url
      }, '*');

      window.dispatchEvent(new CustomEvent('otakuria-challenge-resolved', {
        detail: { domain: msg.domain, url: msg.url }
      }));
    }

    // Branch B: If this tab is an external source and background asks for DOM
    if (msg && msg.action === 'GET_PAGE_DATA') {
      sendResponse({
        ok: true,
        html: document.documentElement ? document.documentElement.outerHTML : '',
        url: window.location.href,
        title: document.title,
      });
      return false;
    }
  });

  // Check if Otakuria page on startup and whenever DOM changes
  if (isOtakuriaPage()) {
    announcePresence();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isOtakuriaPage()) {
        announcePresence();
      } else {
        checkAndNotifySolved();
      }
    });
  } else {
    if (!isOtakuriaPage()) {
      checkAndNotifySolved();
    }
  }

  // -------------------------------------------------------------
  // EXTERNAL SOURCE CLOUDFLARE MONITORING
  // -------------------------------------------------------------
  let challengeWasSeen = false;
  let solvedNotified = false;

  function isChallengePage() {
    const title = (document.title || '').toLowerCase();
    const isChallengeTitle =
      title.includes('just a moment...') ||
      title.includes('attention required') ||
      title.includes('security check') ||
      title.includes('please wait');

    const hasChallengeElement = Boolean(
      document.getElementById('challenge-running') ||
      document.getElementById('challenge-stage') ||
      document.getElementById('challenge-form') ||
      document.querySelector('[id*="cf-challenge"]')
    );

    return isChallengeTitle || hasChallengeElement;
  }

  function checkAndNotifySolved() {
    if (isOtakuriaPage() || solvedNotified) return;

    if (isChallengePage()) {
      challengeWasSeen = true;
      try {
        sessionStorage.setItem('cf_challenge_seen', 'true');
      } catch {}
      return;
    }

    // If the page is active, ready, and has real DOM content (not a blank screen or challenge)
    const bodyText = document.body ? (document.body.innerText || '') : '';
    if (
      (document.readyState === 'interactive' || document.readyState === 'complete') &&
      bodyText.length > 50
    ) {
      solvedNotified = true;
      chrome.runtime.sendMessage({
        action: 'TAB_SOLVED',
        domain: window.location.hostname,
        url: window.location.href,
      }).catch(() => {});
    }
  }

  // Monitor external source pages for CF challenge → real content transition
  function startChallengeMonitor() {
    if (isOtakuriaPage()) return;

    // MutationObserver: watch for title changes and major DOM updates
    // This fires when Cloudflare JS replaces the challenge page with real content
    const observer = new MutationObserver(() => {
      if (solvedNotified) {
        observer.disconnect();
        return;
      }
      checkAndNotifySolved();
    });

    // Observe the entire document for structural changes (CF challenge → real page)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also watch <title> changes specifically
    const titleEl = document.querySelector('title');
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    // Periodic fallback checks at increasing intervals
    const checkIntervals = [800, 1500, 3000, 5000, 8000, 12000];
    for (const delay of checkIntervals) {
      setTimeout(() => {
        if (!solvedNotified) checkAndNotifySolved();
      }, delay);
    }

    // Listen for navigation events within the same tab
    window.addEventListener('load', () => {
      setTimeout(checkAndNotifySolved, 500);
    });

    // When the tab gets user focus, reset solvedNotified and check so Otakuria updates instantly!
    window.addEventListener('focus', () => {
      if (!isOtakuriaPage()) {
        solvedNotified = false;
        checkAndNotifySolved();
      }
    });
  }

  // Check external tab states
  if (!isOtakuriaPage()) {
    try {
      chrome.storage.local.get(['otakuriaDomains'], (result) => {
        const domains = result.otakuriaDomains || [];
        const currentHost = window.location.hostname;
        const isRegistered = domains.some((d) => currentHost === d || currentHost.endsWith('.' + d));
        if (isRegistered) {
          setTimeout(checkAndNotifySolved, 1200);
          setTimeout(checkAndNotifySolved, 3000);
          startChallengeMonitor();
        }
      });
    } catch (e) {
      console.warn('[Otakuria Companion] Failed to check domains', e);
    }
  }
})();
