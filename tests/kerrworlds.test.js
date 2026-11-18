import test from 'node:test';
import assert from 'node:assert/strict';
import { worldOmega, worldEvent, movingSphere, traceWorld, worldImage, directEventImage, worldShift, photonOrbit } from '../src/kerrworlds.js';
import { emitterShift, traceRay, blRadius } from '../src/kerrray.js';
import { directImage } from '../src/worldview.js';
import { kerrFragmentShader } from '../src/shaders/blackhole.js';
import { evaluate, functionBody, assignment, lastReturn } from './glsl-subset.mjs';
const close = (a,b,t=1e-10) => assert.ok(Math.abs(a-b)<t, `${a} vs ${b}, tolerance ${t}`);
const vectorClose = (a,b,t=1e-10) => a.forEach((v,i)=>close(v,b[i],t));

test('Kerr worlds use capped prograde circular motion and a photon-orbit gate', () => {
  for(const spin of [0,.9,.998]) {
    close(photonOrbit(spin), 1+Math.cos(2/3*Math.acos(-spin)));
    for(const radius of [6,60]) {
      const omega = worldOmega(radius,spin), e=worldEvent(radius,0,0,spin), next=worldEvent(radius,0,1,spin);
      close(Math.atan2(next.x[1], next.x[0])-Math.atan2(e.x[1],e.x[0]),omega);
      vectorClose(e.x,[0,Math.sqrt(radius*radius+spin*spin/4),0]);
      const past=worldEvent(radius,0,-23,spin);
      close(Math.atan2(past.x[1],past.x[0]),Math.PI/2-omega*23);
    }
    assert.doesNotThrow(()=>worldOmega(1.2*photonOrbit(spin),spin));
    assert.throws(()=>worldOmega(1.2*photonOrbit(spin)-1e-8,spin),RangeError);
  }
});

test('moving sphere solves the relative quadratic inside each time-interpolated chord', () => {
  const hit=movingSphere([0,0,0],[10,0,0],[4,1,0],[6,-1,0],.5);
  assert.ok(hit); close(Math.hypot(...hit.x.map((v,i)=>v-hit.center[i])),.5);
  const A=68,B=-34,C=16.75;
  close(hit.fraction,(-B-Math.sqrt(B*B-A*C))/A);
  assert.equal(movingSphere([0,0,0],[1,0,0],[4,1,0],[6,-1,0],.5),null);
});

test('far camera rays shot at moving Kerr world centres hit their direct spheres', () => {
  for(const [radius,phase] of [[6,-.9],[60,.15]]) {
    const options={position:[0,5,100],spin:.998,radius,phase,stepScale:.1};
    const image=worldImage(options), ray=traceWorld({...options,direction:image.direction,bodyRadius:radius===6?.18:.6});
    assert.equal(ray.fate,'hit'); assert.ok(ray.hit.delay>0);
    close(Math.hypot(...ray.hit.normal),1,1e-9);
    const h=ray.hit;
    close(h.t,-h.delay);
    // The chord centre is linear in its endpoint times, as in the shader.
    assert.ok(Math.hypot(...h.center.map((v,i)=>v-worldEvent(radius,phase,h.t,.998).x[i]))<.001);
  }
});

test('retarded world event on a Schwarzschild inward radial ray uses KS delay r_cam-r', () => {
  const radius=6,delay=23-radius,phase=-Math.PI/2+worldOmega(radius,0)*delay;
  const image=worldImage({position:[0,0,23],spin:0,radius,phase,stepScale:.1});
  close(image.delay,delay,1e-9);
  vectorClose(image.direction,[-1,0,0],1e-9);
});

test('zero-spin static Far Shore image matches Schwarzschild directImage within 1e-5 rad', () => {
  const position=[0,5,23],target=[20,0,-Math.sqrt(60*60-400)];
  const image=directEventImage({position,spin:0,eventAt:()=>({x:[target[2],target[0],target[1]]}),stepScale:.1});
  const reference=directImage(position,target);
  const error=2*Math.asin(Math.hypot(...image.sceneDirection.map((v,i)=>v-reference[i]))/2);
  assert.ok(error<1e-5,`static-image error ${error}`);
});

test('world approaching/receding orbital phases bracket g=1 and agree with emitterShift', () => {
  const position=[0,0,100],spin=.998,radius=6,values=[];
  for(const phase of [Math.PI,.0]) {
    const event=worldEvent(radius,phase,0,spin);
    const image=directEventImage({position,spin,eventAt:()=>event});
    const g=worldShift(image.x,image.p,image.pt,radius,spin);
    const lz=image.x[0]*image.p[1]-image.x[1]*image.p[0];
    close(g,emitterShift(radius,spin,image.pt,lz),1e-7);values.push(g);
  }
  assert.ok(values[0]>1 && values[1]<1,JSON.stringify(values));
});

test('actual GLSL moving world time, KS normals and emitter g match JS',()=>{
  const center=functionBody(kerrFragmentShader,'kerrWorldCenter');
  const shift=functionBody(kerrFragmentShader,'kerrWorldShift');
  const inner=functionBody(kerrFragmentShader,'kerrInnerProduct');
  const light=functionBody(kerrFragmentShader,'kerrWorldLight');
  for(const spin of [0,.9,.998]) for(const radius of [6,60]) {
    const env={radius,phase:-.9,time:-27,a:spin/2,PI:Math.PI};
    for(const n of ['omega','phi','rho'])env[n]=evaluate(assignment(center,n),env);
    const x=evaluate(lastReturn(center),env);vectorClose(x,worldEvent(radius,-.9,-27,spin).x);
    const hit=x.map((v,i)=>v+([.1,.03,.02][i]));
    const normal=evaluate(assignment(light,'normal'),{x:hit,center:x});
    vectorClose(normal,[.1,.03,.02].map(v=>v/Math.hypot(.1,.03,.02)));
    const e={x:hit,p:[-.5,.4,.1],pt:1,a:spin/2,radius};
    for(const n of ['omega','v','ut'])e[n]=evaluate(assignment(shift,n),e,{kerrInnerProduct(x,a,u,v){
      const m={x,a,u,v,r:blRadius(x,spin)};
      for(const name of ['l','f'])m[name]=evaluate(assignment(inner,name),m);
      return evaluate(lastReturn(inner),m);
    }});
    close(evaluate(lastReturn(shift),e),worldShift(hit,e.p,1,radius,spin));
  }
});

test('world exports reject nonfinite inputs and invalid spins',()=>{
  for(const bad of [NaN,Infinity,-Infinity]){
    assert.throws(()=>photonOrbit(bad),RangeError);
    assert.throws(()=>worldOmega(bad,.9),RangeError);
    assert.throws(()=>worldEvent(6,bad,0,.9),RangeError);
    assert.throws(()=>worldEvent(6,0,bad,.9),RangeError);
    assert.throws(()=>movingSphere([bad,0,0],[1,0,0],[2,0,0],[2,0,0],.1),RangeError);
  }
  for(const spin of [-.1,.9981])assert.throws(()=>worldOmega(6,spin),RangeError);
});

test('actual GLSL moving-body quadratic matches the JS time-chord sphere intersection',()=>{
 const body=functionBody(kerrFragmentShader,'kerrMovingHit');
 for(const [c0,c1]of [[[4,1,0],[6,-1,0]],[[4,.2,0],[4,.2,0]],[[10,0,0],[9,0,0]]]){
  const env={start:[0,0,0],end:[10,0,0],c0,c1,axes:[.5,.5,.5]};
  for(const name of ['relative','delta','A','B','C','D','near','far','fraction'])env[name]=evaluate(assignment(body,name),env);
  const fraction=evaluate(lastReturn(body),env);
  const expected=movingSphere(env.start,env.end,c0,c1,.5);
  close(fraction,expected?.fraction??-1,1e-12);
 }
});
