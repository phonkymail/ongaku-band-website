// ongaku.band — looping vertical cover flow
// One cover per band. Scroll / swipe / drag moves the covers continuously and
// they settle on the nearest band. Hovering the centre cover plays its band's
// preview; on touch screens, tap the centre cover to play/pause.
(() => {
  const flow = document.getElementById("flow");
  const N = TRACKS.length;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // pos = rendered position, target = where we're easing to (both unbounded;
  // the cover at the centre is TRACKS[mod(round(pos))])
  let pos = 0, target = 0;
  let current = -1;
  let raf = 0, last = 0;

  const mod = (n, m) => ((n % m) + m) % m;
  // shortest signed distance on the loop, in [-N/2, N/2)
  const wrap = (d) => mod(d + N / 2, N) - N / 2;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- build covers ----------
  const items = TRACKS.map((t, i) => {
    const b = BANDS[t.band];
    const el = document.createElement("button");
    el.className = "flow-item";
    el.setAttribute("aria-label", `${t.title} — ${b.name}`);
    el.style.setProperty("--cover-bg", b.coverBg);
    const src = t.cover || b.cover;
    el.innerHTML =
      `<img${b.coverFadeEdges ? ' class="fade-edges"' : ""} src="${src}" alt="" style="object-fit:${b.coverFit}" draggable="false"><span class="shade"></span>`;
    // reflection lives as a separate element so it can sit behind every cover
    const refl = document.createElement("div");
    refl.className = "flow-reflection";
    refl.style.setProperty("--cover-bg", b.coverBg);
    refl.innerHTML = el.innerHTML;
    flow.appendChild(refl);
    el.reflection = refl;
    el.shade = el.querySelector(".shade");
    refl.shade = refl.querySelector(".shade");
    el.tabIndex = -1;

    el.addEventListener("click", () => {
      if (flow.dataset.dragged) return;
      if (i !== current) return goTo(target + wrap(i - target));
      // also starts the hovered preview if hover couldn't (sound not yet unlocked)
      togglePlay();
    });
    flow.appendChild(el);
    return el;
  });

  // ---------- render ----------
  // cover size, cached so the animation loop never has to read layout
  let size = 0;
  function measure() { size = items[0].offsetWidth || 300; }

  function render() {
    const gap = size * 0.64;  // centre → first cover above/below
    const step = size * 0.28; // further covers
    const edge = N / 2;       // where a cover wraps round to the other side

    items.forEach((el, i) => {
      const d = wrap(i - pos);
      const a = Math.abs(d);
      const s = Math.sign(d);
      const y = s * (a <= 1 ? a * gap : gap + (a - 1) * step);
      const tilt = clamp(d, -1, 1) * 55;
      const z = -Math.min(a, 1) * size * 0.5;
      const fade = N > 2 ? clamp((edge - a) / 0.4, 0, 1) : 1; // hide the wrap-around jump
      const light = 1 - Math.min(a, 1) * 0.45;

      const transform = `translateY(${y}px) translateZ(${z}px) rotateX(${tilt}deg)`;
      // darken covers away from the centre with a black layer: animating its
      // opacity is far cheaper on phones than a brightness() filter
      const shade = 1 - light;
      el.style.transform = transform;
      el.style.opacity = fade;
      el.shade.style.opacity = shade;
      // mirror about the cover's bottom edge, in the cover's own tilted plane
      el.reflection.style.transform = `${transform} translateY(${size + 4}px) scaleY(-1)`;
      el.reflection.style.opacity = fade;
      el.reflection.shade.style.opacity = shade;
      el.style.zIndex = Math.round(100 - a * 10);
      el.style.pointerEvents = fade < 0.5 ? "none" : "";
      el.classList.toggle("is-current", a < 0.5);
    });
  }

  function tick(now) {
    const dt = Math.min(64, now - (last || now));
    last = now;
    // frame-rate independent ease towards target
    const k = reduceMotion ? 1 : 1 - Math.pow(1 - 0.14, dt / 16.67);
    pos += (target - pos) * k;
    if (Math.abs(target - pos) < 0.0005) pos = target;
    render();
    if (pos !== target || dragging) raf = requestAnimationFrame(tick);
    else { raf = 0; last = 0; if (switchPending) switchTrack(); }
  }
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }

  function setTarget(t) {
    target = t;
    const idx = mod(Math.round(target), N);
    if (idx !== current) onSelect(idx);
    kick();
  }
  function goTo(t) { setTarget(Math.round(t)); }

  // ---------- band description ----------
  const info = document.getElementById("info");
  let infoTimer = 0;
  function showInfo(key) {
    const b = BANDS[key];
    const fill = () => {
      info.dataset.band = key; // per-band font styling lives in style.css
      const name = document.getElementById("info-name");
      name.textContent = b.name;
      if (b.badge) name.insertAdjacentHTML("beforeend", `<img class="info-badge" src="${b.badge}" alt="">`);
      document.getElementById("info-about").textContent = b.about || "";
      const link = document.getElementById("info-link");
      link.href = b.url;
      link.textContent = `${b.name} webpage`;
      info.style.setProperty("--accent", b.accent);
      info.classList.remove("is-changing");
    };
    clearTimeout(infoTimer);
    if (current === -1 || reduceMotion) return fill();
    info.classList.add("is-changing");
    infoTimer = setTimeout(fill, 180);
  }

  // ---------- playback ----------
  // Web Audio: each preview is fetched and decoded once up front, then played
  // from memory. Starting, switching and fading run on the audio thread, so
  // the cover animation keeps the main thread to itself (an <audio> element
  // made scrolling stutter on iPhone). Previews loop.
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  // iOS 16.4+: play even when the ringer switch is on silent, like <audio> does
  try { navigator.audioSession.type = "playback"; } catch {}
  const master = ctx.createGain();
  master.connect(ctx.destination);

  // decode one at a time so page load isn't one big CPU spike
  let chain = Promise.resolve();
  const buffers = TRACKS.map((t) => {
    if (!t.src) return Promise.resolve(null);
    const data = fetch(t.src).then((r) => r.arrayBuffer());
    const decoded = chain.then(() => data).then((d) =>
      new Promise((res, rej) => ctx.decodeAudioData(d, res, rej))).catch(() => null);
    chain = decoded;
    return decoded;
  });

  // Browsers only allow sound after the visitor has clicked, tapped or pressed
  // a key, so hover stays silent until then. Captured so it runs before the
  // cover's own click handler.
  let unlocked = false;
  const unlock = () => { unlocked = true; if (ctx.state !== "running") ctx.resume(); };
  ["click", "touchend", "keydown"].forEach((t) => window.addEventListener(t, unlock, true));

  let hovering = false;
  let voice = null; // what's playing: { idx, source, gain }
  let request = 0;  // bumped on every start/stop so a late decode can't start a stale track

  // fade out and drop whatever is playing
  function release(fade) {
    if (!voice) return;
    const { source, gain } = voice, now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
    source.stop(now + fade + 0.05);
    voice = null;
  }
  function stop(fade = 0.3) { request++; release(fade); }
  function start(idx, fade = 0.4) {
    if (!unlocked) return;
    if (voice && voice.idx === idx) return;
    const req = ++request;
    buffers[idx].then((buf) => {
      if (req !== request) return;
      if (!buf) return stop();
      if (ctx.state !== "running") ctx.resume();
      release(fade); // crossfade out whatever was playing
      const gain = ctx.createGain(), now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
      gain.connect(master);
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      source.connect(gain);
      source.start();
      voice = { idx, source, gain };
    });
  }
  const preview = (idx) => start(idx, 0.4);

  // While music plays, the track only changes once the covers come to rest;
  // until then the previous track keeps playing.
  let switchPending = false;
  function onSelect(idx) {
    showInfo(TRACKS[idx].band);
    current = idx;
    // mouse resting on the centre: follow whichever band scrolls into it
    if (hovering || voice) switchPending = true;
  }
  function switchTrack() {
    switchPending = false;
    start(current, hovering ? 0.4 : 0.25);
  }
  function togglePlay() {
    switchPending = false;
    if (voice && voice.idx === current) stop(0.2);
    else start(current, 0.15);
  }
  // mute toggle, remembered for this visitor
  const muteBtn = document.getElementById("mute");
  let muted = false;
  function setMuted(m) {
    muted = m;
    master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.03);
    muteBtn.setAttribute("aria-pressed", m);
    muteBtn.setAttribute("aria-label", m ? "Unmute" : "Mute");
    try { localStorage.setItem("ongaku-muted", m ? "1" : ""); } catch {}
  }
  try { setMuted(localStorage.getItem("ongaku-muted") === "1"); } catch { setMuted(false); }
  muteBtn.addEventListener("click", () => setMuted(!muted));


  // ---------- settling ----------
  // After a scroll/drag gesture, land on a cover. A small nudge still moves
  // one cover in that direction, so a single wheel click always advances.
  let gestureBase = 0, settleTimer = 0;
  function startGesture() { if (!settleTimer && !dragging) gestureBase = Math.round(target); }
  function settle() {
    settleTimer = 0;
    const moved = target - gestureBase;
    if (Math.abs(moved) > 0.01 && Math.abs(moved) < 0.5) goTo(gestureBase + Math.sign(moved));
    else goTo(target);
  }

  // ---------- wheel / trackpad (anywhere on the page) ----------
  window.addEventListener("wheel", (e) => {
    e.preventDefault();
    startGesture();
    let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) delta *= 33;         // lines → px
    else if (e.deltaMode === 2) delta *= 600;   // pages → px
    const perCover = size * 0.9;
    setTarget(target + clamp(delta, -perCover, perCover) / perCover);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 130);
  }, { passive: false });

  // ---------- drag / swipe ----------
  let dragging = false, startY = 0, startTarget = 0, lastY = 0, lastT = 0, vel = 0;
  flow.addEventListener("pointerdown", (e) => {
    clearTimeout(settleTimer); settleTimer = 0;
    dragging = true;
    gestureBase = Math.round(target);
    startY = lastY = e.clientY;
    startTarget = target;
    lastT = e.timeStamp;
    vel = 0;
    delete flow.dataset.dragged;
    kick();
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const perCover = size * 0.7;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) flow.dataset.dragged = 1;
    const dt = Math.max(1, e.timeStamp - lastT);
    vel = 0.8 * vel + 0.2 * ((e.clientY - lastY) / dt); // px/ms, smoothed
    lastY = e.clientY; lastT = e.timeStamp;
    target = startTarget - dy / perCover;
    pos = target; // follow the finger 1:1
    const idx = mod(Math.round(target), N);
    if (idx !== current) onSelect(idx);
    kick(); // drawn in tick(), once per screen refresh
  });
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    checkHover();
    // fling: carry some momentum before landing
    const perCover = size * 0.7;
    target -= (vel * 220) / perCover;
    settle();
    // let the click handler see the drag flag, then clear it
    setTimeout(() => delete flow.dataset.dragged, 0);
  });

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { goTo(Math.round(target) + 1); e.preventDefault(); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft")    { goTo(Math.round(target) - 1); e.preventDefault(); }
    if ((e.key === " " || e.key === "Enter") && !e.target.closest("button, a")) { togglePlay(); e.preventDefault(); }
  });

  // ---------- hover ----------
  // Hovering the centre cover starts its preview; it keeps playing after the
  // mouse leaves (click the centre cover or mute to stop). Only the centre counts. It's judged by where the mouse is on
  // screen, not which element is under it, so the tilted covers above/below
  // and covers sliding past a still mouse never swap the sound.
  let mouse = null;
  function overCentre() {
    if (!mouse) return false;
    const r = flow.getBoundingClientRect();
    const half = size / 2;
    return Math.abs(mouse.x - (r.left + r.width / 2)) <= half &&
           Math.abs(mouse.y - (r.top + r.height / 2)) <= half;
  }
  function checkHover() {
    const on = overCentre() && !dragging;
    if (on === !!hovering) return;
    hovering = on;
    if (on) preview(current);
  }
  // mouse only: touch screens send pointer events on tap too
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    mouse = { x: e.clientX, y: e.clientY };
    checkHover();
  });
  document.documentElement.addEventListener("pointerleave", () => { mouse = null; checkHover(); });
  window.addEventListener("blur", () => { mouse = null; checkHover(); });

  window.addEventListener("resize", () => { measure(); render(); });
  measure();
  onSelect(0);
  render();
})();
