// Навбар: blur при скролле + мобильное меню + активная ссылка
(function () {
  const navbar = document.querySelector('.navbar');
  const burger = document.querySelector('.navbar-burger');
  const links  = document.querySelector('.navbar-links');

  // Подсветка текущей страницы
  if (links) {
    const path = window.location.pathname;
    links.querySelectorAll('a[href]').forEach(a => {
      const href = new URL(a.href).pathname;
      const isActive = href === path || (href === '/' && (path === '/' || path === '/index.html'));
      if (isActive) a.style.color = 'var(--accent)';
    });
  }

  // Blur при скролле
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.style.background = window.scrollY > 40
        ? 'rgba(6,10,16,.97)'
        : 'rgba(6,10,16,.85)';
    }, { passive: true });
  }

  // Гамбургер
  if (burger && links) {
    burger.addEventListener('click', () => {
      burger.classList.toggle('open');
      links.classList.toggle('open');
    });

    // Закрыть при клике на ссылку
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        burger.classList.remove('open');
        links.classList.remove('open');
      });
    });
  }
})();
