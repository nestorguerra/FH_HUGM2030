import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { day, addDays, duration, clone, summarize, validateProject, moveItem, removeItem, ownersOf, visibleRows, conflicts, toCSV } from './model.mjs';
const base = validateProject(JSON.parse(await readFile(new URL('./plan-base.json', import.meta.url), 'utf8')));

test('el calendario inicial conserva las 11 filas y las 23 fases propuestas', () => {
  assert.equal(base.tasks.length, 34);
  assert.equal(base.tasks.filter(t => t.type === 'group').length, 11);
  assert.equal(base.tasks.filter(t => t.type === 'task').length, 23);
  assert(base.tasks.every(t => !t.owners.length && t.progress === 0 && t.status === 'planificado'));
});
test('los días civiles no cambian de duración por el horario de verano', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.throws(() => day('2026-02-29'));
  assert.throws(() => day('2026-13-01'));
});
test('mover un proyecto desplaza todas sus fases sin cambiar duraciones', () => {
  const next = moveItem(base, 'jarvis', 7);
  for (const old of base.tasks.filter(t => t.id === 'jarvis' || t.parentId === 'jarvis')) {
    const updated = next.tasks.find(t => t.id === old.id);
    assert.equal(updated.start, addDays(old.start, 7));
    assert.equal(updated.end, addDays(old.end, 7));
    assert.equal(duration(updated), duration(old));
  }
  assert.equal(base.tasks.find(t => t.id === 'jarvis-fase-1').start, '2026-07-01');
});
test('la duración no puede ser negativa al arrastrar un extremo', () => {
  const next = moveItem(base, 'gateway-fase-1', 1000, 'start');
  const t = next.tasks.find(t => t.id === 'gateway-fase-1');
  assert.equal(t.start, t.end);
  assert.throws(() => moveItem(base, 'gateway', 2, 'end'));
});
test('un hito mantiene una sola fecha al moverlo', () => {
  const p = clone(base); p.tasks.push({ ...p.tasks[1], id: 'hito', type: 'milestone', start: '2027-01-15', end: '2027-01-15', parentId: null });
  const n = moveItem(p, 'hito', -3); const h = n.tasks.find(t => t.id === 'hito');
  assert.equal(h.start, '2027-01-12'); assert.equal(h.start, h.end);
});
test('los resúmenes usan las fechas y el progreso ponderado de sus fases', () => {
  const p = clone(base); const first = p.tasks.find(t => t.id === 'gateway-fase-1'); first.progress = 100; first.status = 'completado';
  const s = summarize(p.tasks.find(t => t.id === 'gateway'), p.tasks);
  assert.equal(s.start, '2026-07-01'); assert.equal(s.end, '2028-12-31');
  assert(s.progress > 0 && s.progress < 100); assert.equal(s.status, 'curso');
});
test('una importación rechaza círculos y dependencias inexistentes', () => {
  const p = clone(base); p.tasks[1].dependencies = ['requisitos-fase-1'];
  p.tasks.find(t => t.id === 'requisitos-fase-1').dependencies = [p.tasks[1].id];
  assert.throws(() => validateProject(p), /círculo/);
  p.tasks[1].dependencies = ['no-existe']; assert.throws(() => validateProject(p), /dependencia/);
  const q = clone(base); q.tasks.find(t => t.id === 'obra').parentId = 'obra'; assert.throws(() => validateProject(q));
});
test('las copias se validan antes de aceptar estados, tipos o fechas', () => {
  const p = clone(base); p.tasks[1].phase = '__proto__'; assert.throws(() => validateProject(p), /Fase/);
  p.tasks[1].phase = 'piloto'; p.tasks[1].end = '2025-01-01'; assert.throws(() => validateProject(p), /fechas/);
});
test('al eliminar un proyecto se limpian sus fases y referencias dependientes', () => {
  const p = clone(base); p.tasks.find(t => t.id === 'voz-fase-1').dependencies = ['jarvis-fase-1'];
  const next = removeItem(p, 'jarvis');
  assert(!next.tasks.some(t => t.id === 'jarvis' || t.parentId === 'jarvis'));
  assert.deepEqual(next.tasks.find(t => t.id === 'voz-fase-1').dependencies, []);
  validateProject(next);
});
test('los responsables se heredan y los filtros conservan los proyectos padres', () => {
  const p = clone(base); p.tasks.find(t => t.id === 'vision').owners = ['Equipo de prueba'];
  const child = p.tasks.find(t => t.id === 'vision-fase-1');
  assert.deepEqual(ownersOf(child, p.tasks), ['Equipo de prueba']);
  const rows = visibleRows(p.tasks, new Set(), { owner: 'Equipo de prueba' });
  assert.deepEqual(rows.map(r => r.task.id), ['vision', 'vision-fase-1', 'vision-fase-2']);
  assert(visibleRows(p.tasks, new Set(), { query: 'vision' }).some(r => r.task.id === 'vision'));
});
test('las dependencias solapadas se señalan sin mover tareas silenciosamente', () => {
  const p = clone(base); p.tasks.find(t => t.id === 'voz-fase-1').dependencies = ['jarvis-fase-2'];
  const before = p.tasks.find(t => t.id === 'voz-fase-1').start;
  assert.equal(conflicts(p.tasks).length, 1);
  assert.equal(p.tasks.find(t => t.id === 'voz-fase-1').start, before);
});
test('el CSV protege fórmulas y conserva comillas y varias personas', () => {
  const p = clone(base); p.tasks[1].title = '=SUM(1;2)'; p.tasks[1].owners = ['Persona A', 'Persona B']; p.tasks[1].notes = 'Nota "con comillas"';
  const csv = toCSV(p);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes("'=SUM(1;2)"));
  assert(csv.includes('Persona A, Persona B')); assert(csv.includes('""con comillas""'));
});
