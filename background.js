/**
 * Otakuria Companion - Service Worker (Background)
 *
 * Responsibilities:
 * 1. Execute cross-origin network requests directly from the user's browser,
 *    bypassing CORS restrictions with host_permissions.
 * 2. Carry real browser cookies and session headers.
 * 3. Extract live rendered DOM from open tabs if the user solved a challenge there.
 * 4. Broadcast challenge resolution events to all active Otakuria tabs.
 */

const registeredDomains = new Set();
const autoCreatedTabs = new Set();
const pendingTabCreations = new Set();
let nextRuleId = 100;

function getRootDomain(hostname) {
  if (!hostname) return '';
  const clean = hostname.toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const commonDoubleTlds = ['co.uk', 'com.br', 'com.mx', 'com.ar', 'org.uk', 'net.br', 'com.tr'];
  const lastTwo = parts.slice(-2).join('.');
  if (commonDoubleTlds.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function getRefererHost(root) {
  if (!root) return '';
  if (root.includes('ntr-files')) return 'manga-oni.com';
  if (root.includes('leercapitulo')) return 'www.leercapitulo.co';
  if (root.includes('mangasnosekai')) return 'mangasnosekai.com';
  if (root.includes('bokugents')) return 'bokugents.com';
  if (root.includes('begatranslation')) return 'begatranslation.com';
  return root;
}

async function ensureDomainRules(domainOrUrl) {
  if (!chrome.declarativeNetRequest) return;
  let hostname = '';
  try {
    if (domainOrUrl.startsWith('http://') || domainOrUrl.startsWith('https://')) {
      hostname = new URL(domainOrUrl).hostname;
    } else {
      hostname = domainOrUrl.split('/')[0];
    }
  } catch {
    return;
  }
  const root = getRootDomain(hostname);
  if (!root || registeredDomains.has(root) || root.includes('localhost') || root.includes('127.0.0.1')) return;
  registeredDomains.add(root);

  try {
    const refererHost = getRefererHost(root);
    const ruleId = nextRuleId++;
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: ruleId,
          priority: 10,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: `https://${refererHost}/` }
            ],
            responseHeaders: [
              { header: 'cross-origin-resource-policy', operation: 'set', value: 'cross-origin' },
              { header: 'cross-origin-embedder-policy', operation: 'remove' },
              { header: 'access-control-allow-origin', operation: 'set', value: '*' }
            ]
          },
          condition: {
            urlFilter: `||${root}`,
            resourceTypes: ['image', 'xmlhttprequest', 'sub_frame', 'other', 'media']
          }
        }
      ]
    });
    // Persist registered domains
    chrome.storage.local.set({ otakuria_dynamic_domains: Array.from(registeredDomains) }).catch(() => {});
  } catch (err) {
    console.warn('[Otakuria Companion] Failed to register declarativeNetRequest rule for', root, err);
  }
}

async function initDeclarativeRules() {
  if (!chrome.declarativeNetRequest) return;
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(r => r.id);
    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds
      });
    }
    registeredDomains.clear();
    nextRuleId = 100;

    const defaultDomains = [
      'mangasnosekai.com',
      'bokugents.com',
      'manga-oni.com',
      'ntr-files.online',
      'leercapitulo.com',
      'leercapitulo.co',
      'begatranslation.com',
      'tumangaonline.site',
      'visormangas.com',
      'zonatmo.com',
      'manhuafast.com',
      'olympusscanlation.com',
      'bato.to'
    ];
    for (const d of defaultDomains) {
      await ensureDomainRules(d);
    }

    // Restore any previously registered domains from storage
    try {
      const stored = await chrome.storage.local.get(['otakuria_dynamic_domains']);
      if (Array.isArray(stored?.otakuria_dynamic_domains)) {
        for (const d of stored.otakuria_dynamic_domains) {
          await ensureDomainRules(d);
        }
      }
    } catch {}
  } catch (err) {
    console.warn('[Otakuria Companion] Error initializing declarative rules:', err);
  }
}

initDeclarativeRules();
chrome.runtime.onInstalled.addListener(() => {
  initDeclarativeRules();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  switch (message.action) {
    case 'PING': {
      sendResponse({
        success: true,
        version: '1.0.0',
        active: true,
        timestamp: Date.now()
      });
      return false;
    }

    case 'REGISTER_DOMAINS':
    case 'REGISTER_DOMAIN': {
      const domains = Array.isArray(message.domains) ? message.domains : [message.domain || message.url];
      Promise.all(domains.filter(Boolean).map(d => ensureDomainRules(d)))
        .then(() => sendResponse({ success: true, count: domains.length }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }

    case 'FETCH': {
      if (message.url) ensureDomainRules(message.url).catch(() => {});
      handleSmartFetch(message.url, message.options)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({
          ok: false,
          error: err.message || 'Error desconocido al realizar la petición',
          isChallenge: false
        }));
      return true; // Keep channel open for async response
    }

    case 'OPEN_TAB': {
      const targetUrl = message.url;
      const isBackground = Boolean(message.background);
      let targetHost = '';
      try {
        targetHost = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, '');
      } catch {}

      if (targetHost) {
        ensureDomainRules(targetHost).catch(() => {});
      }
      
      const rootHost = getRootDomain(targetHost) || targetHost;
      if (pendingTabCreations.has(rootHost)) {
        // Tab is already being opened for this domain, just return success
        sendResponse({ success: true, reused: true, tabId: null });
        return false;
      }

      chrome.tabs.query({}, (tabs) => {
        // Prevent opening duplicate tabs
        const existingTab = tabs.find(t => {
          if (!t.url || (!t.url.startsWith('http://') && !t.url.startsWith('https://'))) return false;
          try {
            const h = new URL(t.url).hostname.toLowerCase().replace(/^www\./, '');
            const root1 = getRootDomain(h);
            const root2 = getRootDomain(targetHost);
            return t.url === targetUrl || (root1 && root2 && root1 === root2);
          } catch {
            return false;
          }
        });

        if (existingTab && existingTab.id) {
          if (!isBackground) {
            const isSameUrl = existingTab.url && existingTab.url.replace(/\/+$/, '') === targetUrl.replace(/\/+$/, '');
            const updateProps = isSameUrl ? { active: true } : { active: true, url: targetUrl };
            chrome.tabs.update(existingTab.id, updateProps, (tab) => {
              if (existingTab.windowId) {
                chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => {});
              }
              if (isSameUrl) {
                chrome.tabs.reload(existingTab.id).catch(() => {});
              }
              sendResponse({ success: true, tabId: tab?.id || existingTab.id, reused: true });
            });
          } else {
            // Background request with existing tab:
            // ALWAYS reload or navigate existingTab to targetUrl so Cloudflare verification re-runs!
            const isSameUrl = existingTab.url && existingTab.url.replace(/\/+$/, '') === targetUrl.replace(/\/+$/, '');
            if (isSameUrl) {
              chrome.tabs.reload(existingTab.id).catch(() => {});
            } else {
              chrome.tabs.update(existingTab.id, { url: targetUrl }).catch(() => {});
            }
            sendResponse({ success: true, tabId: existingTab.id, reused: true });
          }
        } else {
          pendingTabCreations.add(rootHost);
          chrome.tabs.create({ url: targetUrl, active: !isBackground }, (tab) => {
            if (isBackground && tab && tab.id) {
              autoCreatedTabs.add(tab.id);
            }
            sendResponse({ success: true, tabId: tab?.id, reused: false });
            setTimeout(() => { pendingTabCreations.delete(rootHost); }, 2000);
          });
        }
      });
      return true;
    }

    case 'TAB_SOLVED': {
      if (message.domain) ensureDomainRules(message.domain).catch(() => {});
      // If this tab was being programmatically navigated for DOM extraction, don't broadcast
      if (sender.tab && sender.tab.id && navigatingTabs.has(sender.tab.id)) {
        navigatingTabs.delete(sender.tab.id);
        sendResponse({ success: true, internal: true });
        return false;
      }

      // Broadcast to all tabs running Otakuria that this domain was solved
      notifyOtakuriaTabs({
        action: 'CHALLENGE_RESOLVED',
        domain: message.domain,
        url: message.url
      });

      // Do not auto-close the tab! Leaving it open preserves the Cloudflare session across navigation.
      if (sender.tab && sender.tab.id && autoCreatedTabs.has(sender.tab.id)) {
        autoCreatedTabs.delete(sender.tab.id);
      }

      sendResponse({ success: true });
      return false;
    }

    case 'FETCH_IMAGE': {
      if (message.url) ensureDomainRules(message.url).catch(() => {});
      fetchImageAsDataUrl(message.url)
        .then(dataUrl => sendResponse({ ok: true, dataUrl }))
        .catch(err => sendResponse({ ok: false, error: err.message || 'Error al obtener la imagen' }));
      return true;
    }

    case 'GET_COOKIES': {
      chrome.cookies.getAll({ domain: message.domain }, (cookies) => {
        sendResponse({ success: true, cookies });
      });
      return true;
    }

    default:
      return false;
  }
});

function arrayBufferToDataUrl(buffer, mimeType = 'image/jpeg') {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function fetchImageAsDataUrl(url) {
  if (!url) throw new Error('URL de imagen vacía');
  await ensureDomainRules(url);

  let cleanHost = '';
  let root = '';
  try {
    const urlObj = new URL(url);
    cleanHost = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    root = getRootDomain(cleanHost);
  } catch {}

  // 1. If an open tab matches the domain (or any manga source tab), execute fetch in its context
  // This automatically provides cloudflare clearance cookies, real referer, and browser fingerprint
  try {
    const allTabs = await chrome.tabs.query({});
    let matchingTab = allTabs.find(t => {
      if (!t.url || (!t.url.startsWith('http://') && !t.url.startsWith('https://'))) return false;
      try {
        const tabHost = new URL(t.url).hostname.toLowerCase().replace(/^www\./, '');
        const tabRoot = getRootDomain(tabHost);
        return tabHost === cleanHost || tabHost.endsWith('.' + cleanHost) || cleanHost.endsWith('.' + tabHost) || (root && tabRoot && root === tabRoot);
      } catch {
        return false;
      }
    });

    // Fallback: match any open manga extension source tab
    if (!matchingTab) {
      matchingTab = allTabs.find(t => {
        if (!t.url || (!t.url.startsWith('http://') && !t.url.startsWith('https://'))) return false;
        const u = t.url.toLowerCase();
        return u.includes('bokugents') || u.includes('mangasnosekai') || u.includes('manga-oni') || u.includes('begatranslation') || u.includes('leercapitulo');
      });
    }

    if (matchingTab && matchingTab.id) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        func: async (imgUrl) => {
          // Method 1: Fetch in authenticated tab context
          try {
            const res = await fetch(imgUrl, {
              credentials: 'include',
              referrerPolicy: 'no-referrer',
              headers: {
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
              }
            });
            if (res.ok) {
              const mime = (res.headers.get('content-type') || 'image/jpeg').toLowerCase();
              if (mime.includes('text/html') || mime.includes('text/plain')) {
                return null; // Don't return HTML challenge page as image
              }
              const buffer = await res.arrayBuffer();
              let binary = '';
              const bytes = new Uint8Array(buffer);
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, chunk);
              }
              return `data:${mime};base64,${btoa(binary)}`;
            }
          } catch {}

          // Method 2: Off-screen Image element + Canvas
          try {
            const dataUrl = await new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              const timer = setTimeout(() => reject(new Error('timeout')), 8000);
              img.onload = () => {
                clearTimeout(timer);
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.naturalWidth || img.width;
                  canvas.height = img.naturalHeight || img.height;
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL('image/jpeg', 0.9));
                  } else {
                    reject(new Error('No canvas context'));
                  }
                } catch (e) {
                  reject(e);
                }
              };
              img.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Image failed to load in tab'));
              };
              img.src = imgUrl;
            });
            if (dataUrl) return dataUrl;
          } catch {}

          return null;
        },
        args: [url]
      });

      if (results?.[0]?.result) {
        return results[0].result;
      }
    }
  } catch {
    // Fall through to background fetch
  }

  // 2. Fetch directly from background service worker with declarativeNetRequest injected headers
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (res.status === 403 || res.status === 503) {
      throw new Error('La respuesta fue HTML (desafío Cloudflare), no una imagen');
    }

    if (res.ok) {
      const mime = (res.headers.get('content-type') || 'image/jpeg').toLowerCase();
      if (mime.includes('text/html') || mime.includes('text/plain')) {
        throw new Error('La respuesta fue HTML (desafío Cloudflare), no una imagen');
      }
      const buffer = await res.arrayBuffer();
      return arrayBufferToDataUrl(buffer, mime);
    }
  } catch (err) {
    console.warn('[Otakuria Companion] Service worker fetch failed:', err);
    if (err.message && err.message.includes('Cloudflare')) {
      throw err;
    }
  }

  throw new Error('Fallo al cargar imagen mediante la extensión');
}

const navigatingTabs = new Set();
let lastSolvedDomain = '';
let lastSolvedTime = 0;

function notifyOtakuriaTabs(payload) {
  const now = Date.now();
  if (payload.domain && payload.domain === lastSolvedDomain && (now - lastSolvedTime) < 5000) {
    return; // Ignore duplicate solve events within 5 seconds
  }
  lastSolvedDomain = payload.domain || '';
  lastSolvedTime = now;

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  });
}

/**
 * Checks if HTML response looks like a Cloudflare or Captcha challenge page.
 */
function isCloudflareChallenge(status, html) {
  if (!html) return false;
  const lowerHtml = html.toLowerCase();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch ? titleMatch[1] : '').toLowerCase();

  const isChallengeTitle =
    title.includes('just a moment...') ||
    title.includes('attention required') ||
    title.includes('security check') ||
    title.includes('please wait');

  const hasChallengeElements =
    lowerHtml.includes('id="challenge-running"') ||
    lowerHtml.includes('id="challenge-stage"') ||
    lowerHtml.includes('id="cf-challenge-running"') ||
    lowerHtml.includes('id="challenge-form"');

  if (status === 403 || status === 503) {
    if (
      isChallengeTitle ||
      hasChallengeElements ||
      lowerHtml.includes('cf-turnstile') ||
      lowerHtml.includes('challenge-platform') ||
      lowerHtml.includes('cf-chl-widget') ||
      lowerHtml.includes('cloudflare')
    ) {
      return true;
    }
  }

  return isChallengeTitle || hasChallengeElements;
}

async function extractDomFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          ok: true,
          html: document.documentElement ? document.documentElement.outerHTML : '',
          url: window.location.href,
          title: document.title,
        };
      },
    });
    if (results?.[0]?.result?.html) {
      return results[0].result;
    }
  } catch {}
  return null;
}

function isSameUrlOrPath(urlA, urlB) {
  if (!urlA || !urlB) return true;
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    const pathA = a.pathname.replace(/\/+$/, '');
    const pathB = b.pathname.replace(/\/+$/, '');
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && pathA === pathB;
  } catch {
    return urlA.replace(/\/+$/, '') === urlB.replace(/\/+$/, '');
  }
}

function waitForTabAndExtractDom(tabId, expectedUrl, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let finished = false;
    let pollInterval = null;
    const startTime = Date.now();

    const timer = setTimeout(async () => {
      cleanup();
      const data = await extractDomFromTab(tabId);
      resolve(data);
    }, timeoutMs);

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    }

    // Try to extract DOM, but if it's a Cloudflare challenge, keep waiting
    async function tryExtractOrWait() {
      if (finished) return;
      const data = await extractDomFromTab(tabId);
      if (data && data.html) {
        // Check if the page is still showing a Cloudflare challenge
        if (isCloudflareChallenge(200, data.html)) {
          // Challenge not yet solved — keep waiting if we have time remaining
          const elapsed = Date.now() - startTime;
          if (elapsed < timeoutMs - 1000) {
            // Don't resolve yet; let the polling/timer continue
            return;
          }
        }
        // Real content or timeout approaching — resolve
        cleanup();
        resolve(data);
      }
    }

    async function onUpdatedListener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        const tabUrl = tab?.url || '';
        if (!expectedUrl || isSameUrlOrPath(tabUrl, expectedUrl)) {
          // Wait a moment for JS to finish rendering
          setTimeout(async () => {
            await tryExtractOrWait();
          }, 500);
        }
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdatedListener);

    // Continuous polling: checks every 1.5s if the page resolved from challenge to real content
    setTimeout(() => {
      if (finished) return;
      pollInterval = setInterval(async () => {
        if (finished) return;
        chrome.tabs.get(tabId, async (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          if (tab.status === 'complete' && (!expectedUrl || isSameUrlOrPath(tab.url, expectedUrl))) {
            await tryExtractOrWait();
          }
        });
      }, 1500);
    }, 800);
  });
}

/**
 * Smart fetch:
 * 1. Checks if a tab is already open with this exact URL or domain and rendered.
 * 2. If open and solved, extracts DOM directly from the tab.
 * 3. Otherwise performs fetch with credentials or navigates the helper tab.
 */
async function handleSmartFetch(url, options = {}) {
  // Try to find if a tab is open on this domain (matching root domain, www, or subdomains)
  try {
    const targetUrlObj = new URL(url);
    const targetHost = targetUrlObj.hostname.toLowerCase();
    const cleanHost = targetHost.replace(/^www\./, '');

    // Check all open tabs to find any matching domain (HTTP/HTTPS only)
    const allTabs = await chrome.tabs.query({});
    const matchingTabs = allTabs.filter(t => {
      if (!t.url || (!t.url.startsWith('http://') && !t.url.startsWith('https://'))) return false;
      try {
        const tabHost = new URL(t.url).hostname.toLowerCase().replace(/^www\./, '');
        return tabHost === cleanHost || tabHost.endsWith('.' + cleanHost) || cleanHost.endsWith('.' + tabHost);
      } catch {
        return false;
      }
    });

    if (matchingTabs.length > 0) {
      const cleanUrl = url.replace(/\/+$/, '');
      const matchingTab = matchingTabs.find(t => t.url && t.url.replace(/\/+$/, '') === cleanUrl) || matchingTabs[0];

      if (matchingTab && matchingTab.id) {
        // A) If the tab is on the exact URL requested, extract rendered DOM directly!
        if (matchingTab.url && matchingTab.url.replace(/\/+$/, '') === cleanUrl) {
          const tabData = await extractDomFromTab(matchingTab.id);
          if (tabData && tabData.html && !isCloudflareChallenge(200, tabData.html)) {
            return {
              ok: true,
              status: 200,
              statusText: 'OK (From Tab DOM)',
              headers: { 'content-type': 'text/html; charset=utf-8' },
              text: tabData.html,
              isChallenge: false,
              url: tabData.url || url,
            };
          }
        }

        // B) If tab is on this domain, execute fetch directly INSIDE the authenticated tab context!
        try {
          const executionResults = await chrome.scripting.executeScript({
            target: { tabId: matchingTab.id },
            func: async (targetFetchUrl, reqOptions) => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000);
                const fOpts = {
                  method: reqOptions?.method || 'GET',
                  headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': navigator.language || 'es-ES,es;q=0.9,en;q=0.8',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1',
                    ...(reqOptions?.headers || {}),
                  },
                  credentials: 'include',
                  signal: controller.signal
                };
                if (reqOptions?.body && reqOptions.method !== 'GET') {
                  fOpts.body = reqOptions.body;
                }
                const res = await fetch(targetFetchUrl, fOpts);
                clearTimeout(timeoutId);
                let text = '';
                try {
                  text = await res.text();
                } catch {
                  text = '';
                }
                return {
                  ok: res.ok,
                  status: res.status,
                  statusText: res.statusText,
                  url: res.url,
                  text: text,
                };
              } catch (err) {
                return { ok: false, error: err.message };
              }
            },
            args: [url, options]
          });

          const tabFetchResult = executionResults?.[0]?.result;
          if (tabFetchResult && tabFetchResult.text) {
            const isChallenge = isCloudflareChallenge(tabFetchResult.status, tabFetchResult.text);
            if (!isChallenge && tabFetchResult.status >= 200 && tabFetchResult.status < 400 && tabFetchResult.text.length > 80) {
              return {
                ok: true,
                status: tabFetchResult.status,
                statusText: 'OK (Via Tab Context)',
                headers: { 'content-type': 'text/html; charset=utf-8' },
                text: tabFetchResult.text,
                isChallenge: false,
                url: tabFetchResult.url || url,
              };
            }
          }
        } catch {
          // Tab execution failed
        }
      }
    }
  } catch {
    // Continue with standard fetch
  }

  // Fallback to native background fetch
  const fetchOptions = {
    method: options.method || 'GET',
    headers: options.headers || {},
    credentials: 'include'
  };

  if (options.body && options.method !== 'GET' && options.method !== 'HEAD') {
    fetchOptions.body = options.body;
  }

  try {
    const res = await fetch(url, fetchOptions);
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }

    const isChallenge = isCloudflareChallenge(res.status, text);

    const headersObj = {};
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((val, key) => {
        headersObj[key] = val;
      });
    }

    return {
      ok: res.ok && !isChallenge,
      status: res.status,
      statusText: res.statusText,
      headers: headersObj,
      text: text,
      isChallenge: isChallenge,
      url: res.url || url,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err ? (err.message || String(err)) : 'Fallo de conexión en el navegador',
      isChallenge: false,
    };
  }
}
