// Menús del mapa 2D y de la vista 3D (diseño "mezcla": estructura tipo Flightradar24, estética tipo SpaceX).
//  · Ficha de la parada o de "Mi ruta" a la izquierda, con foto arriba (hero.js).
//  · Herramientas en la barra inferior, junto a la línea de tiempo. Cada una abre un panel encima de la
//    barra y muestra su valor actual. El planificador del mapa se abre en el lateral y no se cierra al
//    pulsar en el mapa (ahí se marcan los puntos A y B).
// Solo recoloca bloques que ya existen en el HTML (con sus eventos): no duplica lógica ni datos.
const $ = (id) => document.getElementById(id);
const stage = document.querySelector('.stage');
const dock = document.querySelector('.dock');
document.body.dataset.ui = 'mix';

const is3d = !!$('sec-layers');
const tab = (name) => document.querySelector(`[data-tab="${name}"]`)?.click();

if (is3d) document.querySelector('.time-ctl').id = 'time-ctl'; // para tratarlo como los demás bloques

const TOOLS = is3d
  ? [
    { key: 'route', label: 'Route', blocks: ['plan-sec'] },
    { key: 'view', label: 'Relief', blocks: ['sec-view'] },
    { key: 'time', label: 'Time', blocks: ['time-ctl'] },
    { key: 'info', label: 'Info', blocks: ['sec-routelegend', 'sec-method'] },
  ]
  : [
    { key: 'info', label: 'Info', blocks: ['sec-howto', 'sec-sources'] },
  ];

// ---------- Capas: barra fija sobre el mapa (siempre a la vista, no escondida en un menú) ----------
// Mueve los mismos controles (radios e interruptores con sus eventos) a una tira de miniaturas.
const layerbar = document.createElement('section');
layerbar.className = 'layerbar';
layerbar.setAttribute('aria-label', 'Map layers');
layerbar.innerHTML = `<div class="lb-head"><span class="lb-title">Layers</span><b class="lb-active"></b>
  <button type="button" class="lb-toggle" aria-expanded="true" aria-label="Hide layers" title="Hide or show layers">
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
  <div class="lb-fold"><div><div class="lb-body"></div><div class="lb-legends"></div></div></div>`;
const lbBody = layerbar.querySelector('.lb-body');
const lbLegends = layerbar.querySelector('.lb-legends');
for (const id of is3d ? ['sec-layers'] : ['sec-overlays']) {
  const sec = $(id);
  if (!sec) continue;
  const group = document.createElement('div');
  group.className = 'lb-group';
  group.innerHTML = `<span class="lb-group-title">${sec.querySelector('.sec-title')?.textContent ?? ''}</span>`;
  const cards = is3d ? $('layer') : document.createElement('div');
  cards.classList.add('lb-cards');
  if (!is3d) sec.querySelectorAll('label.layer').forEach((l) => cards.append(l));
  group.append(cards);
  lbBody.append(group);
  // Leyendas (rampa de altura, pendiente, frío…) debajo de la tira
  sec.querySelectorAll('.layer-legend, #legend').forEach((l) => lbLegends.append(l));
  sec.hidden = true;
}
stage.append(layerbar);
const lbToggle = layerbar.querySelector('.lb-toggle');
lbToggle.addEventListener('click', () => {
  const open = layerbar.classList.toggle('collapsed') === false;
  lbToggle.setAttribute('aria-expanded', String(open));
  lbToggle.setAttribute('aria-label', open ? 'Hide layers' : 'Show layers');
});

const bar = document.createElement('nav');
bar.className = 'dock-tools';
bar.setAttribute('aria-label', 'Tools');
dock.prepend(bar);

const items = [];
// Los paneles se abren y cierran con animación (al cerrar se espera a que acabe para ocultarlos)
function setOpen(item, open) {
  const shown = !item.pop.hidden && !item.pop.classList.contains('closing');
  if (shown === open) return;
  clearTimeout(item.closeT);
  if (open) {
    item.pop.classList.remove('closing');
    item.pop.hidden = false;
  } else {
    item.pop.classList.add('closing');
    item.closeT = setTimeout(() => { item.pop.hidden = true; item.pop.classList.remove('closing'); }, 500);
  }
  item.btn.setAttribute('aria-expanded', String(open));
  if (open) item.tool.onOpen?.(); else item.tool.onClose?.();
}
function closeAll(except) { items.forEach((it) => { if (it !== except) setOpen(it, false); }); }

for (const tool of TOOLS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dock-tool';
  btn.dataset.tool = tool.key;
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span>${tool.label}</span><b class="dock-val"></b>`;
  const pop = document.createElement('div');
  pop.className = `dock-pop dock-pop-${tool.key}${tool.side ? ' dock-pop-side' : ''}`;
  pop.hidden = true;
  pop.innerHTML = `<div class="dock-pop-head"><h3 class="dock-pop-title">${tool.label}</h3>${tool.side ? '<button type="button" class="dock-pop-close" aria-label="Close">Close</button>' : ''}</div>`;
  tool.blocks.forEach((id) => { if ($(id)) pop.append($(id)); });
  bar.append(btn);
  stage.append(pop);
  const item = { tool, btn, pop };
  items.push(item);
  btn.addEventListener('click', () => {
    const open = pop.hidden || pop.classList.contains('closing');
    closeAll(item);
    setOpen(item, open);
    if (open && !tool.side) {
      // El panel se abre encima de su botón, sin salirse de la pantalla
      const b = btn.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(s.width - pop.offsetWidth - 8, b.left - s.left))}px`;
    }
  });
  pop.querySelector('.dock-pop-close')?.addEventListener('click', () => setOpen(item, false));
}
// Los paneles normales se cierran al pulsar fuera; el lateral (planificador) solo con su botón o Esc
document.addEventListener('pointerdown', (e) => {
  for (const it of items) {
    if (it.tool.side || it.pop.hidden) continue;
    if (it.btn.contains(e.target) || it.pop.contains(e.target)) continue;
    setOpen(it, false);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

// Valor actual de cada herramienta en la propia barra
const val = (key) => bar.querySelector(`[data-tool="${key}"] .dock-val`);
const checkedName = (sel) => document.querySelector(sel)?.closest('label')?.querySelector('.name')?.textContent ?? '';
function sync() {
  if (is3d) {
    val('route').textContent = 'My route';
    layerbar.querySelector('.lb-active').textContent = checkedName('#layer input:checked');
    val('view').textContent = $('exag-label').textContent;
    val('time').textContent = $('hour-label').textContent;
  } else {
    layerbar.querySelector('.lb-active').textContent = `MOLA · ${checkedName('input[name="layer2d"]:checked')}`;
  }
}
sync();
document.addEventListener('change', sync);
const mo = new MutationObserver(sync);
if (is3d) {
  mo.observe($('exag-label'), { childList: true, characterData: true, subtree: true });
  mo.observe($('hour-label'), { childList: true, characterData: true, subtree: true });
} else {
  // El mapa ocupa solo la zona a la derecha de la ficha: Leaflet recalcula su tamaño
  [100, 800, 2000].forEach((ms) => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
}
