import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHORTCUTS, allowsShortcut, shortcutForCode, shortcutNotice } from '../src/shortcuts.js';

const range = { tagName: 'INPUT', type: 'range' };
const event = (code, target = range) => ({ code, target });

test('every shortcut is available from a focused range slider', () => {
  for (const shortcut of SHORTCUTS) assert.equal(allowsShortcut(event(shortcut.code)), true, shortcut.code);
});

test('slider editing keys remain native and have no shortcut action', () => {
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
    assert.equal(allowsShortcut(event(code)), false, code);
    assert.equal(shortcutForCode(code), undefined);
  }
});

test('text-like fields and editable descendants swallow all shortcuts', () => {
  for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'search' },
    { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'SPAN', isContentEditable: true }]) {
    for (const shortcut of SHORTCUTS) assert.equal(allowsShortcut(event(shortcut.code, target)), false);
  }
});

test('Space on a button retains native activation, while letters still work', () => {
  const button = { tagName: 'BUTTON', closest: () => ({}) };
  assert.equal(allowsShortcut(event('Space', button)), false);
  assert.equal(allowsShortcut(event('KeyP', button)), true);
  assert.equal(allowsShortcut({ ...event('KeyP'), ctrlKey: true }), false);
  assert.equal(allowsShortcut({ ...event('KeyP'), isComposing: true }), false);
});

test('help permits only Slash while Escape and camera keys retain no shortcut action', () => {
  const target = { tagName: 'BUTTON', ownerDocument: {
    querySelector: selector => selector === '.help-dialog[open]' ? {} : null,
  } };
  for (const shortcut of SHORTCUTS) {
    assert.equal(allowsShortcut(event(shortcut.code, target)), shortcut.code === 'Slash', shortcut.code);
  }
});

test('README includes every unique shortcut from the shared table', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.equal(new Set(SHORTCUTS.map(s => s.code)).size, SHORTCUTS.length);
  for (const shortcut of SHORTCUTS) {
    assert.ok(readme.includes(`| ${shortcut.label} | ${shortcut.description} |`), shortcut.code);
    assert.equal(shortcutForCode(shortcut.code), shortcut);
  }
});

test('one-line reminder uses only the marked entries and their compact descriptions', () => {
  const selected = SHORTCUTS.filter(shortcut => shortcut.reminder);
  assert.ok(selected.length > 0 && selected.length < SHORTCUTS.length);
  assert.equal(shortcutNotice(), 'C cinematic · F fly · P probe · Space pause · R reset');
});
