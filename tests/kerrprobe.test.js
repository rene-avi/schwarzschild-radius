import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { integrateProbe,probeInvariants,historyAt,probeImage,createKerrProbe,updateKerrProbe,probeWindow,KERR_PROBE_KNOTS } from '../src/kerrprobe.js';
import { probeCycloid, probeSignal, PROBE_LOST_SIGNAL } from '../src/physics.js';
import { horizon } from '../src/kerrray.js';
import { kerrFragmentShader } from '../src/shaders/blackhole.js';
import { evaluate,functionBody,lastReturn,assignment } from './glsl-subset.mjs';
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b} tolerance ${t}`);
const histories=new Map();
const history=(spin,direction=[0,0,1])=>{
 const key=JSON.stringify([spin,direction]);
 if(!histories.has(key))histories.set(key,integrateProbe({spin,direction}));
 return histories.get(key);
};
const evidence={};

test('timelike KS fall conserves mass shell and timelike Carter Q below 1e-9; E is fixed',()=>{
 for(const spin of [0,.9,.998])for(const direction of [[0,0,1],[.4,.23,.9]]){
  const events=history(spin,direction),initial=probeInvariants(events[0],spin);
  const r=7,a=spin/2,ct=direction[1]/Math.hypot(...direction),Delta=r*r-r+a*a,Sigma=r*r+a*a*ct*ct;
  const alpha=Math.sqrt(Delta*Sigma/((r*r+a*a)**2-a*a*Delta*(1-ct*ct)));
  close(initial.E,alpha,1e-14);close(initial.Lz,0,1e-14);
  let H=0,Q=0,L=0;
  for(const event of events){const v=probeInvariants(event,spin);H=Math.max(H,Math.abs(v.H+.5));Q=Math.max(Q,Math.abs(v.Q-initial.Q));L=Math.max(L,Math.abs(v.Lz));assert.equal(v.E,initial.E);}
  assert.ok(H<1e-9,`H=${H}`);assert.ok(Q<1e-9,`Q=${Q}`);assert.ok(L<1e-9,`Lz=${L}`);
  evidence[JSON.stringify({spin,direction})]={H,Q,L,count:events.length};
 }
});

test('zero-spin KS probe matches exact cycloid r(tau) to 1e-9',()=>{
 for(const event of history(0)){
  let lo=0,hi=Math.PI;
  for(let j=0;j<48;j++){const mid=(lo+hi)/2;if(probeCycloid(mid).properElapsed<event.tau)lo=mid;else hi=mid;}
  close(event.radius,probeCycloid((lo+hi)/2).radius);
 }
});

function quadrature(r,E,a,r0=7){
 const rp=.5+Math.sqrt(.25-a*a),rm=1-rp;
 const integrand=v=>{
  const radius=r0*Math.cos(v)**2,Delta=radius*radius-radius+a*a;
  if(v===0){
   const D0=r0*r0-r0+a*a;
   const derivative=4*E*E*r0*(r0*r0+a*a)-(2*r0-1)*(r0*r0+a*a*E*E)-2*r0*D0;
   return 2*r0*(a*r0*E)/(D0*Math.sqrt(-derivative*r0));
  }
  const R=E*E*(radius*radius+a*a)**2-Delta*(radius*radius+a*a*E*E);
  return 2*r0*Math.sin(v)*Math.cos(v)*a*radius*E/(Delta*Math.sqrt(Math.max(0,R)));
 };
 const end=Math.acos(Math.sqrt(r/r0)),n=8192,h=end/n;
 let total=integrand(0)+integrand(end);
 for(let j=1;j<n;j++)total+=(j%2?4:2)*integrand(j*h);
 const phiBL=total*h/3;
 const Phi=x=>a/(rp-rm)*Math.log((x-rp)/(x-rm));
 return phiBL-Phi(r)+Phi(r0)-Math.atan(a/r)+Math.atan(a/r0);
}

test('near-extremal equatorial chart azimuth agrees with independent BL quadrature to 1e-8',()=>{
 const events=history(.998),E=-events[0].pt,a=.499;
 let phi=0,previous=events[0],next=0;
 const radii=[6,3,1,.8,.65],errors=[];
 for(const event of events){
  phi+=Math.atan2(previous.x[0]*event.x[1]-previous.x[1]*event.x[0],previous.x[0]*event.x[0]+previous.x[1]*event.x[1]);previous=event;
  if(event.radius<=radii[next]){const expected=quadrature(event.radius,E,a);close(phi,expected,1e-8);errors.push(phi-expected);next++;}
  if(next===radii.length)break;
 }
 assert.equal(next,radii.length);evidence.quadratureErrors=errors;
});

test('history interpolation returns exact stored events and resolves the Hermite history',()=>{
 const events=history(.998,[.4,.23,.9]);
 for(let i=0;i<events.length;i+=173)assert.equal(historyAt(events,events[i].t),events[i]);
 assert.equal(historyAt(events,events.at(-1).t),events.at(-1));
 for(let i=0;i<events.length-1;i+=313){const a=events[i],b=events[i+1],mid=historyAt(events,(a.t+b.t)/2);assert.ok(mid.tau>=a.tau&&mid.tau<=b.tau);assert.ok(mid.x.every(Number.isFinite));}
});

test('independent radial Schwarzschild signal matches traced probe g to 1e-6',()=>{
 const events=history(0);
 for(const radius of [7,6,3,1.5,1.05]){
  const event=events.reduce((a,b)=>Math.abs(a.radius-radius)<Math.abs(b.radius-radius)?a:b);
  const image=probeImage([0,0,23],0,event);
  close(image.g,probeSignal(event.radius,23,7),1e-6);
 }
});

test('actual GLSL per-pixel probe redshift uses p.u in the denominator',()=>{
 const body=functionBody(kerrFragmentShader,'kerrProbeShift');
 for(const radius of [7,3,1.05]){
  const event=history(0).reduce((a,b)=>Math.abs(a.radius-radius)<Math.abs(b.radius-radius)?a:b);
  const image=probeImage([0,0,23],0,event);
  const g=evaluate(lastReturn(body),{p:image.p,pt:image.pt,u:event.u});
  close(g,image.g,1e-12);close(g,probeSignal(event.radius,23,7),1e-6);
 }
});

test('fixed drop receiver timeline stretches proper-time flashes, fades, and reaches loss',()=>{
 const probe=createKerrProbe({position:[0,23*Math.sin(.23),23*Math.cos(.23)],direction:[.4,.23,.9],spin:.998});
 assert.ok(probe.lostTime>40&&probe.lostTime<70);
 const gaps=probe.flashEvents.slice(1).map((e,i)=>e.receptionTime-probe.flashEvents[i].receptionTime);
 assert.ok(gaps.at(-1)>2*gaps[0]);
 updateKerrProbe(probe,probe.flashEvents[25].receptionTime);
 assert.equal(probe.flashCount,26);
 const knots=probeWindow(probe);assert.equal(knots.length,KERR_PROBE_KNOTS);assert.ok(knots.length>=32);
 const full=history(.998,[.4,.23,.9]);
 let error=0;
 for(let i=0;i<knots.length-1;i++){
  const t=(knots[i].t+knots[i+1].t)/2,a=historyAt(knots,t),b=historyAt(full,t);
  error=Math.max(error,Math.hypot(...a.x.map((v,j)=>v-b.x[j])));
 }
 assert.ok(error<1e-3,`history knot error ${error}`);
 let previousProper=probe.properElapsed;
 while(probe.state!=='lost'){
  updateKerrProbe(probe,.05);
  assert.ok(probe.properElapsed>=previousProper,'direct reception never reverses the onboard clock');
  previousProper=probe.properElapsed;
 }
 updateKerrProbe(probe,probe.lostTime);
 assert.equal(probe.state,'lost');assert.ok(probe.signal<=PROBE_LOST_SIGNAL);
 evidence.timeline={lostTime:probe.lostTime,gaps,windowMaximumError:error};
 mkdirSync(new URL('../tmp/',import.meta.url),{recursive:true});writeFileSync(new URL('../tmp/kerr-probe-numbers.json',import.meta.url),JSON.stringify(evidence,null,2));
});

test('direct central probe image chooses the same earliest arrival across shooting seeds',()=>{
 const events=history(.998,[.4,.23,.9]);
 const event=events.reduce((a,b)=>Math.abs(a.radius-.8)<Math.abs(b.radius-.8)?a:b);
 const a=probeImage([0,5,23],.998,event),b=probeImage([0,5,23],.998,event,[-1,0,0]);
 close(a.delay,b.delay,1e-6);close(a.g,b.g,1e-6);
});

test('probe public functions reject nonfinite inputs, invalid spin and ergosphere starts',()=>{
 for(const bad of [NaN,Infinity,-Infinity]){
  assert.throws(()=>integrateProbe({spin:bad}),RangeError);
  assert.throws(()=>integrateProbe({spin:.9,radius:bad}),RangeError);
  assert.throws(()=>integrateProbe({spin:.9,direction:[bad,0,1]}),RangeError);
  assert.throws(()=>historyAt(history(0),bad),RangeError);
 }
 for(const spin of [-.1,.9981])assert.throws(()=>integrateProbe({spin}),RangeError);
 for(const spin of [0,.998])for(const radius of [horizon(spin),1])assert.throws(()=>integrateProbe({spin,radius}),RangeError);
});

test('actual GLSL probe Hermite interpolation and proper-time pulse agree with the JS history',()=>{
 const body=functionBody(kerrFragmentShader,'kerrProbeAt'),formula=body.slice(body.indexOf('float dt ='));
 const light=functionBody(kerrFragmentShader,'kerrProbeLight');
 const events=history(.998,[.4,.23,.9]);
 for(let i=0;i<events.length-20;i+=997){
  const a=events[i],b=events[i+20],time=a.t+.37*(b.t-a.t),env={time,a:[...a.x,a.t],b:[...b.x,b.t],ua:a.u,ub:b.u};
  env.dt=evaluate(assignment(formula,'dt'),env);env.s=evaluate(assignment(formula,'s'),env);
  const x=evaluate(assignment(formula,'x'),env),expected=historyAt([a,b],time);
  x.forEach((v,j)=>close(v,expected.x[j],1e-12));
 }
 const pulse=assignment(light,'pulse');
 for(const tau of [0,.05,.11,.22,1.01,27.001]){
  const phase=tau-Math.floor(tau),s=Math.min(1,phase/.22);
  close(evaluate(pulse,{tau}),1-s*s*(3-2*s),1e-12);
 }
});
