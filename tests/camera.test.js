import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservatoryCamera, approachGaze } from '../src/camera.js';
import { Vector3 } from 'three';

function withCamera(run) {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const canvas = new EventTarget();
  canvas.setPointerCapture = () => {};
  const camera = new ObservatoryCamera(canvas);
  try { run(camera, canvas); }
  finally { camera.destroy(); globalThis.window = previous; }
}

const send = (canvas, type, id, x, y) => canvas.dispatchEvent(Object.assign(new Event(type), {
  pointerId: id, button: 0, clientX: x, clientY: y,
}));

test('fly clears either side of the tilted disk and turns away continuously', () => withCamera(camera => {
  for (const elevation of [-0.6, 0, 0.23, 1]) {
    for (const tilt of [-40, 8, 40]) {
      camera.setDisk(tilt, 0.85);
      camera.setCamera({ radius: 23, theta: 0.05, elevation, yaw: 0, pitch: 0 });
      const normal = new Vector3(0, Math.cos(tilt * Math.PI / 180), -Math.sin(tilt * Math.PI / 180));
      const side = camera.position.dot(normal) < 0 ? -1 : 1;
      camera.setMode('fly');
      let previousElevation = camera.elevation;
      let previousGaze = camera.gazePitch;
      let previousForward = camera.forward.clone();
      let samples = 0;
      for (let i = 0; i < 65 * 60; i++) {
        camera.update(1 / 60);
        const label = `elevation=${elevation}, tilt=${tilt}, r=${camera.radius}`;
        if (camera.radius > camera.diskInner && camera.radius < 8.3) {
          assert.ok(camera.position.dot(normal) * side >= camera.radius * Math.sin(20 * Math.PI / 180), label);
          samples++;
        }
        assert.ok(Math.abs(camera.elevation - previousElevation) <= 2 * Math.PI / 180, `elevation jump: ${label}`);
        assert.ok(Math.abs(camera.gazePitch - previousGaze) <= 2 * Math.PI / 180, `gaze jump: ${label}`);
        assert.ok(camera.forward.angleTo(previousForward) <= 2 * Math.PI / 180, `view jump: ${label}`);
        if (Math.abs(camera.gazePitch) > 0.1 && Math.abs(camera.gazePitch) < Math.PI - 0.1) {
          const transverse = camera.forward.clone().addScaledVector(camera.position, -camera.forward.dot(camera.position) / camera.radius ** 2);
          assert.ok(transverse.dot(normal) * side > 0, `gaze must turn away from the disk: ${label}`);
        }
        previousElevation = camera.elevation;
        previousGaze = camera.gazePitch;
        previousForward = camera.forward.clone();
      }
      assert.ok(samples > 0);
      assert.ok(Math.abs(Math.asin(camera.position.dot(normal) / camera.radius) - side * 8 * Math.PI / 180) < 1e-6);
    }
  }
}));

test('automatic gaze turns through up at the photon sphere and out at minimum', () => {
  assert.equal(approachGaze(8), 0);
  assert.equal(approachGaze(6), 0);
  assert.equal(approachGaze(1.5), Math.PI / 2);
  assert.equal(approachGaze(1.03), Math.PI);
  for (const r of [6, 1.5, 1.03]) {
    assert.ok(Math.abs(approachGaze(r + 1e-6) - approachGaze(r - 1e-6)) < 1e-4);
  }
});

test('fly thrust does not restart the disk-clearance easing', () => withCamera(camera => {
  camera.setMode('fly');
  for (let i = 0; i < 600; i++) camera.update(1 / 60);
  camera.keys.add('KeyW');
  const normal = new Vector3(0, Math.cos(camera.diskTilt), -Math.sin(camera.diskTilt));
  for (let i = 0; i < 180; i++) {
    camera.update(1 / 60);
    if (camera.radius > camera.diskInner && camera.radius < 8.3) {
      assert.ok(camera.position.dot(normal) >= camera.radius * Math.sin(20 * Math.PI / 180));
    }
  }
}));

test('camera basis stays orthonormal at straight in, up and straight out', () => withCamera(camera => {
  for (const pitch of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    for (const yaw of [0, Math.PI / 2, 3]) {
      camera.setCamera({ radius: 1.03, yaw, pitch });
      for (const axis of [camera.forward, camera.up, camera.right]) assert.ok(Math.abs(axis.length() - 1) < 1e-12);
      assert.ok(Math.abs(camera.forward.dot(camera.up)) < 1e-12);
      assert.ok(Math.abs(camera.forward.dot(camera.right)) < 1e-12);
      assert.ok(Math.abs(camera.up.dot(camera.right)) < 1e-12);
    }
  }
}));

test('fly reaches a finite hover, keeps free look, stops in place and resets', () => withCamera((camera, canvas) => {
  camera.setMode('fly');
  for (let i = 0; i < 1800; i++) camera.update(1 / 60);
  send(canvas, 'pointerdown', 1, 200, 200);
  send(canvas, 'pointermove', 1, 250, 240);
  send(canvas, 'pointerup', 1, 250, 240);
  camera.update(0);
  assert.equal(camera.mode, 'fly');
  assert.ok(Math.abs(camera.gazeYaw + 0.2) < 1e-12);
  assert.ok(Math.abs(camera.freePitch - 0.12) < 1e-12);
  camera.setMode('orbit');
  const stopped = camera.radius;
  const gaze = camera.gazePitch;
  for (let i = 0; i < 600; i++) camera.update(1 / 60);
  assert.equal(camera.radius, stopped);
  assert.equal(camera.gazePitch, gaze);
  camera.reset();
  camera.setMode('fly');
  for (let i = 0; i < 65 * 60; i++) camera.update(1 / 60);
  assert.equal(camera.radius, 1.03);
  assert.equal(camera.gazePitch, Math.PI);
  assert.ok(Math.abs(camera.shadowFraction - 0.9513) < 0.001);
  camera.reset();
  assert.equal(camera.radius, 23);
  assert.equal(camera.gazeYaw, 0);
  assert.equal(camera.gazePitch, 0);
}));

test('fly thrust remains effective after hovering and every lensing setting ends looking out', () => withCamera(camera => {
  for (const L of [0, 0.5, 1, 2]) {
    camera.setLensing(L);
    camera.reset();
    camera.setMode('fly');
    for (let i = 0; i < 65 * 60; i++) camera.update(1 / 60);
    assert.equal(camera.radius, camera.minimum);
    assert.equal(camera.gazePitch, Math.PI);
    camera.keys.add('KeyS');
    for (let i = 0; i < 120; i++) camera.update(1 / 60);
    camera.keys.clear();
    assert.ok(camera.radius > camera.minimum * 1.5, `S must thrust out at L=${L}`);
    assert.equal(camera.mode, 'fly');
  }
}));

test('starting fly near the hole eases the automatic gaze without a jump', () => withCamera(camera => {
  camera.setCamera({ radius: 2, yaw: 0, pitch: 0 });
  camera.setMode('fly');
  camera.update(0);
  assert.equal(camera.gazePitch, 0);
  camera.update(1 / 60);
  assert.ok(camera.gazePitch < 0.001);
  for (let i = 0; i < 120; i++) camera.update(1 / 60);
  assert.ok(camera.gazePitch > 1);
}));

test('wheel and two-pointer pinch share radius limits; one pointer resumes without jumps', () => withCamera((camera, canvas) => {
  send(canvas, 'pointerdown', 1, 160, 250);
  send(canvas, 'pointerdown', 2, 240, 250);
  send(canvas, 'pointermove', 1, 50, 250);
  send(canvas, 'pointermove', 2, 350, 250);
  for (let i = 0; i < 240; i++) camera.update(1 / 60);
  assert.ok(Math.abs(camera.radius - 23 * 80 / 300) < 1e-5);
  assert.equal(camera.theta, 0.05);
  send(canvas, 'pointerup', 2, 350, 250);
  send(canvas, 'pointermove', 1, 60, 250);
  assert.ok(Math.abs(camera.desiredTheta - 0.01) < 1e-12);
  camera.setLensing(2);
  camera.setCamera({ radius: 1.03 });
  assert.equal(camera.radius, 2.06);
  camera.zoom(0.001);
  camera.update(1);
  assert.equal(camera.radius, 2.06);
}));
