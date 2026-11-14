// Fotos del rover para un sol (API pública de Perseverance, en directo). Común al mapa 2D y al 3D.
import { SITE, num, loadJson } from './shared.js';

const CAMERAS = {
  NAVCAM_LEFT: 'Navcam', NAVCAM_RIGHT: 'Navcam', MCZ_LEFT: 'Mastcam-Z', MCZ_RIGHT: 'Mastcam-Z',
  FRONT_HAZCAM_LEFT_A: 'Hazcam del.', FRONT_HAZCAM_RIGHT_A: 'Hazcam del.', FRONT_HAZCAM_LEFT_B: 'Hazcam del.', FRONT_HAZCAM_RIGHT_B: 'Hazcam del.',
  REAR_HAZCAM_LEFT: 'Hazcam tras.', REAR_HAZCAM_RIGHT: 'Hazcam tras.', SUPERCAM_RMI: 'SuperCam', SKYCAM: 'SkyCam',
  SHERLOC_WATSON: 'WATSON', CACHECAM: 'CacheCam', PIXL_MCC: 'PIXL',
};
const CAMERA_ORDER = ['Navcam', 'Mastcam-Z', 'Hazcam del.', 'Hazcam tras.', 'SuperCam', 'WATSON'];

// Hasta 12 fotos variadas: como mucho 3 por cámara, priorizando las de navegación y paisaje.
function pickImages(images) {
  const byCam = new Map();
  for (const im of images) {
    const cam = CAMERAS[im.camera?.instrument] ?? im.camera?.instrument ?? 'Cámara';
    if (!byCam.has(cam)) byCam.set(cam, []);
    byCam.get(cam).push({ cam, thumb: im.image_files?.small, url: im.image_files?.large ?? im.image_files?.full_res });
  }
  const cams = [...byCam.keys()].sort((a, b) => (CAMERA_ORDER.indexOf(a) + 99) % 99 - (CAMERA_ORDER.indexOf(b) + 99) % 99);
  const out = [];
  for (let round = 0; round < 3 && out.length < 12; round++) {
    for (const c of cams) if (byCam.get(c)[round] && out.length < 12) out.push(byCam.get(c)[round]);
  }
  return out.filter((x) => x.thumb);
}

const cache = new Map();
function imagesForSol(sol) {
  if (!cache.has(sol)) {
    cache.set(sol, loadJson(SITE.images(sol)).then((j) => ({ total: j.images.length, picked: pickImages(j.images) })));
  }
  return cache.get(sol);
}

// Devuelve show(sol, { paused }) para pintar las fotos en `box` con el estado en `status`.
// onLoad(fotos, sol), opcional: avisa cuando hay fotos (la vista 3D usa la primera en la cabecera).
export function createPhotos(box, status, { onLoad } = {}) {
  let ticket = 0;
  return async function show(sol, { paused = false } = {}) {
    const my = ++ticket;
    if (paused) {
      status.textContent = 'en pausa al reproducir';
      box.innerHTML = '';
      return;
    }
    status.textContent = 'cargando…';
    box.innerHTML = '<div class="skeleton"></div>'.repeat(8);
    try {
      const data = await imagesForSol(sol);
      if (my !== ticket) return;
      if (!data.picked.length) {
        status.textContent = 'ninguna este sol';
        box.innerHTML = '';
        return;
      }
      status.textContent = `${data.picked.length} de ${num(data.total)}`;
      onLoad?.(data.picked, sol);
      box.innerHTML = data.picked.map((im) => `<a href="${im.url}" target="_blank" rel="noopener" title="${im.cam} · sol ${sol}">
          <img src="${im.thumb}" alt="${im.cam}, sol ${sol}" loading="lazy"><span class="cam">${im.cam}</span></a>`).join('');
    } catch (err) {
      cache.delete(sol);
      if (my !== ticket) return;
      status.textContent = 'no disponibles';
      box.innerHTML = `<p class="empty" style="grid-column:1/-1">No se pudieron cargar (${err.message}).</p>`;
    }
  };
}
