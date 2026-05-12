(() => {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;

  const isDashboard = document.body?.classList.contains('dashboard-page')
    || /^\/dashboard_/.test(window.location.pathname);
  let isHidden = false;

  function hidePreloader() {
    if (isHidden) return;
    isHidden = true;
    preloader.classList.add('hidden');
    window.setTimeout(() => {
      preloader.style.display = 'none';
    }, 180);
  }

  window.hidePreloader = hidePreloader;

  if (!isDashboard) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hidePreloader, { once: true });
    } else {
      window.requestAnimationFrame(hidePreloader);
    }
  }

  // Fallback нужен, чтобы пользователь не завис на прелоадере при ошибке API.
  window.setTimeout(hidePreloader, isDashboard ? 8000 : 2500);
})();
