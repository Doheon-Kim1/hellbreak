/* Mounted scheduling regression oracle: actual source functions, reconciler, rig and Three.
 * Run: node test-support/network-render-repro.cjs --production
 * A renderer adapter checks transforms at draw boundaries, not GPU pixels or live physics.
 * --production loads installed R3F's production bundle; React act is not used.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createRequire } = Module;
const repo = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || require('node:os').tmpdir(), 'hellbreak-network-render-'));
// Source/transpiler setup can fail before the asynchronous regression runner starts.
process.once('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const registeredRoots = [];
const requireRepo = createRequire(path.join(repo, 'package.json'));
if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';
// EventTarget adapters only support effect registration. No pointer/input events are sent.
const documentAdapter = new EventTarget();
documentAdapter.createElement = () => { throw new Error('No browser DOM available in this probe'); };
documentAdapter.pointerLockElement = null;
documentAdapter.visibilityState = 'visible';
const windowAdapter = new EventTarget();
windowAdapter.document = documentAdapter;
windowAdapter.devicePixelRatio = 1;
globalThis.window = windowAdapter;
globalThis.document = documentAdapter;
// Make installed R3F choose exactly the browser useLayoutEffect registration branch.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = requireRepo('react');
const Fiber = requireRepo('@react-three/fiber');
const THREE = requireRepo('three');
const ts = requireRepo('typescript');
requireRepo('tsx/cjs');
const withCharacter = true;
const characterPath = path.join(repo, 'src/components/PlayerCharacter.tsx');
const characterScratchPath = path.join(scratch, 'PlayerCharacter.cjs');
if (withCharacter) {
  const characterCode = ts.transpileModule(fs.readFileSync(characterPath, 'utf8'), {
    fileName: characterPath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  fs.writeFileSync(characterScratchPath, characterCode);
  const characterModule = new Module(characterPath, module);
  characterModule.filename = characterPath;
  characterModule.paths = Module._nodeModulePaths(path.dirname(characterPath));
  characterModule._compile(characterCode, characterPath);
  // Preserve original relative imports without writing anything into the repository.
  require.cache[characterScratchPath] = characterModule;
}
const sourcePath = path.join(repo, 'src/components/HellbreakGame.tsx');
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['createCharacterFrame', 'createCharacterAnchorRegistries', 'GameCamera', 'NetworkAvatar'];
const selected = names.map(name => {
  const node = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert(node, `Missing production function: ${name}`);
  return node.getText(source);
});
const selectedConstants = ['SPAWN'];
const constants = selectedConstants.map(name => {
  const statement = source.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(source) === name));
  assert(statement, `Missing production constant: ${name}`);
  return statement.getText(source);
});
const dependencyHeader = `
import { useMemo, useRef, useEffect, useLayoutEffect, createElement } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
const { DEFAULT_CAMERA_ORBIT, MAX_POINTER_LOOK_DELTA, cameraAimDirection, cameraAimOrigin,
  isUsableInitialPointerLookDelta, requestPointerLockSafely, rotateMovementByCamera,
  updateCameraOrbitInPlace } = require(${JSON.stringify(path.join(repo, 'src/game/camera.ts'))});
const { setRunnerControlSource } = require(${JSON.stringify(path.join(repo, 'src/game/controls.ts'))});
const { interpolateNetworkPosition, NETWORK_SNAP_DISTANCE } = require(${JSON.stringify(path.join(repo, 'src/network/interpolation.ts'))});
const characterFrames = new Map();
const suspendedCharacters = new Map();
const ActualPlayerCharacter = ${withCharacter ? `require(${JSON.stringify(characterScratchPath)}).PlayerCharacter` : 'null'};
// Capture the production frame ref. Optional full cosmetic rig uses its actual unchanged module.
function PlayerCharacter(props) {
  characterFrames.set(props.playerId, props.frame);
  const gate = suspendedCharacters.get(props.playerId);
  if (gate) { gate.reached += 1; throw gate.pending; }
  return ActualPlayerCharacter ? createElement(ActualPlayerCharacter, props) : null;
}
// Production callbacks only use this for spectators or a nonempty structure grip ID.
function botPoseAt() { throw new Error('Spectator outside this seam'); }
function gripAnchorById() { throw new Error('Structure grip outside this seam'); }
`;
const extracted = dependencyHeader + '\n' + constants.join('\n') + '\n' + selected.join('\n\n') + '\nexport { NetworkAvatar, createCharacterAnchorRegistries, characterFrames, suspendedCharacters, SPAWN };\n';
const extractedPath = path.join(scratch, 'production-seam.tsx');
fs.writeFileSync(extractedPath, extracted);
const compiled = ts.transpileModule(extracted, {
  fileName: extractedPath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const compiledPath = path.join(scratch, 'production-seam.cjs');
fs.writeFileSync(compiledPath, compiled);
const seamModule = new Module(compiledPath, module);
seamModule.filename = compiledPath;
seamModule.paths = Module._nodeModulePaths(repo);
seamModule._compile(compiled, compiledPath);
const { GameCamera, NetworkAvatar, createCharacterAnchorRegistries, characterFrames, suspendedCharacters, SPAWN } = seamModule.exports;
const { DEFAULT_CAMERA_ORBIT, cameraAimOrigin } = requireRepo(path.join(repo, 'src/game/camera.ts'));
Fiber.extend(THREE);
const h = React.createElement;
const frameOutput = [];
const scenarios = [];
const vec = v => v.toArray().map(x => Number(x.toFixed(12)));
const round = n => Number(n.toFixed(12));

async function makeCase(label, initialX = SPAWN.x, isOwn = true) {
  const canvas = new EventTarget();
  Object.assign(canvas, { dataset: {}, style: {}, focus() {}, hasPointerCapture() { return false; } });
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  const stateHolder = {};
  const ownPosition = { current: new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z) };
  const orbit = { current: { ...DEFAULT_CAMERA_ORBIT } };
  const anchors = createCharacterAnchorRegistries();
  const controls = {
    blocked: { current: false }, input: { current: requireRepo(path.join(repo, 'src/game/controls.ts')).createRunnerControlSources() },
    settings: { current: { sensitivity: 1, invertY: false } },
  };
  const id = label;
  let time = 0;
  let snapshotElapsed = -0.05;
  let renderVersion = 0;
  let committedVersion = 0;
  let publishTransition;
  let phase = '';
  let duringCommit = false;
  const logs = [];
  const drawLogs = [];
  const renderer = {
    domElement: canvas,
    setSize() {}, setPixelRatio() {},
    render(scene, cam) {
      // Explicit negative control: callbacks keep running but no new adapter draw is recorded.
      if (process.argv.includes('--suppress-after-warmup') && drawLogs.length > 0) return;
      // Real scene and camera transforms observed at installed R3F's actual draw boundary.
      scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      const group = scene.children.find(child => child.type === 'Group');
      assert(group instanceof THREE.Group, 'Expected actual reconciled Three.Group');
      const expected = cameraAimOrigin(group.position, orbit.current, new THREE.Vector3());
      const cameraDirection = cam.getWorldDirection(new THREE.Vector3());
      const error = cam.position.distanceTo(expected);
      const rig = group.getObjectByName(`infernal-climber:${id}`);
      const row = {
        scenario: label, phase, atLayoutCommit: duringCommit,
        actor: vec(group.position), ownRef: vec(ownPosition.current),
        ownRefAliasesActor: ownPosition.current === group.position,
        camera: vec(cam.position), expectedBoom: vec(expected), boomError: round(error),
        cameraDirection: vec(cameraDirection),
        velocityX: round(characterFrames.get(id).current.velocityX),
        rigPose: rig?.userData.pose, rigBodyRotation: rig?.children[0]?.rotation.x,
        actorVisible: group.visible, rigVisible: rig?.visible,
      };
      drawLogs.push(row); frameOutput.push(row);
    },
  };
  const root = Fiber.createRoot(canvas);
  registeredRoots.push(root);
  await root.configure({ gl: renderer, camera, frameloop: 'never', dpr: 1, size: { width: 960, height: 540 } });
  const state = Fiber._roots.get(canvas).store.getState();
  stateHolder.state = state;
  function advance(labelForFrame, isCommit = false, delta = 1 / 60) {
    phase = labelForFrame; duringCommit = isCommit;
    time += delta;
    const subscribers = state.internal.subscribers;
    const originals = subscribers.map(s => s.ref.current);
    subscribers.forEach((subscription, index) => {
      const fn = originals[index];
      const name = fn.toString().includes('interpolateNetworkPosition') ? 'NetworkAvatar' : fn.toString().includes("mode === 'spectator'") ? 'GameCamera' : fn.toString().includes('updatePlayerCharacterPose') ? 'PlayerCharacter' : 'unexpected';
      subscription.ref.current = (...args) => {
        const group = state.scene.children.find(child => child.type === 'Group');
        const before = vec(group.position);
        logs.push({ phase, name, priority: subscription.priority, actorBefore: before });
        const result = fn(...args);
        logs[logs.length - 1].actorAfter = vec(group.position);
        return result;
      };
    });
    try {
      const beforeDraws = drawLogs.length;
      state.advance(time, false);
      assert.equal(drawLogs.length, beforeDraws + 1,
        `Fresh renderer-adapter draw required for ${labelForFrame}`);
      const row = drawLogs[beforeDraws];
      assert.equal(row.phase, labelForFrame, 'Draw belongs to a different advance phase');
      const group = state.scene.children.find(child => child.type === 'Group');
      const rig = group.getObjectByName(`infernal-climber:${id}`);
      assert.deepEqual(row.actor, vec(group.position), 'Actor evidence must come from this draw');
      assert.equal(row.rigPose, rig.userData.pose, 'Rig evidence must come from this draw');
      assert.equal(row.rigBodyRotation, rig.children[0].rotation.x, 'Rig transform must come from this draw');
      return row;
    }
    finally { subscribers.forEach((s, i) => { s.ref.current = originals[i]; }); duringCommit = false; }
  }
  function LayoutFrame({ token, version }) {
    React.useLayoutEffect(() => {
      committedVersion = version;
      if (token) advance('frame-between-commit-and-passive-effect', true);
    }, [token, version]);
    return null;
  }
  function tree(x, token, snapshot) {
    // Relative sibling order is exactly NetworkTower: GameCamera, players.map(NetworkAvatar).
    const player = {
      id, x, y: SPAWN.y, z: SPAWN.z, alive: true, grounded: true,
      escaped: false, velocityY: 0, grabTargetId: '', grabbedById: '', structureGripAnchorId: '',
      ...snapshot,
    };
    return h(React.Suspense, { fallback: null }, h(React.Fragment, null,
      h(GameCamera, { mode: 'network', active: true, playerPosition: null,
        networkTarget: ownPosition, orbit, controls, elapsed: 0, spectatorIndex: 0, resetToken: 0 }),
      [h(NetworkAvatar, { key: id, player, snapshotElapsed, isOwn, ownPosition, anchors,
        reducedMotion: snapshot.reducedMotion ?? false, onPose() {} })],
      h(LayoutFrame, { token, version: renderVersion }),
    ));
  }
  async function render(x, token = 0, snapshot = {}) {
    if (publishTransition) publishTransition(null);
    snapshotElapsed = snapshot.snapshotElapsed ?? snapshotElapsed + 0.05;
    const expectedVersion = ++renderVersion;
    if (process.env.NODE_ENV === 'production') {
      root.render(h(Scenario, { x, token, snapshot }));
      // Real production React scheduler, bounded until this exact commit's layout marker.
      await Promise.resolve();
      for (let attempts = 0; committedVersion !== expectedVersion && attempts < 20; attempts++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(committedVersion, expectedVersion, 'Production React commit did not complete');
      Fiber.reconciler.flushPassiveEffects();
    } else {
      await Fiber.act(async () => { root.render(h(Scenario, { x, token, snapshot })); });
    }
  }
  function Scenario({ x, token, snapshot }) {
    const [pending, setPending] = React.useState(null);
    React.useLayoutEffect(() => { publishTransition = setPending; }, []);
    return tree(pending ? initialX + 3 : x, token, pending ?? snapshot);
  }
  await render(initialX);
  assert.equal(state.internal.subscribers.length, withCharacter ? 3 : 2);
  assert.equal(state.internal.priority, 0, 'Automatic render must remain enabled');
  scenarios.push({ scenario: label, initialX, subscribers: state.internal.subscribers.map(s => ({
    priority: s.priority, callback: s.ref.current.toString().includes('interpolateNetworkPosition') ? 'NetworkAvatar' : s.ref.current.toString().includes('updatePlayerCharacterPose') ? 'PlayerCharacter' : 'GameCamera',
  })) });
  async function suspend(snapshot) {
    const gate = { reached: 0, pending: new Promise(() => {}) };
    suspendedCharacters.set(id, gate);
    snapshotElapsed += 0.05; renderVersion += 1;
    React.startTransition(() => publishTransition(snapshot));
    for (let attempts = 0; gate.reached === 0 && attempts < 100; attempts++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert(gate.reached > 0, 'Uncommitted update must reach the actual avatar child before suspending');
    return gate;
  }
  return { state, camera, ownPosition, orbit, render, advance, suspend, logs, drawLogs, label, root };
}

(async () => {
  const results = [];
  try {
  async function check(name, test) {
    try { await test(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  async function mounted(name, x = SPAWN.x, own = true) {
    return makeCase(name, x, own);
  }
  const actor = test => test.state.scene.children.find(child => child.type === 'Group');
  const aligned = test => assert(test.drawLogs.at(-1).boomError < 1e-10,
    `camera/body same-draw mismatch: ${test.drawLogs.at(-1).boomError}m`);
  await check('first owned draw away from spawn', async () => {
    const test = await mounted('first-owner', SPAWN.x + 2);
    test.advance('first-frame'); aligned(test);
    assert.equal(test.state.internal.priority, 0, 'must retain automatic rendering');
  });
  await check('snapshot commit cannot bypass the sole body frame owner', async () => {
    const test = await mounted('owned-walk'); test.advance('warmup');
    const before = actor(test).position.x;
    await test.render(SPAWN.x + .29);
    assert.equal(actor(test).position.x, before, 'JSX reset body before the motion callback');
    test.advance('walk');
    assert.equal(actor(test).position.x, SPAWN.x + .29, 'own body must use latest authoritative snapshot');
    assert(characterFrames.get(test.label).current.velocityX > 0, 'genuine walking became zero/backward velocity');
    assert.equal(actor(test).getObjectByName(`infernal-climber:${test.label}`).userData.pose, 'run', 'actual rig did not apply run');
    aligned(test);
  });
  await check('layout draw cannot follow a stale passive target', async () => {
    const test = await mounted('layout-walk'); test.advance('warmup');
    await test.render(SPAWN.x + .29, 1);
    assert.equal(actor(test).position.x, SPAWN.x + .29, 'layout frame followed stale target');
    assert(characterFrames.get(test.label).current.velocityX > 0, 'backwards/zero layout-frame velocity');
    aligned(test);
    test.advance('following-frame'); aligned(test);
  });
  await check('remote motion is smoothed by the real frame callback, not JSX', async () => {
    const test = await mounted('remote-walk', SPAWN.x, false); test.advance('warmup');
    await test.render(SPAWN.x + .29);
    assert.equal(actor(test).position.x, SPAWN.x, 'remote snapped during JSX commit');
    test.advance('remote-step');
    assert(actor(test).position.x > SPAWN.x && actor(test).position.x < SPAWN.x + .29);
    assert(characterFrames.get(test.label).current.velocityX > 0);
  });
  await check('legitimate owned one-second walking frame is not a teleport', async () => {
    const test = await mounted('slow-owner'); test.advance('warmup');
    await test.render(SPAWN.x + 5.8, 0, { snapshotElapsed: 1 }); test.advance('slow-walk', false, 1);
    assert(characterFrames.get(test.label).current.velocityX > 0, '5.8m/1s motion suppressed');
    assert.equal(actor(test).getObjectByName(`infernal-climber:${test.label}`).userData.pose, 'run');
    aligned(test);
  });
  await check('legitimate remote one-second walking frame stays positive', async () => {
    const test = await mounted('slow-remote', SPAWN.x, false); test.advance('warmup');
    await test.render(SPAWN.x + 5.8, 0, { snapshotElapsed: 1 }); test.advance('slow-remote-walk', false, 1);
    assert(characterFrames.get(test.label).current.velocityX > 0, 'remote normal slow motion suppressed');
  });
  await check('large restart snap is not fabricated running', async () => {
    const test = await mounted('restart'); test.advance('warmup');
    await test.render(SPAWN.x + 20); test.advance('restart-frame');
    assert.equal(characterFrames.get(test.label).current.velocityX, 0);
    assert.equal(actor(test).getObjectByName(`infernal-climber:${test.label}`).userData.pose, 'idle');
    aligned(test);
  });
  await check('owned gait remains continuous between authoritative patches and stops on a stationary patch', async () => {
    const test = await mounted('continuous-owner'); test.advance('warmup');
    await test.render(SPAWN.x + .29); test.advance('moving-snapshot');
    for (let i = 0; i < 3; i++) {
      test.advance('between-moving-patches');
      assert(characterFrames.get(test.label).current.velocityX > 0, 'motion vanished between server patches');
      assert.equal(actor(test).getObjectByName(`infernal-climber:${test.label}`).userData.pose, 'run');
      aligned(test);
    }
    await test.render(SPAWN.x + .29); test.advance('stationary-new-patch');
    assert.equal(characterFrames.get(test.label).current.velocityX, 0, 'stationary authoritative patch must stop gait');
    assert.equal(actor(test).getObjectByName(`infernal-climber:${test.label}`).userData.pose, 'idle');
  });
  await check('owned ascent uses published vertical velocity between patches, then follows descent', async () => {
    const test = await mounted('ascending-owner'); test.advance('warmup');
    await test.render(SPAWN.x, 0, { y: SPAWN.y + .3, grounded: false, velocityY: 6.5 });
    test.advance('takeoff-snapshot');
    for (let i = 0; i < 3; i++) {
      test.advance('between-ascent-patches');
      assert.equal(characterFrames.get(test.label).current.velocityY, 6.5, 'authoritative ascent became a false fall');
      const rig = actor(test).getObjectByName(`infernal-climber:${test.label}`);
      assert.equal(rig.children[0].rotation.x, .1, 'actual jump body switched to fall');
      aligned(test);
    }
    await test.render(SPAWN.x, 0, { y: SPAWN.y + .4, grounded: false, velocityY: -1 });
    test.advance('descent-snapshot'); test.advance('between-descent-patches');
    assert.equal(characterFrames.get(test.label).current.velocityY, -1);
  });
  await check('suspended and abandoned snapshots cannot reach the committed rig', async () => {
    const test = await mounted('suspended-owner');
    const warm = test.advance('warmup');
    assert.equal(warm.rigPose, 'idle');
    await test.suspend({ grounded: false, alive: false, escaped: true, reducedMotion: true,
      grabTargetId: 'uncommitted-partner' });
    try {
      const row = test.advance('draw-during-uncommitted-update');
      assert.equal(row.actorVisible, true, 'Committed actor must remain visible while transition suspends');
      assert.equal(row.rigVisible, true, 'Committed rig must remain visible while transition suspends');
      assert.equal(row.rigPose, 'idle', 'Uncommitted snapshot reached the actual committed rig');
      const frame = characterFrames.get(test.label).current;
      assert.deepEqual([frame.grounded, frame.alive, frame.escaped, frame.reducedMotion, frame.rescueRole],
        [true, true, false, false, 'none']);
    } finally {
      suspendedCharacters.delete(test.label);
      await test.render(SPAWN.x);
    }
    const abandoned = test.advance('draw-after-abandoned-update');
    assert.equal(abandoned.rigPose, 'idle');
    aligned(test);
  });
  const failed = results.filter(result => !result.passed);
  console.log('NETWORK_RENDER_REGRESSIONS', JSON.stringify({ results, passed: results.length-failed.length,
    failed: failed.length, limits: 'Actual installed reconciler and production callbacks/rig/Three; controlled snapshot inputs, no GPU pixels or live server physics.' }));
  if (failed.length) process.exitCode = 1;
  } finally {
    for (const root of registeredRoots) root.unmount();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
