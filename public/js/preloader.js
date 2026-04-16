window.addEventListener('load', () => {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;
  preloader.classList.add('hidden');
  setTimeout(() => { preloader.style.display = 'none'; }, 400);
});
