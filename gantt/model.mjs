export const DAY = 86400000;
export const STORAGE_KEY = 'fh-hgugm-gantt-v1';
export const VIEW_KEY = 'fh-hgugm-gantt-view-v1';
export const PHASES = {
  construccion: { label: 'Construcción / POC', color: '#aaa38f' },
  piloto: { label: 'Piloto / sombra / medición', color: '#b07d10' },
  produccion: { label: 'Producción', color: '#1d6b3f' },
  critica: { label: 'Ventana crítica', color: '#8f1117' },
  entrega: { label: 'Entrega / publicación', color: '#3a372f' },
};
export const STATUSES = {
  planificado: 'Planificado', curso: 'En curso', completado: 'Completado', bloqueado: 'Bloqueado',
};
export const clone = value => JSON.parse(JSON.stringify(value));

// Civil dates are calculated in UTC: dragging across a daylight-saving change is still one day.
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Fecha no válida.');
  const [y, m, d] = value.split('-').map(Number);
  const result = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(result) || iso(result) !== value || y < 1900 || y > 2200) throw new Error('Fecha no válida.');
  return result / DAY;
}
export const iso = milliseconds => new Date(milliseconds).toISOString().slice(0, 10);
export const dateFromDay = value => iso(Math.round(value) * DAY);
export const addDays = (value, delta) => dateFromDay(day(value) + delta);
export const duration = task => day(task.end) - day(task.start) + 1;
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
export const childrenOf = (tasks, id) => tasks.filter(t => t.parentId === id);

export function descendants(tasks, id) {
  const result = [];
  const visit = parent => childrenOf(tasks, parent).forEach(child => { result.push(child); visit(child.id); });
  visit(id);
  return result;
}

export function summarize(task, tasks) {
  const children = childrenOf(tasks, task.id);
  if (!children.length) return { ...task };
  const parts = children.map(child => summarize(child, tasks));
  const total = parts.reduce((sum, part) => sum + duration(part), 0);
  const progress = Math.round(parts.reduce((sum, part) => sum + part.progress * duration(part), 0) / total);
  return {
    ...task,
    start: parts.reduce((value, part) => part.start < value ? part.start : value, parts[0].start),
    end: parts.reduce((value, part) => part.end > value ? part.end : value, parts[0].end),
    progress,
    status: parts.every(p => p.status === 'completado') ? 'completado'
      : parts.some(p => p.status === 'bloqueado') ? 'bloqueado'
        : parts.some(p => p.status === 'curso' || p.progress > 0) ? 'curso' : 'planificado',
  };
}

export function ownersOf(task, tasks) {
  if (task.owners.length || !task.parentId) return task.owners;
  const parent = tasks.find(t => t.id === task.parentId);
  return parent ? ownersOf(parent, tasks) : [];
}

export function hasCycle(tasks, edge) {
  const map = new Map(tasks.map(t => [t.id, t]));
  const visiting = new Set(), done = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    for (const next of edge(map.get(id))) if (map.has(next) && visit(next)) return true;
    visiting.delete(id); done.add(id); return false;
  };
  return tasks.some(t => visit(t.id));
}

export function validateProject(input) {
  if (!input || input.schemaVersion !== 1 || input.projectId !== 'fh-hgugm-2026-2028' || !Array.isArray(input.tasks)) {
    throw new Error('Este archivo no es una copia del gestor Gantt de Farmacia HGUGM.');
  }
  if (input.tasks.length > 1500) throw new Error('La copia supera el límite de 1.500 elementos.');
  const ids = new Set();
  const tasks = input.tasks.map(t => {
    if (!t || typeof t.id !== 'string' || !/^[\w-]{1,96}$/.test(t.id) || ids.has(t.id)) throw new Error('Hay identificadores duplicados o no válidos.');
    ids.add(t.id);
    if (!['task', 'group', 'milestone'].includes(t.type)) throw new Error('Hay un tipo de elemento no válido.');
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 300) throw new Error('Cada elemento debe tener un título de hasta 300 caracteres.');
    day(t.start); day(t.end);
    if (t.start > t.end || (t.type === 'milestone' && t.start !== t.end)) throw new Error('Revise las fechas: el fin no puede preceder al inicio y los hitos duran un día.');
    if (!Object.hasOwn(PHASES, t.phase) || !Object.hasOwn(STATUSES, t.status)) throw new Error('Fase o estado no válidos.');
    if (!Number.isFinite(t.progress) || t.progress < 0 || t.progress > 100) throw new Error('El progreso debe estar entre 0 y 100.');
    if (!Array.isArray(t.owners) || t.owners.length > 50 || t.owners.some(o => typeof o !== 'string' || o.length > 120)) throw new Error('Lista de responsables no válida.');
    if (!Array.isArray(t.dependencies) || t.dependencies.some(d => typeof d !== 'string')) throw new Error('Lista de dependencias no válida.');
    if (t.notes != null && (typeof t.notes !== 'string' || t.notes.length > 20000)) throw new Error('Las notas superan los 20.000 caracteres.');
    return {
      id: t.id, type: t.type, title: t.title.trim(), parentId: t.parentId || null,
      start: t.start, end: t.end, phase: t.phase,
      owners: [...new Set(t.owners.map(o => o.trim()).filter(Boolean))],
      status: t.status, progress: Math.round(t.progress),
      dependencies: [...new Set(t.dependencies)], notes: t.notes || '',
    };
  });
  const map = new Map(tasks.map(t => [t.id, t]));
  for (const t of tasks) {
    if (t.parentId && (t.parentId === t.id || !map.has(t.parentId) || map.get(t.parentId).type !== 'group')) throw new Error('Un proyecto padre no es válido.');
    if (t.dependencies.some(id => !map.has(id) || id === t.id || map.get(id).type === 'group')) throw new Error('Una dependencia no es válida.');
    if (t.type === 'group' && t.dependencies.length) throw new Error('Las dependencias se asignan a tareas e hitos.');
  }
  if (hasCycle(tasks, t => t.parentId ? [t.parentId] : [])) throw new Error('Un proyecto no puede contenerse a sí mismo.');
  if (hasCycle(tasks, t => t.dependencies)) throw new Error('Las dependencias forman un círculo. Revise la secuencia.');
  return {
    schemaVersion: 1, projectId: 'fh-hgugm-2026-2028',
    name: typeof input.name === 'string' ? input.name.slice(0, 200) : 'Plan IA · Farmacia HGUGM',
    sourceRevision: typeof input.sourceRevision === 'string' ? input.sourceRevision : 'f9be595',
    savedAt: typeof input.savedAt === 'string' ? input.savedAt : null, tasks,
  };
}

export function moveItem(project, id, delta, edge = 'move') {
  if (!Number.isInteger(delta)) throw new Error('El desplazamiento debe ser un número entero de días.');
  if (!['move', 'start', 'end'].includes(edge)) throw new Error('Operación de fechas no válida.');
  const next = clone(project), item = next.tasks.find(t => t.id === id);
  if (!item) throw new Error('No se encuentra el elemento.');
  const selected = edge === 'move' ? [item, ...descendants(next.tasks, id)] : [item];
  if (edge !== 'move' && childrenOf(next.tasks, id).length) throw new Error('Edite la duración de cada fase del proyecto.');
  for (const task of selected) {
    if (edge === 'move' || task.type === 'milestone') {
      task.start = addDays(task.start, delta); task.end = addDays(task.end, delta);
    } else if (edge === 'start') task.start = addDays(task.start, Math.min(delta, duration(task) - 1));
    else if (edge === 'end') task.end = addDays(task.end, Math.max(delta, 1 - duration(task)));
  }
  return validateProject(next);
}

export function removeItem(project, id) {
  const next = clone(project), remove = new Set([id, ...descendants(next.tasks, id).map(t => t.id)]);
  next.tasks = next.tasks.filter(t => !remove.has(t.id)).map(t => ({ ...t, dependencies: t.dependencies.filter(d => !remove.has(d)) }));
  return next;
}

export function conflicts(tasks) {
  const map = new Map(tasks.map(t => [t.id, summarize(t, tasks)]));
  return tasks.flatMap(t => t.dependencies.filter(id => map.get(id).end >= t.start).map(id => ({ taskId: t.id, predecessorId: id })));
}

export function visibleRows(tasks, expanded, filters = {}) {
  const normalize = value => value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const matches = task => {
    const summary = summarize(task, tasks), owners = ownersOf(task, tasks);
    const text = normalize([task.title, task.notes, ...owners].join(' '));
    return (!filters.query || text.includes(normalize(filters.query)))
      && (!filters.owner || owners.includes(filters.owner))
      && (!filters.status || summary.status === filters.status);
  };
  const filtering = Boolean(filters.query || filters.owner || filters.status);
  const included = new Set();
  if (filtering) for (const task of tasks.filter(matches)) {
    let current = task;
    while (current) { included.add(current.id); current = tasks.find(t => t.id === current.parentId); }
  }
  const result = [];
  const visit = (parentId, depth) => {
    for (const task of tasks.filter(t => t.parentId === parentId)) {
      if (filtering && !included.has(task.id)) continue;
      result.push({ task, summary: summarize(task, tasks), depth, hasChildren: childrenOf(tasks, task.id).length > 0 });
      if (filtering || expanded.has(task.id)) visit(task.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export function toCSV(project) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const names = new Map(project.tasks.map(t => [t.id, t.title]));
  const rows = [['Tipo', 'Título', 'Proyecto', 'Inicio', 'Fin', 'Responsables', 'Estado', 'Progreso (%)', 'Dependencias', 'Notas']];
  for (const task of project.tasks) {
    const s = summarize(task, project.tasks);
    rows.push([task.type === 'group' ? 'Proyecto' : task.type === 'milestone' ? 'Hito' : 'Tarea', task.title,
      names.get(task.parentId) || '', s.start, s.end, ownersOf(task, project.tasks).join(', '),
      STATUSES[s.status], s.progress, task.dependencies.map(id => names.get(id)).join(' | '), task.notes]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
