# Gestor de la hoja de ruta

Aplicación estática enlazada desde el diagrama de «Tres olas, horizonte 2028».
Se publica en GitHub Pages junto al informe, sin compilación ni servidor de datos.
Conserva las fuentes, la paleta y la marca del documento.

## Uso

- Desplegar iniciativas y fases. Zoom por días, semanas, meses o trimestres.
- Recorrer el calendario con las flechas, el ratón o arrastrando su fondo.
- Crear, editar y eliminar proyectos, tareas e hitos.
- Mover barras y ajustar sus extremos. Los proyectos desplazan todas sus fases.
- Asignar varias personas, estado, progreso, notas y dependencias fin → inicio.
- Filtrar por texto, responsable o estado. Deshacer y rehacer durante la sesión.
- Exportar JSON para recuperar o trasladar el plan; CSV para una hoja de cálculo.

Las fechas iniciales se derivan de los trimestres del gráfico V1.1. Son propuestas
editables; los responsables empiezan sin asignar y el progreso, en cero. Los colores
identifican fases y no acreditan ejecución. Las fechas y el progreso de un proyecto
con fases se calculan a partir de ellas. Las dependencias incompatibles se señalan;
el gestor no reprograma las demás tareas automáticamente.

## Datos y recuperación

El plan se guarda en `localStorage` con la clave `fh-hgugm-gantt-v1`. La vista usa
`fh-hgugm-gantt-view-v1`. Los datos pertenecen a ese navegador y origen; no hay
sincronización entre personas o equipos. Borrar los datos del navegador elimina
su copia. Use **Copias y exportación → Descargar copia JSON** para conservarla.

La importación valida fechas, identificadores y dependencias antes de sustituir
el plan, requiere confirmar la sustitución y permite deshacerla en la sesión.
Una copia local ilegible se conserva para descargarla antes de sustituirla.
Si otra pestaña guarda un plan diferente, se pide elegir la versión y se suspende
el guardado automático hasta que el usuario decide.

## Desarrollo y comprobaciones

Sirva la raíz del repositorio con un servidor HTTP estático y abra `/gantt/`.
No requiere dependencias externas. Pruebas del calendario y el modelo de datos:

```sh
node --test gantt/model.test.mjs
node --check gantt/app.mjs
```

Además de las pruebas de fechas civiles, jerarquía, progreso, dependencias,
importación y CSV, compruebe en navegador: arrastre, duración, filtros, zoom,
guardado tras recargar, exportación, importación y recuperación con deshacer.

`plan-base.json` contiene 11 filas principales y 23 fases del gráfico de partida.
Modificar ese archivo actualiza la base para nuevos navegadores; no sustituye
las copias personales ya guardadas.
