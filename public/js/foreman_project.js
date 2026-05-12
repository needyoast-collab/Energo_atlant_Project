window.FOREMAN_PAGE_MODE = 'project';

window.initForemanModeNavigation = () => {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) return;
      window.location.href = '/dashboard_foreman.html';
    });
  });
};

window.initForemanAfterProjects = async ({ openProject }) => {
  const projectId = new URLSearchParams(window.location.search).get('id');
  if (projectId) await openProject(projectId);
};

window.initForeman?.('project');
