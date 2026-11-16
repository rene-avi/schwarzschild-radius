export const SHORTCUTS = Object.freeze([
  { code: 'KeyC', action: 'cinematic', label: 'C', description: 'Toggle cinematic flight', reminder: 'cinematic' },
  { code: 'KeyF', action: 'fly', label: 'F', description: 'Toggle horizon approach', reminder: 'fly' },
  { code: 'KeyP', action: 'probe', label: 'P', description: 'Release or replace probe', reminder: 'probe' },
  { code: 'Space', action: 'pause', label: 'Space', description: 'Pause or resume simulation', reminder: 'pause' },
  { code: 'KeyR', action: 'reset', label: 'R', description: 'Reset camera, probe and clock', reminder: 'reset' },
  { code: 'KeyE', action: 'align', label: 'E', description: 'Align a background star' },
  { code: 'KeyH', action: 'hud', label: 'H', description: 'Hide or reveal HUD' },
  { code: 'Escape', action: 'orbit', label: 'Escape', description: 'Return to manual orbit' },
  { code: 'KeyW', action: 'thrustIn', label: 'W', description: 'Thrust inward', camera: true },
  { code: 'KeyS', action: 'thrustOut', label: 'S', description: 'Thrust outward', camera: true },
  { code: 'KeyA', action: 'steerLeft', label: 'A', description: 'Rotate left', camera: true },
  { code: 'KeyD', action: 'steerRight', label: 'D', description: 'Rotate right', camera: true },
  { code: 'Slash', action: 'help', label: '/', description: 'Toggle shortcuts and control reminder' },
].map(Object.freeze));

export const shortcutForCode = code => SHORTCUTS.find(shortcut => shortcut.code === code);
export const shortcutNotice = () => SHORTCUTS.filter(shortcut => shortcut.reminder)
  .map(shortcut => `${shortcut.label} ${shortcut.reminder}`).join(' · ');

const RANGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

// Preserve native editing and button activation while allowing shortcuts on sliders.
export function allowsShortcut(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const target = event.target;
  // Leave Escape to the native dialog; only Slash may toggle help while it is open.
  if (target?.ownerDocument?.querySelector('.help-dialog[open]')) return event.code === 'Slash';
  if (target?.isContentEditable) return false;
  if (target?.tagName === 'INPUT') {
    return target.type === 'range' && !RANGE_KEYS.has(event.code);
  }
  if (target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return false;
  if (event.code === 'Space' && target?.closest?.('button, [role="button"]')) return false;
  return true;
}
