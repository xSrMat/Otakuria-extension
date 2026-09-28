document.addEventListener('DOMContentLoaded', () => {
  const btnOpen = document.getElementById('btnOpenOtakuria');
  const btnTest = document.getElementById('btnTest');
  const statusBox = document.getElementById('statusBox');

  btnOpen.addEventListener('click', async () => {
    try {
      // Look for an existing Otakuria tab to focus instead of opening duplicates
      const tabs = await chrome.tabs.query({});
      const otakuriaTab = tabs.find(t => t.url && (t.url.includes('otakuria') || t.url.includes('localhost:3000')));
      
      if (otakuriaTab && otakuriaTab.id) {
        await chrome.tabs.update(otakuriaTab.id, { active: true });
        if (otakuriaTab.windowId) {
          await chrome.windows.update(otakuriaTab.windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url: 'https://otakuria.com' });
      }
    } catch {
      chrome.tabs.create({ url: 'https://otakuria.com' });
    }
  });

  btnTest.addEventListener('click', () => {
    statusBox.className = 'status-card info';
    statusBox.textContent = 'Verificando conector en segundo plano...';
    
    const startTime = performance.now();
    chrome.runtime.sendMessage({ action: 'PING' }, async (res) => {
      const elapsed = Math.round(performance.now() - startTime);

      if (chrome.runtime.lastError) {
        statusBox.className = 'status-card error';
        statusBox.textContent = '❌ Error de comunicación: ' + chrome.runtime.lastError.message;
        return;
      }

      if (res && res.success) {
        let extraInfo = '';
        try {
          const tabs = await chrome.tabs.query({});
          const sourceTabs = tabs.filter(t => t.url && t.url.startsWith('http'));
          extraInfo = ` • ${sourceTabs.length} pestaña(s) activas`;
        } catch {}

        statusBox.className = 'status-card success';
        statusBox.textContent = `✓ Conector M3 operativo (v${res.version}) • ${elapsed}ms${extraInfo}`;
      } else {
        statusBox.className = 'status-card error';
        statusBox.textContent = '⚠️ Sin respuesta válida del worker de la extensión.';
      }
    });
  });
});
