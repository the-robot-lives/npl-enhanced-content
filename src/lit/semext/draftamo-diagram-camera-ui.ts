/**
 * draftamo-diagram-camera-ui — S4 (THEROB-169) camera toolbar for
 * semext-draftamo-diagram's mounted 3D viewer.
 *
 * Purpose: build every control that drives the viewer's camera — reset,
 *   fit, fly/orbit toggle, preset menu, keyboard help — plus the
 *   `prefers-reduced-motion` probe shared with the element's input feed.
 * Owns: toolbar DOM only. The element owns mounting, teardown, focus and
 *   the `viewer.keys` / `wheelFly` input feed (the bundle attaches no
 *   keyboard or fly-wheel listeners of its own).
 * Works with: draftamo-diagram-3d-adapter (ViewerInstance, CameraMotion,
 *   CameraPreset); semext-draftamo-diagram (chrome lifecycle).
 * Invariants: EVERY camera call is feature-detected — `viewer-src` is
 *   version-pinned, so an older bundle may lack a method; hide that
 *   control, never render a dead button. Camera failures warn, never
 *   throw out of a click handler. Controls are real buttons/select
 *   (keyboard-operable by default). The five named presets are NOT
 *   exported by the v0.2.0 bundle (they live in trd-3d's buildTrd3dScene),
 *   so the preset menu stays hidden until a bundle ships `setCameraPose`.
 * Refreshed: 2026-11-24
 */

import type { CameraMotion, CameraPreset, ViewerInstance } from './draftamo-diagram-3d-adapter.js';

/** Preset menu entries — rendered only when the bundle exports `setCameraPose`. */
export const CAM_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'focus', label: 'Focus' },
];

let helpSeq = 0;

/** `prefers-reduced-motion`: camera motions jump instead of easing. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Build the camera toolbar for a mounted viewer instance. Returns null when
 * the instance exposes no camera surface at all (no dead chrome).
 */
export function buildCameraToolbar(viewer: ViewerInstance): HTMLElement | null {
  const bar = document.createElement('div');
  bar.className = 'semext-draftamo-diagram-cameras';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Diagram camera controls');
  bar.style.cssText = 'position:absolute;top:6px;left:6px;z-index:10;display:flex;gap:4px;align-items:center;'
    + 'font:.75rem system-ui,sans-serif;background:rgba(255,255,255,.85);border:1px solid rgba(0,0,0,.15);'
    + 'border-radius:6px;padding:2px 4px;';
  const motion: CameraMotion = { animate: !reducedMotion() };
  const act = <A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A): void => {
    if (!fn) return;
    try { fn(...args); } catch (err) { console.warn('semext-draftamo-diagram: camera action failed.', err); }
  };
  const button = (label: string, title: string, show: boolean, on: () => void): HTMLButtonElement | null => {
    if (!show) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'semext-draftamo-diagram-cam';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.cssText = 'min-width:24px;padding:1px 6px;cursor:pointer;';
    b.addEventListener('click', on);
    bar.append(b);
    return b;
  };

  // Reset: restore world-up (resetCameraPose), then re-frame the whole model.
  button(
    '⟲',
    'Reset camera view',
    typeof viewer.resetCameraPose === 'function' && typeof viewer.frameTo === 'function',
    () => { act(viewer.resetCameraPose); act(viewer.frameTo, null, motion); },
  );
  // Fit: frameTo(null) computes + tweens the whole-model pose.
  button('⤢', 'Fit diagram in view', typeof viewer.frameTo === 'function', () => act(viewer.frameTo, null, motion));

  let fly: HTMLButtonElement | null = null;
  if (typeof viewer.setCameraMode === 'function') {
    let flying = false;
    const paint = (): void => {
      fly!.textContent = flying ? 'Orbit' : 'Fly';
      fly!.title = flying ? 'Switch to orbit camera' : 'Switch to fly camera';
      fly!.setAttribute('aria-label', fly!.title);
      fly!.setAttribute('aria-pressed', String(flying));
    };
    fly = button('', '', true, () => {
      flying = !flying;
      act(viewer.setCameraMode, flying ? 'fly' : 'orbit');
      paint();
    });
    paint();
  }

  if (typeof viewer.setCameraPose === 'function') {
    const sel = document.createElement('select');
    sel.className = 'semext-draftamo-diagram-cam';
    sel.setAttribute('aria-label', 'Camera preset');
    sel.style.cssText = 'padding:1px 2px;cursor:pointer;';
    for (const p of CAM_PRESETS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      if (sel.value) act(viewer.setCameraPose, sel.value as CameraPreset, motion);
    });
    bar.append(sel);
  }

  if (bar.children.length > 0) {
    const help = document.createElement('div');
    help.className = 'semext-draftamo-diagram-cam-help';
    const helpId = `semext-dd-help-${++helpSeq}`;
    help.id = helpId;
    help.hidden = true;
    help.style.cssText = 'padding:2px 4px;color:#444;max-width:34ch;';
    help.textContent = typeof viewer.setCameraMode === 'function'
      ? 'Drag to orbit · scroll to zoom · Fly: WASD move · E/R rise · Q sink · wheel dolly'
      : 'Drag to orbit · scroll to zoom';
    const btn = button('?', 'Camera keyboard help', true, () => {
      help.hidden = !help.hidden;
      btn!.setAttribute('aria-expanded', String(!help.hidden));
    });
    btn!.setAttribute('aria-expanded', 'false');
    btn!.setAttribute('aria-controls', helpId);
    bar.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Escape' && !help.hidden) {
        help.hidden = true;
        btn!.setAttribute('aria-expanded', 'false');
        btn!.focus();
      }
    });
    bar.append(help);
  }
  if (bar.children.length === 0) return null;
  return bar;
}
