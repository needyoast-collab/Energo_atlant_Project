const { pool } = require('../config/database');

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function currentDateOnly() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffDaysInclusive(start, end) {
  const [fromYear, fromMonth, fromDay] = String(start).slice(0, 10).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(end).slice(0, 10).split('-').map(Number);
  const from = new Date(fromYear, fromMonth - 1, fromDay);
  const to = new Date(toYear, toMonth - 1, toDay);
  return Math.max(1, Math.round((to - from) / 86400000) + 1);
}

async function getCalendarPlanPayload(projectId) {
  const project = await pool.query(
    `SELECT id, contract_signed_at, planned_start, planned_end
     FROM projects
     WHERE id = $1 AND is_deleted = FALSE`,
    [projectId]
  );
  if (!project.rows[0]) return null;

  const contractSignedAt = toDateOnly(project.rows[0].contract_signed_at);
  let plannedStart = contractSignedAt || toDateOnly(project.rows[0].planned_start);
  const plannedEnd = toDateOnly(project.rows[0].planned_end);

  const stages = await pool.query(
    `SELECT id, name, status, order_num, planned_start, planned_end, actual_end,
            is_from_vor, is_calendar_mobilization, unit, planned_value, actual_value,
            planned_date, actual_date, note, customer_agreed
     FROM project_stages
     WHERE project_id = $1
       AND is_deleted = FALSE
       AND (is_calendar_mobilization = TRUE OR is_from_vor = TRUE)
     ORDER BY CASE WHEN is_calendar_mobilization = TRUE THEN 0 ELSE 1 END, order_num, created_at`,
    [projectId]
  );

  if (!plannedStart) {
    const firstPlannedStage = stages.rows
      .map((stage) => toDateOnly(stage.planned_start))
      .filter(Boolean)
      .sort()[0];

    if (firstPlannedStage) {
      plannedStart = firstPlannedStage;
      if (!contractSignedAt) {
        await pool.query(
          `UPDATE projects
           SET planned_start = $2
           WHERE id = $1 AND planned_start IS NULL AND is_deleted = FALSE`,
          [projectId, plannedStart]
        );
      }
    }
  }

  const calendarStart = plannedStart || currentDateOnly();
  const durationDays = plannedStart && plannedEnd ? diffDaysInclusive(plannedStart, plannedEnd) : 45;

  const items = stages.rows.map((stage) => ({
    ...stage,
    planned_start: toDateOnly(stage.planned_start),
    planned_end: toDateOnly(stage.planned_end),
    actual_end: toDateOnly(stage.actual_end),
    planned_date: toDateOnly(stage.planned_date),
    actual_date: toDateOnly(stage.actual_date),
  }));

  return {
    calendar_start: calendarStart,
    duration_days: durationDays,
    items,
  };
}

module.exports = {
  getCalendarPlanPayload,
  toDateOnly,
};
