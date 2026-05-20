// CSP-safe fallback for images. Replaces inline onerror handlers.
(function () {
  function applyFallback(img) {
    if (!img || img.dataset.imageFallbackHandled === '1') return;
    img.dataset.imageFallbackHandled = '1';

    const action = img.dataset.imageFallback;
    if (action === 'remove') {
      img.remove();
      return;
    }

    img.classList.add('is-hidden');
    if (action === 'show-next') {
      const next = img.nextElementSibling;
      if (next) next.classList.add('is-flex');
      return;
    }

    if (action === 'show-target') {
      const targetId = img.dataset.imageFallbackTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) target.classList.add('is-flex');
    }
  }

  document.addEventListener('error', (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.dataset.imageFallback) {
      applyFallback(target);
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('img[data-image-fallback]').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) applyFallback(img);
    });
  });
})();
