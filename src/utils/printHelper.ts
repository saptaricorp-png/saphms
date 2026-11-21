export interface SmartPrintOptions {
  element: HTMLElement | null;
  pageCssSize?: string;
  documentTitle?: string;
  onFallbackPrint?: () => void;
}

function collectPrintStylesHtml(): string {
  const parts: string[] = [];
  if (typeof document === 'undefined') return '';

  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    if (node.id === 'dynamic-print-page-style') return;
    if (node.tagName === 'LINK') {
      const href = (node as HTMLLinkElement).href;
      if (href) {
        parts.push(`<link rel="stylesheet" href="${href}" />`);
        return;
      }
    }
    parts.push(node.outerHTML);
  });

  // Inline all accessible CSSStyleSheet rules (crucial for Tailwind v4 / Vite dev styles inside standalone print tabs)
  const cssRulesBuffer: string[] = [];
  try {
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      if ((sheet.ownerNode as HTMLElement | null)?.id === 'dynamic-print-page-style') continue;
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        for (let j = 0; j < rules.length; j++) {
          cssRulesBuffer.push(rules[j].cssText);
        }
      } catch {
        // Cross-origin stylesheet cannot inspect cssRules; preserved via <link> above
      }
    }
  } catch {
    // Ignore stylesheet inspection failures
  }

  if (cssRulesBuffer.length > 0) {
    parts.push(`<style data-extracted-print-css="true">\n${cssRulesBuffer.join('\n')}\n</style>`);
  }

  return parts.join('\n');
}

function cloneWithCanvases(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const srcCanvases = source.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((srcCanvas, idx) => {
    const dstCanvas = dstCanvases[idx];
    if (!dstCanvas) return;
    try {
      const dataUrl = srcCanvas.toDataURL('image/png');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.width = `${srcCanvas.width || 120}px`;
      img.style.height = `${srcCanvas.height || 120}px`;
      img.className = dstCanvas.className;
      dstCanvas.replaceWith(img);
    } catch {
      try {
        dstCanvas.width = srcCanvas.width;
        dstCanvas.height = srcCanvas.height;
        const ctx = dstCanvas.getContext('2d');
        if (ctx) ctx.drawImage(srcCanvas, 0, 0);
      } catch {
        // ignore
      }
    }
  });
  return clone;
}

function buildStandalonePrintableHtml(
  element: HTMLElement,
  pageCssSize: string,
  documentTitle: string,
  autoInvokePrint: boolean
): string {
  const stylesHtml = collectPrintStylesHtml();
  const cloned = cloneWithCanvases(element);
  cloned.style.boxShadow = 'none';
  cloned.style.margin = '0 auto';
  const safeTitle = (documentTitle || 'Saptari Hospital Document').replace(/[<>]/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
${stylesHtml}
<style>
  @page { size: ${pageCssSize}; margin: 0 !important; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .print-toolbar-standalone {
    position: sticky;
    top: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 18px;
    background: #0f172a;
    color: #ffffff;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
  }
  .print-toolbar-standalone button {
    background: #2563eb;
    color: #ffffff;
    border: 0;
    border-radius: 8px;
    padding: 8px 16px;
    font-weight: 600;
    cursor: pointer;
  }
  @media print {
    .print-toolbar-standalone { display: none !important; }
    .no-print { display: none !important; }
    html, body { background: #ffffff !important; }
  }
</style>
</head>
<body>
  <div class="print-toolbar-standalone">
    <span><strong>${safeTitle}</strong> — System Print Ready (${pageCssSize})</span>
    <button type="button" onclick="window.focus(); window.print();">Print Now (Ctrl+P)</button>
  </div>
  <div style="padding: 8px 0;">${cloned.outerHTML}</div>
  ${
    autoInvokePrint
      ? `<script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        try { window.focus(); window.print(); } catch (e) {}
      }, 220);
    });
  </script>`
      : ''
  }
</body>
</html>`;
}

function openStandalonePrintTab(
  element: HTMLElement,
  pageCssSize: string,
  documentTitle: string
): string | null {
  try {
    const html = buildStandalonePrintableHtml(element, pageCssSize, documentTitle, true);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    // Click a temporary <a target="_blank"> anchor cleanly during user gesture (no window.open)
    const link = document.createElement('a');
    link.href = blobUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // ignore
      }
    }, 120000);

    return blobUrl;
  } catch {
    return null;
  }
}

function printViaHiddenIframe(
  element: HTMLElement,
  pageCssSize: string,
  documentTitle: string,
  onBlocked?: () => void
): boolean {
  try {
    const existing = document.getElementById('hms-hidden-print-frame');
    if (existing) existing.remove();

    const iframe = document.createElement('iframe');
    iframe.id = 'hms-hidden-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0.01';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    const win = iframe.contentWindow;
    if (!doc || !win) return false;

    const html = buildStandalonePrintableHtml(element, pageCssSize, documentTitle, false);
    doc.open();
    doc.write(html);
    doc.close();

    let printed = false;
    const triggerIframePrint = () => {
      if (printed) return;
      printed = true;
      let iframeBeforePrint = false;
      const onBefore = () => {
        iframeBeforePrint = true;
      };
      win.addEventListener('beforeprint', onBefore, { once: true });
      const t0 = performance.now();
      try {
        win.focus();
        win.print();
        if (!iframeBeforePrint) {
          try {
            (doc as any).execCommand?.('print', false, null);
          } catch {
            // ignore
          }
        }
      } catch {
        onBlocked?.();
      }
      const elapsed = performance.now() - t0;
      if (!iframeBeforePrint && elapsed < 100) {
        window.setTimeout(() => {
          if (!iframeBeforePrint) {
            onBlocked?.();
          }
        }, 120);
      }
      window.setTimeout(() => {
        iframe.remove();
      }, 60000);
    };

    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    if (links.length === 0) {
      triggerIframePrint();
    } else {
      let pending = links.length;
      const done = () => {
        pending -= 1;
        if (pending <= 0) triggerIframePrint();
      };
      links.forEach((lnk) => {
        lnk.addEventListener('load', done, { once: true });
        lnk.addEventListener('error', done, { once: true });
      });
      window.setTimeout(triggerIframePrint, 350);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reliable multi-tier browser system print helper:
 * 1. Populates #print-portal & attempts synchronous window.print()
 * 2. Detects silent iframe/sandbox print suppression (!beforeprint & <100ms return)
 * 3. Falls back automatically to clean hidden-iframe CSS print or a standalone printable tab (<a target="_blank">)
 */
export function executeSmartPrint({
  element,
  pageCssSize = 'A5 portrait',
  documentTitle = '',
  onFallbackPrint,
}: SmartPrintOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  let styleEl = document.getElementById('dynamic-print-page-style') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-print-page-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { size: ${pageCssSize}; margin: 0 !important; } }`;

  let portalRoot = document.getElementById('print-portal');
  if (!portalRoot) {
    portalRoot = document.createElement('div');
    portalRoot.id = 'print-portal';
    document.body.appendChild(portalRoot);
  }

  portalRoot.replaceChildren();
  if (element) {
    const clone = cloneWithCanvases(element);
    clone.style.boxShadow = 'none';
    clone.style.margin = '0 auto';
    portalRoot.appendChild(clone);
  }

  void portalRoot.offsetHeight;

  const prevTitle = document.title;
  document.title = '\u200B';
  if (documentTitle) {
    portalRoot.setAttribute('data-print-doc', documentTitle);
  }

  const restoreTitle = () => {
    document.title = prevTitle;
  };
  window.addEventListener('afterprint', restoreTitle, { once: true });

  let beforePrintFired = false;
  const markBeforePrint = () => {
    beforePrintFired = true;
  };
  window.addEventListener('beforeprint', markBeforePrint, { once: true });

  const invokeFallbackChain = () => {
    restoreTitle();
    if (!element) {
      onFallbackPrint?.();
      return;
    }
    const isEmbeddedFrame = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    if (isEmbeddedFrame) {
      const url = openStandalonePrintTab(element, pageCssSize, documentTitle);
      if (url) {
        window.dispatchEvent(
          new CustomEvent('hms-print-fallback', {
            detail: { url, documentTitle, pageCssSize },
          })
        );
        return;
      }
    }

    const startedIframe = printViaHiddenIframe(element, pageCssSize, documentTitle, () => {
      const url = openStandalonePrintTab(element, pageCssSize, documentTitle);
      if (url) {
        window.dispatchEvent(
          new CustomEvent('hms-print-fallback', {
            detail: { url, documentTitle, pageCssSize },
          })
        );
      } else {
        onFallbackPrint?.();
      }
    });

    if (!startedIframe) {
      onFallbackPrint?.();
    }
  };

  const t0 = performance.now();
  try {
    window.focus();
    window.print();
    const elapsed = performance.now() - t0;

    if (!beforePrintFired && elapsed < 100) {
      try {
        const execOk = (document as any).execCommand?.('print', false, null);
        if (execOk) beforePrintFired = true;
      } catch {
        // ignore
      }
    }

    if (!beforePrintFired && elapsed < 100) {
      window.setTimeout(() => {
        if (!beforePrintFired) {
          invokeFallbackChain();
        }
      }, 120);
    }
  } catch {
    invokeFallbackChain();
  }
}
