// Entrada cinematográfica a la vista 3D: la cámara baja desde el espacio sobre Jezero girando
// alrededor del cráter mientras aparece el título, y termina en la vista general con dos opciones:
// el tour guiado o explorar por libre. Se puede saltar en cualquier momento (clic, Esc o espacio).
const DURATION = 9000; // ms

const ease = (t) => 1 - Math.pow(1 - t, 3); // frena al final, como un descenso

export function runIntro({ THREE, camera, controls, stage, onFrame, onTour, onDone, meta = '' }) {
  // Pose final: la que haya dejado la vista general
  const target = controls.target.clone();
  const end = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
  // Empieza más alto y casi en vertical, pero sin alejarse tanto que se vea el borde del relieve
  const start = new THREE.Spherical(end.radius * 2.1, 0.2, end.theta - 1.4);

  const el = document.createElement('div');
  el.className = 'intro';
  el.innerHTML = `
    <div class="intro-top">
      <span class="intro-kicker">NASA Space Apps 2026 · Interplanetary Survival Guide</span>
    </div>
    <div class="intro-title">
      <h1>ARES</h1>
      <p class="intro-sub">Planificación de travesías en Marte</p>
      <p class="intro-meta mono">${meta}</p>
    </div>
    <div class="intro-cta" hidden>
      <button class="btn primary" type="button" data-intro="tour">Ver la presentación</button>
      <button class="btn" type="button" data-intro="explore">Explorar por mi cuenta</button>
    </div>
    <button class="intro-skip" type="button" data-intro="skip">Saltar intro · Esc</button>`;
  stage.appendChild(el);
  document.body.classList.add('intro-on');
  controls.enabled = false;

  let t0 = null;
  let finished = false;
  const sph = new THREE.Spherical();
  const off = onFrame((now) => {
    if (finished) return;
    if (t0 === null) t0 = now;
    const k = Math.min(1, (now - t0) / DURATION);
    const e = ease(k);
    sph.set(
      start.radius + (end.radius - start.radius) * e,
      start.phi + (end.phi - start.phi) * e,
      start.theta + (end.theta - start.theta) * e,
    );
    camera.position.setFromSpherical(sph).add(target);
    camera.lookAt(target);
    if (k >= 1) land();
  });

  // Fin del descenso: la cámara queda en la vista general y aparecen las opciones
  function land() {
    if (finished) return;
    finished = true;
    off();
    camera.position.setFromSpherical(end).add(target);
    camera.lookAt(target);
    controls.enabled = true;
    controls.update();
    el.classList.add('landed');
    // La interfaz vuelve en cuanto termina el descenso; la intro solo deja sus dos botones y
    // se cierra con cualquier clic o tecla fuera de ellos.
    document.body.classList.remove('intro-on');
    el.querySelector('.intro-cta').hidden = false;
    el.querySelector('[data-intro="tour"]').focus();
    stage.addEventListener('pointerdown', onStageDown, true);
  }
  function onStageDown(e) {
    if (!e.target.closest('.intro-cta')) close('explore');
  }
  let closed = false;
  function close(next) {
    if (closed) return;
    closed = true;
    land();
    stage.removeEventListener('pointerdown', onStageDown, true);
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('leaving');
    document.body.classList.remove('intro-on');
    setTimeout(() => el.remove(), 450);
    if (next === 'tour') onTour();
    onDone?.();
  }
  function onKey(e) {
    if (e.key === 'Escape' || (e.key === ' ' && !finished)) {
      e.preventDefault();
      e.stopPropagation();
      if (!finished) land(); else close('explore');
    } else if (finished && !['Tab', 'Enter', 'Shift', ' '].includes(e.key)) {
      close('explore'); // cualquier otra tecla (flechas, etc.) sigue funcionando y cierra la intro
    }
  }
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-intro]')?.dataset.intro;
    if (act === 'tour') close('tour');
    else if (act === 'explore') close('explore');
    else if (act === 'skip') { if (!finished) land(); else close('explore'); }
    else if (!finished) land();
  });
}
