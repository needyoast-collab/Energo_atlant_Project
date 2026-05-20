window.CustomerStatus = (() => {
  const PROJECT_LABELS = {
    lead: 'Заявка получена',
    qualification: 'Уточняем задачу',
    visit: 'Выезд назначен',
    offer: 'КП на согласовании',
    negotiation: 'Согласуем условия',
    contract: 'Договор подписан',
    work: 'Работы идут',
    won: 'Объект завершён',
    lost: 'Работы отменены',
  };

  const PROJECT_BADGE_CLASSES = {
    lead: 'badge-gray',
    qualification: 'badge-blue',
    visit: 'badge-blue',
    offer: 'badge-yellow',
    negotiation: 'badge-yellow',
    contract: 'badge-blue',
    work: 'badge-green',
    won: 'badge-gray',
    lost: 'badge-red',
  };

  const STAGE_KIND_LABELS = {
    planned: 'Запланирован',
    progress: 'В работе',
    done: 'Выполнен',
    attention: 'Нужно согласование',
    accepted: 'Пояснение принято',
    overdue: 'Срок нарушен',
    delayed: 'Выполнен позже срока',
  };

  const STAGE_BADGE_CLASSES = {
    planned: 'badge-gray',
    progress: 'badge-yellow',
    done: 'badge-green',
    attention: 'badge-red',
    accepted: 'badge-gray',
    overdue: 'badge-red',
    delayed: 'badge-red',
  };

  const STAGE_PANEL_CLASSES = {
    planned: 'is-planned',
    progress: 'is-progress',
    done: 'is-done',
    attention: 'is-danger',
    accepted: 'is-planned',
    overdue: 'is-danger',
    delayed: 'is-danger',
  };

  const STAGE_DOT_CLASSES = {
    planned: 'dot-pending',
    progress: 'dot-in_progress',
    done: 'dot-done',
    attention: 'dot-not_done',
    accepted: 'dot-pending',
    overdue: 'dot-not_done',
    delayed: 'dot-not_done',
  };

  function getProjectLabel(status) {
    return PROJECT_LABELS[status] || 'Статус уточняется';
  }

  function getProjectBadgeClass(status) {
    return PROJECT_BADGE_CLASSES[status] || 'badge-gray';
  }

  function toDateOnly(value) {
    if (!value) return null;
    return String(value).slice(0, 10);
  }

  function todayDateOnly() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getStagePlannedEnd(stage) {
    return toDateOnly(stage?.planned_end || stage?.planned_date);
  }

  function getStageActualEnd(stage) {
    return toDateOnly(stage?.actual_end || stage?.actual_date);
  }

  function isStageDelayed(stage) {
    const plannedEnd = getStagePlannedEnd(stage);
    const actualEnd = getStageActualEnd(stage);
    return Boolean(plannedEnd && actualEnd && actualEnd > plannedEnd);
  }

  function isStageActiveOverdue(stage) {
    const plannedEnd = getStagePlannedEnd(stage);
    if (!plannedEnd || stage?.status === 'done') return false;
    return plannedEnd < todayDateOnly();
  }

  function getStageKind(stage) {
    if (stage?.status === 'not_done' && !stage.customer_agreed) return 'attention';
    if (stage?.status === 'not_done') return 'accepted';
    if (isStageDelayed(stage)) return 'delayed';
    if (isStageActiveOverdue(stage)) return 'overdue';
    if (stage?.status === 'done') return 'done';
    if (stage?.status === 'in_progress') return 'progress';
    return 'planned';
  }

  function getStageLabel(stage) {
    return STAGE_KIND_LABELS[getStageKind(stage)] || 'Статус уточняется';
  }

  function getStageBadgeClass(stage) {
    return STAGE_BADGE_CLASSES[getStageKind(stage)] || 'badge-gray';
  }

  function getStagePanelClass(stage) {
    return STAGE_PANEL_CLASSES[getStageKind(stage)] || 'is-planned';
  }

  function getStageDotClass(stage) {
    return STAGE_DOT_CLASSES[getStageKind(stage)] || 'dot-pending';
  }

  return {
    getProjectLabel,
    getProjectBadgeClass,
    getStageActualEnd,
    getStageKind,
    getStageLabel,
    getStageBadgeClass,
    getStagePanelClass,
    getStageDotClass,
    isStageActiveOverdue,
    isStageDelayed,
  };
})();
