if (window.AOS) {
  AOS.init({ once: true, offset: 60 });
}

document.querySelectorAll('.service-nav-card[data-target]').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.service-nav-card').forEach((item) => item.classList.remove('active'));
    card.classList.add('active');
    const target = document.getElementById(card.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Обработка формы — вынесена в /js/request_form.js (переиспользуется на страницах услуг)
