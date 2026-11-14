// Cabecera de la ficha (mapa 2D y vista 3D): foto, nombre, estado y progreso del recorrido.
// La foto es la primera de las cámaras del rover en ese sol; mientras carga (o en "Mi ruta"), la
// imagen de satélite del punto: HiRISE encima y CTX debajo (donde HiRISE no tiene dato se ve CTX).
import { SITE, fmt, num, latLon, tiltClass, trekTileAt } from './shared.js';

const STOP_STATUS = { ok: 'Nominal', warn: 'Precaución', bad: 'Pendiente fuerte' };

export function satAt(lon, lat) {
  const h = SITE.tiles.hirise.bounds;
  const inHirise = lon > h.west && lon < h.east && lat > h.south && lat < h.north;
  const ctx = `url("${trekTileAt(SITE.tiles.ctx.layer, 'png', 13, lon, lat)}")`;
  return inHirise
    ? { css: `url("${trekTileAt(SITE.tiles.hirise.layer, 'png', 16, lon, lat)}"), ${ctx}`, caption: 'HiRISE / CTX · satélite' }
    : { css: ctx, caption: 'CTX · satélite' };
}

export function renderHero(el, { img, caption, title, meta, meta2, status, from, to, frac, left, right }) {
  const css = img.startsWith('url(') ? img : `url("${img}")`;
  if (el.dataset.img !== css) {
    el.dataset.img = css;
    el.style.setProperty('--hero-img', css);
  }
  el.innerHTML = `<div class="hero-photo"><span>${caption}</span></div>
    <div class="hero-body">
      <div class="hero-title"><h2>${title}</h2>${status ? `<span class="status ${status.cls}">${status.text}</span>` : ''}</div>
      <p class="hero-meta">${meta}</p>
      ${meta2 ? `<p class="hero-meta2">${meta2}</p>` : ''}
      <div class="hero-prog">
        <div class="hero-ends"><span>${from}</span><span>${to}</span></div>
        <div class="hero-bar"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>
        <div class="hero-ends"><span>${left}</span><span>${right}</span></div>
      </div>
    </div>`;
}

// Cabecera de una parada de Perseverance. photo: { sol, url, cam } de ese sol, o null.
export function renderStopHero(el, p, i, pts, photo) {
  const ph = photo?.sol === p.sol ? photo : null;
  const sat = satAt(p.lon, p.lat);
  const cls = tiltClass(p.tilt_deg);
  renderHero(el, {
    img: ph ? ph.url : sat.css,
    caption: ph ? `${ph.cam} · sol ${p.sol}` : sat.caption,
    title: 'Perseverance',
    meta: `Sol ${p.sol} · parada ${num(i + 1)} de ${num(pts.length)}`,
    meta2: `≈ ${SITE.solDate(p.sol)} · ${latLon(p)}`,
    status: { cls, text: STOP_STATUS[cls] },
    from: `Sol ${pts[0].sol} · aterrizaje`,
    to: `Sol ${pts.at(-1).sol}`,
    frac: p.dist_total_m / (pts.at(-1).dist_total_m || 1),
    left: `${fmt.km(p.dist_total_m)} recorridos`,
    right: `${fmt.km(pts.at(-1).dist_total_m)} en total`,
  });
}
