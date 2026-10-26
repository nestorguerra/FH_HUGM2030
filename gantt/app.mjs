import {
  DAY, STORAGE_KEY, VIEW_KEY, PHASES, STATUSES, clone, day, dateFromDay, addDays, today,
  duration, childrenOf, descendants, summarize, ownersOf, validateProject, moveItem,
  removeItem, conflicts, visibleRows, toCSV,
} from './model.mjs?v=gantt-1';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const format = value => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day(value) * DAY));
const viewport = $('timelineViewport');
const ROW_HEIGHT = 48, AXIS_HEIGHT = 54;
let project, undoStack = [], redoStack = [], expanded = new Set(), rows = [];
let pxDay = .9, rangeStart, rangeEnd, timelineWidth = 1000, editingId = null, selectedId = null;
let drag = null, pan = null, animation = 0, uiTimer, toastTimer;
let rawRecovery = null, incomingProject = null, writeBlocked = false, restoringView = false;
const labelWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--label-w'));
const contentWidth = () => Math.max(80, viewport.clientWidth - labelWidth());
const allOwners = () => [...new Set(project.tasks.flatMap(t => t.owners))].sort((a, b) => a.localeCompare(b, 'es'));

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function save() {
  if (incomingProject) {
    $('saveStatus').textContent = 'Cambios pendientes · resuelva el aviso de la otra pestaña';
    $('saveStatus').style.color = '#8f1117'; return;
  }
  if (writeBlocked) {
    $('saveStatus').textContent = 'Cambios sin guardar · descargue una copia';
    $('saveStatus').style.color = '#8f1117'; return;
  }
  project.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    $('saveStatus').textContent = 'Guardado en este navegador · ' + new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date());
    $('saveStatus').style.color = '#1d6b3f';
  } catch {
    $('saveStatus').textContent = 'No se ha podido guardar · descargue una copia';
    $('saveStatus').style.color = '#8f1117';
    toast('El navegador no permite guardar más datos. Descargue una copia JSON para conservar los cambios.');
  }
}
function storeView() {
  if (restoringView || !project) return;
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ pxDay, expanded: [...expanded], left: viewport.scrollLeft, top: viewport.scrollTop })); } catch { /* Data export remains available. */ }
  }, 120);
}
function anchor() {
  return { center: rangeStart + (viewport.scrollLeft + contentWidth() / 2) / pxDay, top: viewport.scrollTop };
}
function filterValues() {
  return { query: $('searchInput').value.trim(), owner: $('ownerFilter').value, status: $('statusFilter').value };
}
function updateOwners() {
  const selected = $('ownerFilter').value;
  $('ownerFilter').innerHTML = '<option value="">Todos los responsables</option>' + allOwners().map(owner => `<option>${escape(owner)}</option>`).join('');
  if (allOwners().includes(selected)) $('ownerFilter').value = selected;
}
function commit(next, message, { select = selectedId } = {}) {
  next = validateProject(next);
  undoStack.push(clone(project)); if (undoStack.length > 50) undoStack.shift(); redoStack = [];
  const position = anchor(); project = next; selectedId = select; save(); render(position);
  if (message) toast(message);
}
function undo() {
  if (!undoStack.length || $('editorDialog').open) return;
  const position = anchor(); redoStack.push(clone(project)); project = undoStack.pop(); save(); render(position); toast('Cambio deshecho.');
}
function redo() {
  if (!redoStack.length || $('editorDialog').open) return;
  const position = anchor(); undoStack.push(clone(project)); project = redoStack.pop(); save(); render(position); toast('Cambio rehecho.');
}

function render(position, fit = false) {
  const summaries = project.tasks.map(t => summarize(t, project.tasks));
  const first = summaries.length ? Math.min(...summaries.map(t => day(t.start))) : day(today()) - 90;
  const last = summaries.length ? Math.max(...summaries.map(t => day(t.end))) : day(today()) + 180;
  rangeStart = Math.floor(first - 14); rangeEnd = Math.ceil(last + 14);
  if (fit) pxDay = Math.max(.12, Math.min(80, contentWidth() / (rangeEnd - rangeStart + 1)));
  timelineWidth = Math.ceil((rangeEnd - rangeStart + 1) * pxDay);
  $('surface').style.width = `${labelWidth() + timelineWidth}px`;
  updateOwners(); rows = visibleRows(project.tasks, expanded, filterValues());
  const conflictList = conflicts(project.tasks), problemIds = new Set(conflictList.map(c => c.taskId));
  $('rows').innerHTML = rows.map(({ task, summary, depth, hasChildren }) => {
    const owners = ownersOf(task, project.tasks), x = (day(summary.start) - rangeStart) * pxDay;
    const width = task.type === 'milestone' ? 16 : Math.max(7, duration(summary) * pxDay);
    const childCount = descendants(project.tasks, task.id).length;
    const toggle = hasChildren ? `<button class="toggle-row" data-toggle="${task.id}" aria-expanded="${expanded.has(task.id) || Boolean(Object.values(filterValues()).some(Boolean))}" aria-label="${expanded.has(task.id) ? 'Contraer' : 'Desplegar'} ${escape(task.title)}">${expanded.has(task.id) || Object.values(filterValues()).some(Boolean) ? '−' : '＋'}</button>` : '<span class="toggle-placeholder"></span>';
    const subtitle = (owners.length ? owners.join(', ') : 'Sin asignar') + ` · ${summary.progress}%` + (hasChildren ? ` · ${childCount} fases` : ` · ${STATUSES[summary.status]}`);
    const description = `${task.title}. ${format(summary.start)} a ${format(summary.end)}. ${summary.progress}% completado. ${owners.length ? owners.join(', ') : 'Sin responsables asignados'}. Pulse para editar.`;
    const classes = ['bar', hasChildren ? 'summary' : '', task.type === 'milestone' ? 'milestone' : '', summary.status === 'bloqueado' ? 'blocked' : '', problemIds.has(task.id) ? 'conflict' : ''].filter(Boolean).join(' ');
    return `<div class="gantt-row ${task.type === 'group' ? 'group' : ''} ${task.id === selectedId ? 'selected' : ''}" data-row="${task.id}">
      <div class="row-label" style="padding-left:${8 + depth * 13}px">${toggle}<button class="row-name" data-edit="${task.id}" title="${escape(description)}"><strong>${escape(task.title)}</strong><small>${escape(subtitle)}</small></button></div>
      <div class="row-track" data-track="${task.id}"><button type="button" class="${classes}" data-bar="${task.id}" style="left:${x}px;width:${width}px;--bar-color:${PHASES[task.phase].color}" aria-label="${escape(description)}" title="${escape(description)}">
      ${task.type !== 'milestone' ? `<span class="bar-fill" style="width:${summary.progress}%"></span><span class="bar-text">${width > 95 ? escape(task.title) + (width > 180 ? ' · ' + summary.progress + '%' : '') : ''}</span>` : ''}
      ${!hasChildren && task.type !== 'milestone' ? '<span class="resize-handle start" data-edge="start" title="Cambiar fecha de inicio"></span><span class="resize-handle end" data-edge="end" title="Cambiar fecha de fin"></span>' : ''}</button></div></div>`;
  }).join('');
  $('emptyState').hidden = rows.length > 0;
  $('rowCount').textContent = `${project.tasks.filter(t => t.type === 'group').length} iniciativas · ${project.tasks.filter(t => t.type !== 'group').length} tareas e hitos · ${rows.length} filas visibles`;
  $('conflictButton').hidden = !conflictList.length;
  $('conflictButton').textContent = `${conflictList.length} ${conflictList.length === 1 ? 'dependencia a revisar' : 'dependencias a revisar'}`;
  $('undoButton').disabled = !undoStack.length; $('redoButton').disabled = !redoStack.length;
  $('scaleSelect').value = String(pxDay >= 18 ? 32 : pxDay >= 5 ? 9 : pxDay >= 1.2 ? 2.8 : .9);
  $('zoomOut').disabled = pxDay <= .12; $('zoomIn').disabled = pxDay >= 80;
  const todayX = (day(today()) - rangeStart) * pxDay + labelWidth();
  $('todayLine').style.left = `${todayX}px`; $('todayLine').hidden = todayX < labelWidth() || todayX > labelWidth() + timelineWidth;
  drawDependencies(conflictList);
  if (position) {
    viewport.scrollLeft = (position.center - rangeStart) * pxDay - contentWidth() / 2;
    viewport.scrollTop = position.top;
  }
  renderAxis(); storeView();
}

function renderAxis() {
  if (!project || !Number.isFinite(rangeStart)) return;
  const first = Math.max(rangeStart, Math.floor(rangeStart + viewport.scrollLeft / pxDay) - 45);
  const last = Math.min(rangeEnd, Math.ceil(first + (viewport.clientWidth + 250) / pxDay) + 90);
  const blocks = [], grid = [];
  const add = (start, end, label, level) => {
    const left = (start - rangeStart) * pxDay, width = (end - start) * pxDay;
    blocks.push(`<div class="axis-period ${level}" style="left:${left}px;width:${width}px">${width > 23 ? escape(label) : ''}</div>`);
    if (level === 'minor' && left >= 0) grid.push(`<line x1="${left + labelWidth()}" y1="0" x2="${left + labelWidth()}" y2="${rows.length * ROW_HEIGHT}" stroke="#ddd7c8" stroke-width="1"/>`);
  };
  const begin = new Date(first * DAY), end = new Date(last * DAY);
  const months = (year, month) => Date.UTC(year, month, 1) / DAY;
  if (pxDay >= 5) {
    for (let y = begin.getUTCFullYear(); y <= end.getUTCFullYear(); y++) for (let m = 0; m < 12; m++) {
      const a = months(y, m), b = months(y, m + 1); if (b < first || a > last) continue;
      add(a, b, new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(a * DAY)), 'major');
    }
    if (pxDay >= 18) for (let d = first; d <= last; d++) add(d, d + 1, new Date(d * DAY).getUTCDate(), 'minor');
    else {
      let d = first - (new Date(first * DAY).getUTCDay() + 6) % 7;
      for (; d <= last; d += 7) add(d, d + 7, new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d * DAY)), 'minor');
    }
  } else {
    for (let y = begin.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
      add(months(y, 0), months(y + 1, 0), y, 'major');
      if (pxDay >= 1.2) for (let m = 0; m < 12; m++) {
        const a = months(y, m), b = months(y, m + 1); if (b < first || a > last) continue;
        add(a, b, new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' }).format(new Date(a * DAY)), 'minor');
      } else for (let q = 0; q < 4; q++) {
        const a = months(y, q * 3), b = months(y, q * 3 + 3); if (b < first || a > last) continue;
        add(a, b, 'T' + (q + 1), 'minor');
      }
    }
  }
  const todayOffset = (day(today()) - rangeStart) * pxDay;
  if (todayOffset >= 0 && todayOffset <= timelineWidth) blocks.push(`<span class="axis-today" style="left:${todayOffset}px">HOY</span>`);
  $('timeAxis').innerHTML = blocks.join('');
  const layer = $('calendarGrid'); if (layer) layer.innerHTML = grid.join('');
}

function drawDependencies(problemList) {
  const svg = $('dependenciesSvg'), index = new Map(rows.map((r, i) => [r.task.id, i]));
  const map = new Map(rows.map(r => [r.task.id, r.summary]));
  const problems = new Set(problemList.map(c => c.taskId + ':' + c.predecessorId));
  const paths = [];
  for (const { task, summary } of rows) for (const predecessor of task.dependencies) {
    if (!index.has(predecessor)) continue;
    const p = map.get(predecessor), x1 = labelWidth() + (day(p.end) - rangeStart + 1) * pxDay + 3;
    const x2 = labelWidth() + (day(summary.start) - rangeStart) * pxDay - 3;
    const y1 = index.get(predecessor) * ROW_HEIGHT + ROW_HEIGHT / 2, y2 = index.get(task.id) * ROW_HEIGHT + ROW_HEIGHT / 2;
    const bend = Math.max(15, Math.min(40, Math.abs(x2 - x1) / 2));
    const bad = problems.has(task.id + ':' + predecessor);
    paths.push(`<path class="dependency-path ${bad ? 'conflict' : ''}" marker-end="url(#dependencyArrow)" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}"/>`);
  }
  svg.setAttribute('width', labelWidth() + timelineWidth); svg.setAttribute('height', rows.length * ROW_HEIGHT);
  svg.innerHTML = '<defs><marker id="dependencyArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#8a8579"/></marker></defs><g id="calendarGrid"></g>' + paths.join('');
}
function setZoom(value) {
  const position = anchor(); pxDay = Math.max(.12, Math.min(80, value)); render(position);
}
function centerDate(date) { viewport.scrollLeft = (day(date) - rangeStart) * pxDay - contentWidth() / 2; renderAxis(); }

function confirmAction(title, message, button = 'Continuar') {
  const dialog = $('confirmDialog'); $('confirmTitle').textContent = title; $('confirmText').textContent = message; $('confirmAccept').textContent = button;
  return new Promise(resolve => {
    const finish = answer => { dialog.close(); $('confirmAccept').onclick = null; $('confirmCancel').onclick = null; dialog.oncancel = null; resolve(answer); };
    $('confirmAccept').onclick = () => finish(true); $('confirmCancel').onclick = () => finish(false);
    dialog.oncancel = event => { event.preventDefault(); finish(false); }; dialog.showModal();
  });
}
function editorType() {
  const original = project.tasks.find(t => t.id === editingId), hasChildren = original && childrenOf(project.tasks, original.id).length > 0;
  const group = $('taskType').value === 'group', milestone = $('taskType').value === 'milestone';
  $('taskStart').disabled = Boolean(hasChildren); $('taskEnd').disabled = Boolean(hasChildren || milestone);
  $('taskStatus').disabled = Boolean(hasChildren); $('taskProgress').disabled = Boolean(hasChildren);
  $('taskType').disabled = Boolean(hasChildren); $('summaryHint').hidden = !hasChildren; $('dependenciesField').hidden = group;
  if (milestone) $('taskEnd').value = $('taskStart').value;
}
function openEditor(id = null, defaults = {}) {
  if (drag?.moved) return;
  editingId = id; selectedId = id;
  const stored = id ? project.tasks.find(t => t.id === id) : null;
  if (id && !stored) return;
  const center = dateFromDay(rangeStart + (viewport.scrollLeft + contentWidth() / 2) / pxDay);
  const task = stored ? summarize(stored, project.tasks) : {
    title: '', type: 'task', parentId: null, start: center, end: addDays(center, 6),
    phase: 'piloto', status: 'planificado', progress: 0, notes: '', owners: [], dependencies: [], ...defaults,
  };
  const excluded = new Set(stored ? [stored.id, ...descendants(project.tasks, stored.id).map(t => t.id)] : []);
  $('editorHeading').textContent = stored ? 'Editar elemento' : 'Nuevo elemento';
  $('formError').hidden = true;
  $('taskTitle').value = task.title; $('taskType').value = task.type;
  $('taskParent').innerHTML = '<option value="">Sin proyecto padre</option>' + project.tasks.filter(t => t.type === 'group' && !excluded.has(t.id)).map(t => `<option value="${t.id}">${escape(t.title)}</option>`).join('');
  $('taskParent').value = task.parentId || '';
  $('taskStart').value = task.start; $('taskEnd').value = task.end;
  $('taskOwners').value = (stored ? stored.owners : task.owners).join(', ');
  $('taskStatus').value = task.status; $('taskProgress').value = task.progress;
  $('taskPhase').value = task.phase; $('taskNotes').value = task.notes;
  const choices = project.tasks.filter(t => t.type !== 'group' && !excluded.has(t.id));
  $('dependenciesList').innerHTML = choices.length ? choices.map(t => `<label><input type="checkbox" name="dependency" value="${t.id}" ${task.dependencies.includes(t.id) ? 'checked' : ''}>${escape(t.title)} <span class="field-hint">${escape(project.tasks.find(p => p.id === t.parentId)?.title || '')}</span></label>`).join('') : '<p class="field-hint">Todavía no hay otras tareas o hitos.</p>';
  $('deleteButton').hidden = !stored; editorType(); $('editorDialog').showModal();
  $('taskTitle').focus();
}
function closeEditor() { $('editorDialog').close(); editingId = null; }

$('taskForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const next = clone(project), old = next.tasks.find(t => t.id === editingId);
    const hasChildren = old && childrenOf(next.tasks, old.id).length > 0;
    const type = $('taskType').value;
    let progress = Number($('taskProgress').value), status = $('taskStatus').value;
    if (status === 'completado') progress = 100;
    if (progress === 100) status = 'completado';
    else if (progress > 0 && status === 'planificado') status = 'curso';
    const item = {
      id: editingId || crypto.randomUUID(), type, title: $('taskTitle').value.trim(), parentId: $('taskParent').value || null,
      start: hasChildren ? old.start : $('taskStart').value,
      end: hasChildren ? old.end : type === 'milestone' ? $('taskStart').value : $('taskEnd').value,
      owners: $('taskOwners').value.split(',').map(v => v.trim()).filter(Boolean),
      status: hasChildren ? old.status : status, progress: hasChildren ? old.progress : progress,
      phase: $('taskPhase').value, notes: $('taskNotes').value,
      dependencies: type === 'group' ? [] : [...$('dependenciesList').querySelectorAll('input:checked')].map(i => i.value),
    };
    if (old) next.tasks[next.tasks.findIndex(t => t.id === old.id)] = item;
    else {
      next.tasks.push(item);
      $('searchInput').value = ''; $('ownerFilter').value = ''; $('statusFilter').value = '';
    }
    validateProject(next);
    let parentId = item.parentId;
    while (parentId) { expanded.add(parentId); parentId = next.tasks.find(t => t.id === parentId)?.parentId; }
    closeEditor(); commit(next, 'Elemento guardado.', { select: item.id });
    const interval = summarize(item, next.tasks); centerDate(interval.start);
    const row = document.querySelector(`[data-row="${item.id}"]`); if (row) viewport.scrollTop = Math.max(0, row.offsetTop - AXIS_HEIGHT - 45);
  } catch (error) { $('formError').textContent = error.message; $('formError').hidden = false; $('formError').scrollIntoView({ block: 'nearest' }); }
});
$('deleteButton').addEventListener('click', async () => {
  const task = project.tasks.find(t => t.id === editingId), children = descendants(project.tasks, task.id).length;
  const yes = await confirmAction('Eliminar elemento', `Se eliminará «${task.title}»${children ? ' y sus ' + children + ' fases' : ''}. Podrá deshacerlo durante esta sesión.`, 'Eliminar');
  if (yes) { const next = removeItem(project, task.id); closeEditor(); commit(next, 'Elemento eliminado. Puede deshacerlo.', { select: null }); }
});

// Pointer actions commit a single history entry on release, even after many drag frames.
function startBar(event, bar) {
  if (event.button !== 0) return;
  event.stopPropagation();
  const task = project.tasks.find(t => t.id === bar.dataset.bar);
  selectedId = task.id;
  const edge = event.target.closest('[data-edge]')?.dataset.edge || 'move';
  drag = { id: task.id, edge, pointer: event.pointerId, startX: event.clientX, lastX: event.clientX, lastY: event.clientY, startScroll: viewport.scrollLeft, moved: false, delta: 0, original: clone(project), bar };
  bar.setPointerCapture(event.pointerId);
  const tick = () => {
    if (!drag) return;
    if (drag.moved) {
      const rect = viewport.getBoundingClientRect();
      if (drag.lastX > rect.right - 36) viewport.scrollLeft += 12;
      if (drag.lastX < rect.left + labelWidth() + 22) viewport.scrollLeft -= 12;
      previewDrag();
    }
    animation = requestAnimationFrame(tick);
  };
  animation = requestAnimationFrame(tick);
}
function previewDrag() {
  if (!drag) return;
  let delta = Math.round((drag.lastX - drag.startX + viewport.scrollLeft - drag.startScroll) / pxDay);
  const item = drag.original.tasks.find(t => t.id === drag.id);
  if (drag.edge === 'start') delta = Math.min(delta, duration(item) - 1);
  if (drag.edge === 'end') delta = Math.max(delta, 1 - duration(item));
  drag.delta = delta;
  let next;
  try { next = moveItem(drag.original, drag.id, delta, drag.edge); } catch { return; }
  const affected = new Set([drag.id, ...descendants(project.tasks, drag.id).map(t => t.id)]);
  let parent = project.tasks.find(t => t.id === item.parentId);
  while (parent) { affected.add(parent.id); parent = project.tasks.find(t => t.id === parent.parentId); }
  for (const id of affected) {
    const bar = document.querySelector(`[data-bar="${id}"]`), task = next.tasks.find(t => t.id === id);
    if (!bar || !task) continue;
    const s = summarize(task, next.tasks);
    bar.style.left = `${(day(s.start) - rangeStart) * pxDay}px`;
    if (task.type !== 'milestone') bar.style.width = `${Math.max(7, duration(s) * pxDay)}px`;
  }
  const summary = summarize(next.tasks.find(t => t.id === drag.id), next.tasks);
  $('dragTooltip').hidden = false; $('dragTooltip').textContent = `${format(summary.start)} → ${format(summary.end)}`;
  $('dragTooltip').style.left = `${Math.max(8, Math.min(innerWidth - 260, drag.lastX + 12))}px`;
  $('dragTooltip').style.top = `${Math.max(8, drag.lastY - 45)}px`;
}
function finishDrag(cancelled = false) {
  if (!drag) return;
  const action = drag; drag = null; cancelAnimationFrame(animation); $('dragTooltip').hidden = true;
  try { action.bar.releasePointerCapture(action.pointer); } catch { /* Capture may already have ended. */ }
  if (action.moved && action.delta && !cancelled) {
    try { commit(moveItem(action.original, action.id, action.delta, action.edge), 'Fechas actualizadas.'); }
    catch (error) { render(anchor()); toast(error.message); }
  } else if (action.moved || cancelled) render(anchor());
  else openEditor(action.id);
}
$('rows').addEventListener('pointerdown', event => {
  const bar = event.target.closest('[data-bar]'); if (bar) { startBar(event, bar); return; }
  if (event.target.closest('.row-track') && event.button === 0) {
    pan = { pointer: event.pointerId, x: event.clientX, scroll: viewport.scrollLeft, target: event.target.closest('.row-track'), moved: false };
    pan.target.setPointerCapture(event.pointerId);
  }
});
window.addEventListener('pointermove', event => {
  if (drag && event.pointerId === drag.pointer) {
    drag.lastX = event.clientX; drag.lastY = event.clientY;
    if (Math.abs(event.clientX - drag.startX) > 4) drag.moved = true;
    if (drag.moved) { event.preventDefault(); previewDrag(); }
  } else if (pan && event.pointerId === pan.pointer) {
    if (Math.abs(event.clientX - pan.x) > 4) pan.moved = true;
    if (pan.moved) viewport.scrollLeft = pan.scroll - (event.clientX - pan.x);
  }
}, { passive: false });
window.addEventListener('pointerup', event => {
  if (drag && event.pointerId === drag.pointer) finishDrag();
  if (pan && event.pointerId === pan.pointer) { try { pan.target.releasePointerCapture(pan.pointer); } catch {} pan = null; }
});
window.addEventListener('pointercancel', () => { finishDrag(true); pan = null; });
$('rows').addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) { const id = toggle.dataset.toggle; expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(anchor()); return; }
  const edit = event.target.closest('[data-edit]'); if (edit) openEditor(edit.dataset.edit);
  const bar = event.target.closest('[data-bar]');
  // Keyboard-generated clicks do not generate pointer events.
  if (bar && event.detail === 0) openEditor(bar.dataset.bar);
});
$('rows').addEventListener('dblclick', event => {
  if (event.target.closest('[data-bar]')) return;
  const track = event.target.closest('[data-track]'); if (!track) return;
  const rect = track.getBoundingClientRect(), date = dateFromDay(rangeStart + (event.clientX - rect.left) / pxDay);
  const task = project.tasks.find(t => t.id === track.dataset.track);
  openEditor(null, { start: date, end: addDays(date, 6), parentId: task.type === 'group' ? task.id : task.parentId });
});
$('rows').addEventListener('keydown', event => {
  const bar = event.target.closest('[data-bar]');
  if (!bar || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 7 : 1);
  const task = project.tasks.find(t => t.id === bar.dataset.bar);
  const edge = event.altKey && !childrenOf(project.tasks, task.id).length ? 'end' : 'move';
  try { commit(moveItem(project, task.id, delta, edge), 'Fechas actualizadas.'); }
  catch (error) { toast(error.message); }
  document.querySelector(`[data-bar="${task.id}"]`)?.focus({ preventScroll: true });
});
viewport.addEventListener('keydown', event => {
  if (event.target !== viewport || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault(); viewport.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * 100;
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(true); }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || $('editorDialog').open || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
});

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.querySelector('.export-menu').open = false;
}
$('exportButton').onclick = () => download(JSON.stringify({ ...project, exportedAt: new Date().toISOString() }, null, 2), `FH_HGUGM_Gantt_${today()}.json`, 'application/json');
$('csvButton').onclick = () => download(toCSV(project), `FH_HGUGM_Gantt_${today()}.csv`, 'text/csv;charset=utf-8');
$('importButton').onclick = () => { document.querySelector('.export-menu').open = false; $('importFile').click(); };
$('importFile').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('La copia supera los 8 MB.');
    const imported = validateProject(JSON.parse(await file.text()));
    const yes = await confirmAction('Importar planificación', `La copia «${file.name}» contiene ${imported.tasks.length} elementos. Sustituirá la planificación actual. Podrá deshacerlo durante esta sesión.`, 'Importar copia');
    if (yes) { commit(imported, 'Copia importada.'); render(null, true); }
  } catch (error) { toast('No se ha importado la copia: ' + error.message); }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const next = validateProject(JSON.parse(event.newValue));
    if (JSON.stringify(next.tasks) === JSON.stringify(project.tasks)) return;
    incomingProject = next; $('remoteNotice').hidden = false;
  } catch { /* Never replace a valid local plan with invalid external data. */ }
});
$('loadRemote').onclick = () => { if (!incomingProject) return; const next = incomingProject; incomingProject = null; closeEditor(); commit(next, 'Cambios de la otra pestaña cargados.'); $('remoteNotice').hidden = true; };
$('keepCurrent').onclick = () => { incomingProject = null; save(); $('remoteNotice').hidden = true; };
$('recoverRaw').onclick = () => download(rawRecovery || '', 'FH_HGUGM_copia_para_recuperar.txt', 'text/plain');
$('acceptBase').onclick = () => { writeBlocked = false; rawRecovery = null; $('storageWarning').hidden = true; save(); toast('Este plan queda guardado en el navegador.'); };

$('newButton').onclick = () => openEditor();
$('undoButton').onclick = undo; $('redoButton').onclick = redo;
$('zoomIn').onclick = () => setZoom(pxDay * 1.4); $('zoomOut').onclick = () => setZoom(pxDay / 1.4);
$('scaleSelect').onchange = event => setZoom(Number(event.target.value));
$('fitButton').onclick = () => { render(null, true); viewport.scrollLeft = 0; storeView(); };
$('panLeft').onclick = () => { viewport.scrollLeft -= contentWidth() * .7; };
$('panRight').onclick = () => { viewport.scrollLeft += contentWidth() * .7; };
$('todayButton').onclick = () => centerDate(today());
$('expandButton').onclick = () => { expanded = new Set(project.tasks.filter(t => t.type === 'group').map(t => t.id)); render(anchor()); };
$('collapseButton').onclick = () => { expanded.clear(); render(anchor()); };
for (const id of ['searchInput', 'ownerFilter', 'statusFilter']) $(id).addEventListener(id === 'searchInput' ? 'input' : 'change', () => render(anchor()));
$('clearFilters').onclick = () => { $('searchInput').value = ''; $('ownerFilter').value = ''; $('statusFilter').value = ''; render(anchor()); };
$('conflictButton').onclick = () => {
  const first = conflicts(project.tasks)[0]; if (!first) return;
  const task = project.tasks.find(t => t.id === first.taskId); openEditor(task.id);
  toast('Una tarea comienza antes de que termine una de sus dependencias. Revise las fechas o la relación.');
};
$('closeEditor').onclick = closeEditor; $('cancelEditor').onclick = closeEditor;
$('taskType').onchange = editorType; $('taskStart').onchange = editorType;
$('taskStatus').onchange = () => { if ($('taskStatus').value === 'completado') $('taskProgress').value = 100; };
$('helpButton').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
viewport.addEventListener('scroll', () => { renderAxis(); storeView(); }, { passive: true });
window.addEventListener('resize', () => { if (project && !drag) render(anchor()); });

async function bootstrap() {
  let stored = null, view = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { project = validateProject(JSON.parse(stored)); }
      catch { rawRecovery = stored; writeBlocked = true; }
    }
    try { view = JSON.parse(localStorage.getItem(VIEW_KEY)); } catch { /* The plan itself is independent of view preferences. */ }
  } catch { /* Private/limited storage: the user can still work and export a copy. */ }
  if (!project) {
    const response = await fetch('./plan-base.json?v=gantt-1');
    if (!response.ok) throw new Error('No se ha podido cargar el calendario inicial.');
    project = validateProject(await response.json());
  }
  if (view && Number.isFinite(view.pxDay) && view.pxDay >= .12 && view.pxDay <= 80) {
    pxDay = view.pxDay; expanded = new Set(Array.isArray(view.expanded) ? view.expanded.filter(id => project.tasks.some(t => t.id === id)) : []);
  } else view = null;
  $('loading').hidden = true; $('application').hidden = false;
  if (rawRecovery) {
    $('storageWarningText').textContent = 'No se ha podido abrir la copia guardada. Se muestra el plan base sin sobrescribirla. Descárguela antes de sustituirla.';
    $('storageWarning').hidden = false;
  }
  restoringView = true; render(null, !view);
  if (view) { viewport.scrollLeft = Number(view.left) || 0; viewport.scrollTop = Number(view.top) || 0; renderAxis(); }
  restoringView = false; storeView();
  if (!rawRecovery) save(); else $('saveStatus').textContent = 'Copia guardada pendiente de recuperar';
}
bootstrap().catch(error => {
  $('loading').textContent = error.message + ' Puede recargar la página para reintentarlo.';
  $('loading').hidden = false; $('application').hidden = true;
});
