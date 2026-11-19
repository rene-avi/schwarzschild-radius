import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry, pixelRay, worldCoverage, traceWorldPixel, classifyWorldChanges } from './kerr-world-silhouettes.mjs';
import { traceWorld } from '../src/kerrworlds.js';
import { blRadius, traceRay } from '../src/kerrray.js';
import { GEODESIC } from '../src/geodesic.js';
import { kerrFragmentShader } from '../src/shaders/blackhole.js';
import { evaluate, functionBody, assignment, lastReturn } from './glsl-subset.mjs';

const worlds = [
  { id: 'lantern', orbitRadius: 6, radius: .18, phase: -.22507512341471048, drawn: true },
  { id: 'farShore', orbitRadius: 60, radius: .6, phase: 1.84, drawn: true },
];
const basis = geometry(), spin = .998;
const direct = [{ id: 'lantern', polygon: [{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}] }];

test('world classification accepts direct clusters and individually traced secondary clusters', () => {
  const directCluster = [{x:15,y:15},{x:21,y:15}];
  const secondaryCluster = [{x:631,y:658},{x:632,y:658}];
  const visited = [];
  const result = classifyWorldChanges([...directCluster, ...secondaryCluster], direct, p => {
    visited.push(p);
    return { id: 'farShore', coverage: 1, delay: 90.7 };
  });
  assert.equal(result.direct, 2);
  assert.deepEqual(visited, secondaryCluster);
  assert.deepEqual(result.confirmed.map(p => p.id), ['farShore','farShore']);
  assert.deepEqual(result.unexplained, []);
});

test('an unexplained cluster or singleton fails the browser assertion even beside a confirmed image', () => {
  // The ghost touches a confirmed pixel: cluster-centre approval would miss it.
  const secondary = {x:631,y:658}, ghost = {x:632,y:658}, singleton = {x:572,y:557};
  const result = classifyWorldChanges([secondary, ghost, singleton], direct,
    p => p === secondary ? { id:'farShore', coverage:1 } : null);
  assert.equal(result.confirmed.length, 1);
  assert.deepEqual(result.unexplained, [ghost, singleton]);
  assert.throws(() => assert.equal(result.unexplained.length, 0), assert.AssertionError);
});

test('simulated removed Brink draw gate and wrong-world hits cannot authorize a third silhouette', () => {
  // Simulate changed pixels from a shader drawing the forbidden body. Neither
  // mutated draw telemetry nor a claimed Brink hit can extend the allowlist.
  const cluster = [{x:450,y:450},{x:451,y:450},{x:450,y:451}];
  const brink = { id:'brink', orbitRadius:.50002, radius:.18, phase:0, drawn:true };
  for (const id of ['brink','ghost']) {
    const result = classifyWorldChanges(cluster, direct, () => ({id,coverage:1}));
    assert.deepEqual(result.unexplained, cluster);
    assert.throws(() => assert.equal(result.unexplained.length, 0), assert.AssertionError);
  }
  const mutation = classifyWorldChanges(cluster, [{...direct[0],id:'brink'}],
    p => traceWorldPixel(p, {basis,spin,worlds:[...worlds,brink]}));
  assert.deepEqual(mutation.unexplained, cluster);
  assert.throws(() => assert.equal(mutation.unexplained.length, 0), assert.AssertionError);
  assert.equal(traceWorldPixel(cluster[0], {basis,spin,worlds:[brink]}), null);
  assert.equal(traceWorldPixel({x:631,y:658}, {basis,spin,worlds:worlds.map(w=>({...w,drawn:false}))}), null);
});

test('world coverage support matches the actual GLSL and rejects pixels beyond the one-pixel rim', () => {
  const body = functionBody(kerrFragmentShader, 'kerrWorldHit');
  for (const height of [0,.8,.95,1,1.05,1.099,1.1,1.2]) {
    const start=[-2,height,0],end=[2,height,0],c0=[0,0,0],c1=[.1,0,0],radius=1,pixel=.2;
    const env={start,end,c0,c1,radius,pixel};
    for(const name of ['relative','delta','A','B','C','perpendicular']) env[name]=evaluate(assignment(body,name),env);
    // coverage's first assignment initialises it to zero; evaluate its actual smoothstep expression.
    const coverage=body.match(/coverage = (1\.0 - smoothstep[^;]+);/)[1];
    env.coverage=evaluate(coverage,env,{smoothstep(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}});
    for(const name of ['root','near','far','fraction']) env[name]=evaluate(assignment(body,name),env);
    const fraction=evaluate(lastReturn(body),env),hit=worldCoverage(start,end,c0,c1,radius,pixel);
    assert.equal(hit!==null, fraction>=0, `height ${height}`);
    if(hit){assert.ok(Math.abs(hit.fraction-fraction)<1e-12);assert.ok(Math.abs(hit.coverage-env.coverage)<1e-12);}
  }
  assert.equal(worldCoverage([0,0,0],[1,0,0],[0,0,0],[1,0,0],1,.2),null);
});

test('exact Kerr check pixel centres hit secondary Far Shore and higher-order Lantern at High and refined steps', () => {
  for(const [x,y,id,crossings,turns,delay] of [
    [631,658,'farShore',1,1,90.705115715],
    [572,557,'lantern',2,2,42.634704363],
  ]) for(const stepScale of [1,.1]) {
    const world=worlds.find(w=>w.id===id), states=[];
    const ray=traceWorld({position:basis.position,spin,direction:pixelRay(x,y,basis),
      radius:world.orbitRadius,phase:world.phase,bodyRadius:world.radius,stepScale,onStep:s=>states.push(s)});
    assert.equal(ray.fate,'hit');
    states.push({...ray.state,x:ray.hit.x});
    let equator=0,polarTurns=0,previousSign=0;
    const theta=s=>Math.acos(Math.max(-1,Math.min(1,s.x[2]/blRadius(s.x,spin))));
    for(let i=1;i<states.length;i++){
      if(states[i-1].x[2]*states[i].x[2]<0)equator++;
      const delta=theta(states[i])-theta(states[i-1]);
      if(Math.abs(delta)>1e-10){const sign=Math.sign(delta);if(previousSign&&sign!==previousSign)polarTurns++;previousSign=sign;}
    }
    assert.equal(equator,crossings);assert.equal(polarTurns,turns);
    assert.ok(Math.abs(ray.hit.delay-delay)<.002);
  }
  const singleton=traceWorldPixel({x:572,y:557},{basis,spin,worlds});
  assert.equal(singleton.id,'lantern');
});

test('secondary-image limb pixels require positive shader coverage rather than a geometric sphere hit', () => {
  const p={x:637,y:652},world=worlds[1];
  const strict=traceWorld({position:basis.position,spin,direction:pixelRay(p.x,p.y,basis),
    radius:world.orbitRadius,phase:world.phase,bodyRadius:world.radius});
  assert.notEqual(strict.fate,'hit');
  const hit=traceWorldPixel(p,{basis,spin,worlds});
  assert.equal(hit.id,'farShore');
  assert.ok(hit.coverage>0&&hit.coverage<1);
  const result=classifyWorldChanges([p],[],q=>traceWorldPixel(q,{basis,spin,worlds}));
  assert.deepEqual(result.unexplained,[]);
  assert.equal(traceWorldPixel({x:650,y:670},{basis,spin,worlds}),null);
});

test('opaque Kerr worlds preserve the vacuum escape directions used by neighbouring sky derivatives', () => {
  const main=functionBody(kerrFragmentShader,'main');
  // This guard fails with the former opaque-hit break. A world-toggle must
  // change surface light, never the ray field passed to dFdx/dFdy below.
  assert.doesNotMatch(main,/if\s*\(\s*transmittance\s*<[^)]*\)\s*break/);
  assert.match(main,/observedSky\(skyRay, dFdx\(skyRay\), dFdy\(skyRay\)/);
  const quad=[{x:634,y:652},{x:635,y:652},{x:634,y:653},{x:635,y:653}];
  const hits=quad.map(p=>traceWorldPixel(p,{basis,spin,worlds}));
  assert.deepEqual(hits.map(h=>h?.id??null),[null,null,null,'farShore']);
  const vacuum=quad.map(p=>traceRay({position:basis.position,direction:pixelRay(p.x,p.y,basis),spin}));
  assert.ok(vacuum.every(ray=>ray.fate==='escaped'));
  // The old break leaves outgoing=initialRay in the hit lane. Quantify the
  // discontinuity it injects into dFdy at its unoccluded vertical neighbour.
  const p=quad[3],scale=450/Math.tan(GEODESIC.halfFov);
  const initial=basis.forward.map((v,i)=>v+(p.x-449.5)/scale*basis.right[i]+(449.5-p.y)/scale*basis.up[i]);
  const length=Math.hypot(...initial),oldOutgoing=initial.map(v=>v/length);
  const derivative=(a,b)=>a.map((v,i)=>v-b[i]);
  const expected=derivative(vacuum[3].direction,vacuum[1].direction);
  const broken=derivative(oldOutgoing,vacuum[1].direction);
  assert.ok(Math.hypot(...expected)<.01);
  assert.ok(Math.hypot(...broken)>.1);
  assert.equal(classifyWorldChanges([quad[1]],[],p=>traceWorldPixel(p,{basis,spin,worlds})).unexplained.length,1,
    'the old derivative leak is rejected rather than excused by a neighbouring hit');
});
