// Микромир за портретом врача: 10 тем-фонов на одном движке (three.js).
import * as THREE from 'three';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { mergeGeometries, mergeVertices } from './vendor/addons/utils/BufferGeometryUtils.js';
import { THEMES, DEFAULT_THEME } from './themes.js?v=3';

const FOV = 32, CAM_Z = 12;
const TAU = Math.PI * 2;
const TAN = Math.tan(FOV / 2 * Math.PI / 180);
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = t => 1 - Math.pow(1 - t, 4);
const lin = a => new THREE.Color().setRGB(a[0], a[1], a[2]);

/* ---------- GLSL ---------- */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 nr=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nr.x; p1*=nr.y; p2*=nr.z; p3*=nr.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453123);}
vec2 voro(vec3 x){vec3 p=floor(x),f=fract(x);float f1=8.,f2=8.;
  for(int k=-1;k<=1;k++)for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec3 b=vec3(i,j,k);vec3 r=b+hash3(p+b)-f;float d=dot(r,r);
    if(d<f1){f2=f1;f1=d;}else if(d<f2){f2=d;}}
  return vec2(sqrt(f1),sqrt(f2));}
`;
const TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ITEM_VS = /* glsl */`
attribute float aPat;
varying vec3 vObj; varying vec3 vView; varying vec3 vN; varying float vPat;
varying vec3 vM0; varying vec3 vM1; varying vec3 vM2;
void main(){
  vObj=position; vPat=aPat; vM0=normalMatrix[0]; vM1=normalMatrix[1]; vM2=normalMatrix[2];
  vec4 mv=modelViewMatrix*vec4(position,1.);
  vView=mv.xyz; vN=normalize(normalMatrix*normal);
  gl_Position=projectionMatrix*mv;
}`;

// MODE: 0 пыльца (SEM), 1 глянец (еда), 2 клетка, 3 мыльная плёнка, 4 лёд; PATTERN — узор поверхности
const ITEM_FS = /* glsl */`
uniform vec3 uColA; uniform vec3 uColB; uniform float uTime; uniform float uHit; uniform float uDissolve;
uniform float uBump; uniform float uPatCol; uniform float uSeed;
uniform float uFogNear; uniform float uFogFar; uniform vec3 uFogCol;
varying vec3 vObj; varying vec3 vView; varying vec3 vN; varying float vPat;
varying vec3 vM0; varying vec3 vM1; varying vec3 vM2;
${NOISE}
float pattern(vec3 p){
  float fw;
#if PATTERN == 1
  fw=length(fwidth(p))*6.; vec2 v=voro(p*6.+uSeed); return (1.-smoothstep(.02,.16+fw,v.y-v.x))*(1.-smoothstep(.25,.6,fw));   // сетка
#elif PATTERN == 2
  fw=length(fwidth(p))*8.; return smoothstep(.45,.85,.5+.5*snoise(p*8.+uSeed))*(1.-smoothstep(.2,.5,fw));                  // бугорки
#elif PATTERN == 3
  fw=length(fwidth(p))*7.; vec2 v=voro(p*7.+uSeed); return (1.-smoothstep(.09,.17,v.x))*(1.-smoothstep(.3,.7,fw));         // семечки
#elif PATTERN == 5
  fw=length(fwidth(p))*24.; return smoothstep(.5,.9,.5+.5*snoise(p*24.+uSeed))*(1.-smoothstep(.2,.5,fw));                 // поры кожуры
#elif PATTERN == 6
  return .5+.5*sin(atan(p.z,p.x)*15.+snoise(p*3.+uSeed)*1.4);                                                              // рёбра
#elif PATTERN == 0
  fw=length(fwidth(p))*10.; return smoothstep(.35,.95,.5+.5*snoise(p*10.+uSeed))*(1.-smoothstep(.2,.5,fw));                // зерно
#else
  return 0.;
#endif
}
void main(){
  float dn=.5+.5*snoise(vObj*2.6+uSeed);
  if(dn<uDissolve) discard;
  float edge=(1.-smoothstep(0.,.07,dn-uDissolve))*step(.001,uDissolve);

  vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n;
  float h=0.;
#if PATTERN != 4
  if(vPat>.01){
    h=pattern(vObj)*vPat;
    // рельеф: градиент узора конечными разностями (без «квадратиков» от dFdx)
    float e=.012;
    vec3 g=vec3(pattern(vObj+vec3(e,0.,0.)),pattern(vObj+vec3(0.,e,0.)),pattern(vObj+vec3(0.,0.,e)))*vPat-h;
    g=mat3(vM0,vM1,vM2)*(g/e);
    n=normalize(n-uBump*(g-dot(g,n)*n));
  }
#endif
  vec3 v=normalize(-vView);
  float ndv=clamp(dot(n,v),0.,1.);
  float fres=pow(1.-ndv,2.3);
  vec3 L=normalize(vec3(-.55,.75,.55));
  float wrap=clamp(dot(n,L)*.5+.5,0.,1.);
  vec3 irid=.5+.5*cos(6.2831853*(vec3(0.,.33,.67)+ndv*1.3+uTime*.03+uSeed));
  vec3 col; float alpha=1.;
#if MODE == 1
    vec3 base=mix(uColA,uColB,h*uPatCol);
    vec3 H=normalize(L+v); float sp=pow(clamp(dot(n,H),0.,1.),46.);
    col=base*(.1+.95*wrap*wrap)+vec3(1.)*sp*.85+base*fres*.3+vec3(.45,.65,1.)*pow(fres,3.)*.3;
#elif MODE == 2
    col=uColA*(.1+.45*wrap)+uColB*pow(fres,1.5)*1.35+irid*fres*.15;
    alpha=.3+.7*fres;
#elif MODE == 3
    vec3 film=.5+.5*cos(6.2831853*(vec3(0.,.33,.67)+ndv*2.2+snoise(vObj*1.5+uTime*.12)*.4+uSeed));
    vec3 H=normalize(L+v); float sp=pow(clamp(dot(n,H),0.,1.),110.);
    col=film*(.12+1.15*fres)+vec3(1.)*sp*2.2;
    alpha=clamp(.04+.9*pow(fres,2.)+sp,0.,1.);
#elif MODE == 4
    float gl=pow(max(snoise(vObj*16.+vec3(0.,0.,uTime*.7)),0.),8.)*3.;
    col=uColA*(.18+.6*wrap)+uColB*fres*1.3+vec3(1.)*gl;
    alpha=.95;
#else
    col=uColA*(.03+.42*wrap*wrap);
    col*=.7+.6*h;
    col+=uColB*fres*.75+uColB*pow(fres,5.)*1.6+irid*fres*.22;
    col+=uColB*pow(clamp(dot(n,normalize(vec3(.8,-.2,-.6)))*.5+.5,0.,1.),4.)*.18;
#endif
  col+=(uColB*1.6+vec3(.6))*uHit*(.2+fres);
  col+=(uColB*5.+vec3(1.5))*edge;
  float d=length(vView);
  float fog=smoothstep(uFogNear,uFogFar,d);
  col=mix(col,uFogCol,fog*.5);
  gl_FragColor=vec4(col,alpha*(1.-fog));
${TAIL}`;

// свечение для инстансов: антитела, гранулы, ДНК
const GLOW_VS = /* glsl */`
varying vec3 vN; varying vec3 vView; varying vec3 vC;
void main(){
  vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);
  vView=mv.xyz; vN=normalize(normalMatrix*mat3(instanceMatrix)*normal);
  #ifdef USE_INSTANCING_COLOR
    vC=instanceColor;
  #else
    vC=vec3(1.);
  #endif
  gl_Position=projectionMatrix*mv;
}`;
const GLOW_FS = /* glsl */`
uniform vec3 uCol; uniform float uK0; uniform float uK1; uniform float uFade;
uniform float uFogNear; uniform float uFogFar; uniform vec3 uFogCol;
varying vec3 vN; varying vec3 vView; varying vec3 vC;
void main(){
  vec3 n=normalize(vN); float f=pow(1.-abs(dot(n,normalize(-vView))),2.);
  vec3 c=uCol*vC*(uK0+uK1*f);
  c=mix(c,uFogCol,smoothstep(uFogNear,uFogFar,length(vView))*.85);
  gl_FragColor=vec4(c*uFade,1.);
${TAIL}`;

const LINE_VS = /* glsl */`
varying float vD; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vD=length(mv.xyz); gl_Position=projectionMatrix*mv; }`;
const LINE_FS = /* glsl */`
uniform vec3 uCol; uniform float uOpacity; uniform float uFogNear; uniform float uFogFar; varying float vD;
void main(){ float a=uOpacity*(1.-smoothstep(uFogNear,uFogFar,vD)); gl_FragColor=vec4(uCol*a,a); }`;

const BG_FS = /* glsl */`
uniform float uTime; uniform vec2 uRes; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
varying vec2 vUv;
${NOISE}
float fbm(vec3 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*snoise(p); p*=2.03; a*=.5; } return s; }
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  vec2 p=vUv*asp;
  vec3 col;
#if BG_MODE == 1                                // северное сияние
    col=mix(uC0*1.8,uC0*.5,vUv.y);
    vec2 g=floor(p*110.); vec2 f=fract(p*110.)-.5; float hs=h21(g);
    col+=vec3(.8,.9,1.)*step(.988,hs)*smoothstep(.2,0.,length(f))*(.55+.45*sin(uTime*(1.+hs*3.)+hs*40.))*smoothstep(.25,.7,vUv.y);
    for(int k=0;k<3;k++){
      float fk=float(k);
      float w=fbm(vec3(p.x*1.1+fk*3.1,uTime*.035+fk,fk*1.7));
      float y0=.6+fk*.1+w*.2;
      float band=exp(-pow((vUv.y-y0)*(6.-fk*1.2),2.));
      float up=exp(-max(vUv.y-y0,0.)*3.)*smoothstep(y0-.12,y0,vUv.y);
      float rays=.45+.55*smoothstep(-.3,.6,fbm(vec3(p.x*10.+w*5.,uTime*.1,fk)));
      vec3 c=mix(uC1,uC2,clamp((vUv.y-y0)*3.+.3+fk*.25,0.,1.));
      col+=c*(band*.6+up*.5)*rays*(1.-fk*.22);
    }
#elif BG_MODE == 2                              // закат
    float y=vUv.y;
    col=mix(uC2,uC1,smoothstep(.05,.6,y)); col=mix(col,uC0,smoothstep(.55,1.,y));
    float d=length((vUv-vec2(.78,.64))*asp);
    col+=uC3*(exp(-d*d/.004)*1.4+exp(-d*d/.06)*.4+exp(-d*d/.5)*.12);
    col+=uC1*.25*fbm(vec3(p*1.3,uTime*.02));
#elif BG_MODE == 3                              // под водой
    col=mix(uC0,uC1,vUv.y);
    vec2 q=p*3.2;
    float c1=abs(sin(q.x*2.1+snoise(vec3(q,uTime*.22))*2.4))*abs(sin(q.y*1.7+snoise(vec3(q+7.,uTime*.2))*2.4));
    col+=uC2*pow(1.-c1,12.)*.4*smoothstep(.1,1.,vUv.y);
    float r=fbm(vec3(p.x*3.5+p.y*.9,uTime*.05,0.));
    col+=uC3*smoothstep(.05,.6,r)*smoothstep(.25,1.,vUv.y)*.3;
#else                                           // туманность
    float n=fbm(vec3(p*1.6,uTime*.025));
    float m=fbm(vec3(p*1.1+7.3,uTime*.018));
    col=uC0;
    col+=uC1*smoothstep(-.3,.7,n);
    col+=uC2*smoothstep(.15,.85,m);
    col+=uC3*exp(-pow(length((vUv-vec2(.05,.95))*asp),2.)/.12)*.5;
#endif
  float vig=smoothstep(1.25,.25,length((vUv-.5)*asp));
  col*=.55+.45*vig;
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;

const DUST_VS = /* glsl */`
attribute float aSize; attribute float aSeed;
uniform float uTime; uniform float uPR; uniform float uIntro;
varying float vA; varying float vSeed;
void main(){
  vec3 p=position;
  p.x+=sin(uTime*.11+aSeed*31.)*.35;
  p.y+=sin(uTime*.07+aSeed*17.)*.45+uTime*.03*(aSeed-.5);
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=aSize*uPR*(26./-mv.z);
  vA=(.35+.65*(.5+.5*sin(uTime*(.6+aSeed*1.7)+aSeed*40.)))*uIntro;
  vSeed=aSeed;
  gl_Position=projectionMatrix*mv;
}`;
const DUST_FS = /* glsl */`
uniform vec3 uDA; uniform vec3 uDB; varying float vA; varying float vSeed;
void main(){
  float d=length(gl_PointCoord-.5);
  float a=smoothstep(.5,.0,d); a*=a;
  vec3 c=mix(uDA,uDB,step(.72,vSeed));
  gl_FragColor=vec4(c*a*vA*.9,a*vA);
}`;

const FLOW_VS = /* glsl */`
attribute vec4 aR; attribute float aS;
uniform float uTime; uniform float uPR; uniform float uIntro; uniform float uAsp; uniform vec4 uTap;
varying float vA; varying float vS;
void main(){
  float z=aR.w; float hh=(12.-z)*.2867*1.1; float hw=hh*uAsp;
  float ph=fract(aR.y+uTime*aR.z*.03);
  float x=(ph*2.-1.)*hw*1.15;
  float y=aR.x*hh+.12*hh*sin(x/hw*2.2+uTime*.35+aR.x*5.)+.025*hh*sin(x/hw*7.+uTime*.9+aR.x*11.);
  vec3 p=vec3(x,y,z);
  vec2 dv=p.xy-uTap.xy; float dist=length(dv); float age=uTime-uTap.z;
  float wave=exp(-pow(dist-age*3.,2.)*1.2)*exp(-age*.8)*uTap.w;
  p.xy+=dv/(dist+1e-3)*wave*.7;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=(1.6+aS*3.)*uPR*(18./-mv.z)*(1.+wave*.8);
  float dash=.35+.65*smoothstep(.2,.9,sin(x/hw*9.-uTime*1.6+aR.x*7.));
  vA=smoothstep(0.,.12,ph)*smoothstep(1.,.85,ph)*(.45+.9*aS)*dash*uIntro*(1.+wave*2.);
  vS=aS;
  gl_Position=projectionMatrix*mv;
}`;
const FLOW_FS = /* glsl */`
uniform vec3 uDA; uniform vec3 uDB; varying float vA; varying float vS;
void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); vec3 c=mix(uDA,uDB,vS); gl_FragColor=vec4(c*a*vA,a*vA); }`;

const SPARK_VS = /* glsl */`
attribute float aLife; attribute vec3 aCol; uniform float uPR;
varying float vL; varying vec3 vC;
void main(){ vL=aLife; vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.);
  gl_PointSize=(2.+6.*aLife)*uPR*(14./-mv.z); gl_Position=projectionMatrix*mv; }`;
const SPARK_FS = /* glsl */`
varying float vL; varying vec3 vC;
void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d);
  gl_FragColor=vec4(vC*a*vL*3.,a*vL); }`;
const QUAD_VS = /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const RING_FS = /* glsl */`
uniform float uP; uniform vec3 uCol; varying vec2 vUv;
void main(){ float d=length(vUv-.5)*2.; float r=uP;
  float a=exp(-pow((d-r)*18.,2.))*(1.-uP)+exp(-pow((d-r*.82)*40.,2.))*(1.-uP)*.5;
  gl_FragColor=vec4(uCol*a*2.5,a); }`;

/* ---------- геометрия ---------- */
function withPat(geo, v) {
  geo.setAttribute('aPat', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1));
  return geo;
}
function clean(g, pat) { g.deleteAttribute('uv'); return withPat(g, pat); }
function fibDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), th = g * i;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}
function deformSphere(fn, ws = 96, hs = 64, scale = [1, 1, 1], post = null) {
  let g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position, d = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const r = fn(d);
    q.set(d.x * r * scale[0], d.y * r * scale[1], d.z * r * scale[2]);
    if (post) post(q);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  return withPat(g, 1);
}
const angBump = (d, c, w) => Math.exp(-Math.pow(Math.acos(Math.min(1, Math.max(-1, d.dot(c)))), 2) / w);
function spine(len, rad) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(rad * (Math.pow(1 - t, 1.6) + .9 * Math.exp(-t * 14)), t * len - .04));
  }
  return new THREE.LatheGeometry(pts, 8);
}
function echinate({ n, len, rad, pores = [] }) {
  const body = deformSphere(d => {
    let r = 1;
    for (const c of pores) r -= .09 * angBump(d, c, .02);
    return r;
  }, 72, 48);
  const parts = [body], up = new THREE.Vector3(0, 1, 0);
  for (const dir of fibDirs(n)) {
    if (pores.some(c => dir.dot(c) > .93)) continue;
    const s = spine(len * rnd(.85, 1.1), rad);
    s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    s.translate(dir.x * .97, dir.y * .97, dir.z * .97);
    parts.push(clean(s, .15));
  }
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
const tri = [0, 1, 2].map(i => new THREE.Vector3(Math.cos(i * TAU / 3), Math.sin(i * TAU / 3), 0));
const ellip = (sx, sy, sz, ws = 16, hs = 12) => new THREE.SphereGeometry(1, ws, hs).scale(sx, sy, sz);

function snowflakeGeo(seed) {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const parts = [];
  const box = (len, w, ang, base) => {
    const b = new THREE.BoxGeometry(len, w, .035);
    b.translate(len / 2, 0, 0); b.rotateZ(ang); b.translate(base.x, base.y, 0);
    parts.push(clean(b, 0));
  };
  const branches = [.28 + r() * .1, .5 + r() * .1, .72 + r() * .08].map(t => ({ t, L: (.14 + r() * .26) * (1.1 - t * .6) }));
  const tipR = .05 + r() * .05;
  for (let k = 0; k < 6; k++) {
    const a = k * TAU / 6, dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
    box(1, .075, a, new THREE.Vector2(0, 0));
    for (const b of branches) {
      const base = dir.clone().multiplyScalar(b.t);
      box(b.L, .05, a + Math.PI / 3, base);
      box(b.L, .05, a - Math.PI / 3, base);
    }
    const tip = new THREE.CylinderGeometry(tipR, tipR, .035, 6);
    tip.rotateX(Math.PI / 2); tip.translate(dir.x, dir.y, 0); parts.push(clean(tip, 0));
  }
  const hex = new THREE.CylinderGeometry(.17, .17, .045, 6); hex.rotateX(Math.PI / 2); parts.push(clean(hex, 0));
  return mergeGeometries(parts);
}
function antibodyGeo() {
  const parts = [];
  const cap = (len, x, y, rot) => {
    const c = new THREE.CapsuleGeometry(.07, len, 3, 8);
    c.rotateZ(rot); c.translate(x, y, 0); c.deleteAttribute('uv'); parts.push(c);
  };
  cap(.5, 0, -.3, 0); cap(.5, -.2, .2, .7); cap(.5, .2, .2, -.7);
  return mergeGeometries(parts);
}

const GEO = {
  helianthus: () => echinate({ n: 54, len: .5, rad: .1 }),
  ambrosia: () => echinate({ n: 70, len: .22, rad: .075, pores: tri.map(v => v.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), .3)) }),
  betula: () => deformSphere(d => {
    let r = 1;
    for (const c of tri) r += .32 * angBump(d, c, .16) - .16 * angBump(d, c, .008);
    return r;
  }, 96, 64, [1, 1, .66]),
  phleum: () => deformSphere(d => {
    const c = new THREE.Vector3(.3, .9, .3).normalize();
    const a = Math.acos(Math.min(1, d.dot(c)));
    return 1 + .07 * Math.exp(-Math.pow((a - .26) / .06, 2)) - .1 * Math.exp(-a * a / .012);
  }, 72, 48, [1, 1.1, .96]),
  artemisia: () => deformSphere(d => {
    let r = 1;
    const ph = Math.atan2(d.z, d.x);
    for (let k = 0; k < 3; k++) {
      const dp = Math.abs(((ph - k * TAU / 3) % TAU + TAU + Math.PI) % TAU - Math.PI);
      r -= .1 * Math.exp(-dp * dp / .012) * (1 - Math.pow(Math.abs(d.y), 3));
    }
    return r;
  }, 96, 64, [.92, 1.16, .92]),
  pinusBody: () => deformSphere(() => 1, 64, 40, [1.1, .72, .8]),
  pinusSac: () => deformSphere(() => 1, 64, 40, [.78, .74, .8]),
  lymph: () => echinate({ n: 170, len: .13, rad: .03 }),
  cell: () => withPat(new THREE.SphereGeometry(1, 48, 32), .4),
  bubble: () => withPat(new THREE.SphereGeometry(1, 48, 32), 0),
  granule: () => new THREE.SphereGeometry(1, 12, 8),
  strawberry: () => deformSphere(() => 1, 72, 48, [1, 1, 1], q => {
    const t = (q.y + 1) / 2, f = .42 + .58 * Math.pow(t, .55);
    q.x *= f; q.z *= f; q.y *= 1.15;
  }),
  leaves: () => {
    const parts = [];
    for (let k = 0; k < 7; k++) {
      const l = ellip(.42, .045, .16); l.translate(.36, 0, 0); l.rotateZ(-.3); l.rotateY(k * TAU / 7); l.translate(0, 1.17, 0);
      parts.push(clean(l, 0));
    }
    const st = new THREE.CylinderGeometry(.045, .06, .32, 8); st.translate(0, 1.36, 0); parts.push(clean(st, 0));
    return mergeGeometries(parts);
  },
  peanut: () => deformSphere(d => 1 - .2 * Math.exp(-d.y * d.y / .025), 72, 64, [.58, 1.22, .58]),
  egg: () => deformSphere(d => 1 + .12 * d.y, 64, 48, [.78, 1, .78]),
  orange: () => deformSphere(d => 1 - .05 * Math.exp(-Math.pow(Math.acos(Math.min(1, d.y)), 2) / .004), 72, 48, [1, .95, 1]),
  hazelnut: () => deformSphere(d => 1 + .25 * Math.pow(Math.max(0, d.y), 3) - .08 * Math.pow(Math.max(0, -d.y), 2), 64, 48, [1, 1.02, 1]),
  wheat: () => {
    const parts = [];
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1, y = -.85 + i * .13;
      const g = ellip(.13, .24, .1); g.rotateZ(side * .45); g.rotateY(i * .5); g.translate(side * .09, y, 0);
      parts.push(clean(g, 1));
      const awn = new THREE.CylinderGeometry(.006, .01, .7, 4); awn.translate(0, .35, 0); awn.rotateZ(side * .32); awn.translate(side * .14, y + .2, 0);
      parts.push(clean(awn, 0));
    }
    const st = new THREE.CylinderGeometry(.025, .03, 1.5, 6); st.translate(0, -1.55, 0); parts.push(clean(st, 0));
    return mergeGeometries(parts);
  },
  seed: () => withPat(ellip(.07, .22, .07, 10, 8), 1),
};
const geoCache = {};
const geo = k => (geoCache[k] ??= (k.startsWith('snow') ? snowflakeGeo(+k.slice(4)) : GEO[k]()));

function pappusGeo() {
  const pos = [], top = new THREE.Vector3(0, .62, 0);
  pos.push(0, -.55, 0, top.x, top.y, top.z);                  // ножка
  for (const d of fibDirs(90)) {
    if (d.y < -.15) continue;
    const e = top.clone().addScaledVector(d, .62);
    pos.push(top.x, top.y, top.z, e.x, e.y, e.z);
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(.06);
    pos.push(e.x, e.y, e.z, e.x + side.x + d.x * .04, e.y + side.y + d.y * .04, e.z + side.z + d.z * .04);
    pos.push(e.x, e.y, e.z, e.x - side.x + d.x * .04, e.y - side.y + d.y * .04, e.z - side.z + d.z * .04);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/* ---------- темы: что плавает в кадре ---------- */
// слоты: x, y — доля кадра на своей глубине, s — доля меньшей стороны кадра
const SLOTS = [
  { x: -.96, y: .64, z: 3.4, s: .26 }, { x: .98, y: .10, z: 2.4, s: .20 }, { x: .68, y: .86, z: -1.6, s: .17 },
  { x: -.72, y: .30, z: -4.5, s: .20 }, { x: -.92, y: -.26, z: 1.0, s: .15 }, { x: .88, y: -.42, z: -2.6, s: .17 },
  { x: -.22, y: .96, z: -9, s: .16 }, { x: .46, y: .42, z: -13, s: .22 }, { x: -.88, y: -.80, z: -8, s: .20 },
  { x: .92, y: -.88, z: 4.2, s: .20 }, { x: -.98, y: -.66, z: 2.2, s: .17 }, { x: .14, y: -.32, z: -15, s: .26 },
];
const P = (t, s) => ({ t, s });
const pollenLabels = {
  helianthus: P('Подсолнечник', 'Helianthus · пыльца'), ambrosia: P('Амброзия', 'Ambrosia · пыльца'), betula: P('Берёза', 'Betula · пыльца'),
  phleum: P('Тимофеевка', 'Phleum · пыльца'), artemisia: P('Полынь', 'Artemisia · пыльца'), pinus: P('Сосна', 'Pinus · пыльца'),
};
const pol = (k, a, b, p = 0) => ({ k, m: 0, a, b, p, label: pollenLabels[k] });
const FOOD = {
  strawberry: { k: 'strawberry', m: 1, a: '#e3122c', b: '#ffd84a', p: 3, pc: 1, bump: .025, sz: .95, label: P('Клубника', 'Fragaria · пищевой аллерген') },
  peanut: { k: 'peanut', m: 1, a: '#c08a50', b: '#efd0a0', p: 1, pc: .55, bump: .03, sz: .95, label: P('Арахис', 'Arachis · пищевой аллерген') },
  egg: { k: 'egg', m: 1, a: '#fff3df', b: '#ffffff', p: 0, pc: .15, bump: .004, sz: 1, label: P('Куриное яйцо', 'пищевой аллерген') },
  orange: { k: 'orange', m: 1, a: '#ff760c', b: '#ffb04a', p: 5, pc: .35, bump: .014, sz: 1.05, label: P('Апельсин', 'Citrus · пищевой аллерген') },
  wheat: { k: 'wheat', m: 1, a: '#d49b38', b: '#ffe08a', p: 6, pc: .4, bump: .01, sz: 1.25, label: P('Пшеница', 'Triticum · пищевой аллерген') },
  hazelnut: { k: 'hazelnut', m: 1, a: '#8a5228', b: '#c98a52', p: 6, pc: .5, bump: .01, sz: .8, label: P('Фундук', 'Corylus · пищевой аллерген') },
};
const lymph = (a, b) => ({ k: 'lymph', m: 0, a, b, p: 0, label: P('Лимфоцит', 'клетка иммунитета') });
const mast = (a, b, g) => ({ k: 'mast', m: 2, a, b, g, label: P('Тучная клетка', 'хранит гистамин') });
const dand = { k: 'dandelion', calm: true, sz: 1.45, b: '#fff0d0', label: P('Одуванчик', 'Taraxacum · семя') };
const snow = i => ({ k: 'snow' + i, m: 4, a: '#8fcfff', b: '#ffffff', p: 4, calm: true, label: P('Снежинка', 'лёд · H₂O') });
const bub = s => ({ k: 'bubble', m: 3, a: '#ffffff', b: '#ffffff', p: 4, sz: s });

const DEF = {
  pollen: {
    bg: { mode: 0, c: [[.004, .010, .016], [.010, .050, .058], [.045, .010, .050], [.10, .02, .12]] }, fog: [.006, .016, .024],
    bloom: [.6, .4, .86], dust: ['#8cf2ff', '#ff8cd9'], ab: { n: 1, col: '#bfefff' },
    items: [pol('helianthus', '#ff2e88', '#ff9fcf'), pol('betula', '#14c8d8', '#7ff3ff', 2), pol('ambrosia', '#ffb020', '#ffe08a'),
      pol('pinus', '#7a5cff', '#c4b4ff'), pol('phleum', '#8fe23a', '#d8ff9a'), pol('artemisia', '#ff6a3d', '#ffc0a0', 2),
      pol('ambrosia', '#ff2e88', '#ffb0d8'), pol('helianthus', '#14c8d8', '#9ff6ff'), pol('betula', '#ffb020', '#ffe08a', 2),
      pol('phleum', '#7a5cff', '#cfc2ff'), pol('pinus', '#ff6a3d', '#ffc4ac'), pol('artemisia', '#8fe23a', '#dcffa8', 2)],
  },
  immune: {
    bg: { mode: 0, c: [[.003, .005, .018], [.012, .025, .09], [.03, .012, .07], [.05, .06, .16]] }, fog: [.004, .008, .03],
    bloom: [.75, .45, .84], dust: ['#9fd0ff', '#d6b8ff'], ab: { n: 3.2, col: '#9fd0ff', size: 1.5 },
    items: [lymph('#b9b2ff', '#ffffff'), lymph('#8fb8ff', '#e6f0ff'), lymph('#d9b8ff', '#ffffff'), lymph('#8fb8ff', '#dfe8ff'),
      lymph('#b9b2ff', '#ffffff'), lymph('#d9b8ff', '#fff0ff'), lymph('#8fb8ff', '#e6f0ff'), lymph('#b9b2ff', '#ffffff'),
      lymph('#d9b8ff', '#ffffff'), lymph('#8fb8ff', '#e6f0ff'), lymph('#b9b2ff', '#ffffff'), lymph('#d9b8ff', '#ffffff')],
  },
  mast: {
    bg: { mode: 0, c: [[.012, .003, .008], [.06, .008, .03], [.03, .006, .05], [.16, .02, .08]] }, fog: [.02, .004, .012],
    bloom: [.75, .5, .82], dust: ['#ff9fcf', '#c79bff'], ab: { n: .8, col: '#ffb3d9' },
    items: [mast('#ff3d8a', '#ffc0dc', '#b04dff'), mast('#ff5fa2', '#ffd0e6', '#ff3d8a'), mast('#e0368f', '#ffb3d9', '#9b4dff'),
      mast('#ff3d8a', '#ffc0dc', '#ff7ac0'), mast('#ff5fa2', '#ffd0e6', '#b04dff'), mast('#e0368f', '#ffb3d9', '#ff3d8a'),
      mast('#ff3d8a', '#ffc0dc', '#9b4dff'), mast('#ff5fa2', '#ffd0e6', '#ff7ac0'), mast('#e0368f', '#ffb3d9', '#b04dff'),
      mast('#ff3d8a', '#ffc0dc', '#ff3d8a'), mast('#ff5fa2', '#ffd0e6', '#9b4dff'), mast('#e0368f', '#ffb3d9', '#ff7ac0')],
  },
  meadow: {
    bg: { mode: 2, c: [[.03, .012, .07], [.30, .07, .09], [.03, .01, .03], [1.0, .55, .22]] }, fog: [.09, .03, .05],
    bloom: [.7, .55, .8], dust: ['#ffd08a', '#ff9fb8'], ab: { n: 0 },
    items: [dand, dand, dand, pol('ambrosia', '#ffb020', '#ffe08a'), dand, dand, dand, dand, pol('helianthus', '#ffb020', '#fff0a0'), dand, dand, dand],
  },
  air: {
    bg: { mode: 0, c: [[.002, .008, .02], [.005, .04, .08], [.004, .015, .06], [.02, .08, .14]] }, fog: [.003, .012, .03],
    bloom: [.8, .5, .8], dust: ['#6fe8ff', '#ffffff'], ab: { n: 0 }, flow: true, items: [],
  },
  food: {
    bg: { mode: 0, c: [[.012, .006, .004], [.05, .022, .01], [.04, .008, .02], [.14, .06, .02]] }, fog: [.02, .01, .006],
    bloom: [.45, .4, .9], dust: ['#ffd08a', '#ffffff'], ab: { n: 0 },
    items: [FOOD.strawberry, FOOD.orange, FOOD.peanut, FOOD.wheat, FOOD.egg, FOOD.hazelnut, FOOD.strawberry, FOOD.egg,
      FOOD.orange, FOOD.peanut, FOOD.wheat, FOOD.strawberry],
  },
  snow: {
    bg: { mode: 0, c: [[.006, .014, .03], [.03, .08, .14], [.03, .05, .11], [.10, .16, .25]] }, fog: [.012, .03, .06],
    bloom: [.7, .45, .82], dust: ['#ffffff', '#bfeaff'], ab: { n: 0 },
    items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(snow),
  },
  bubbles: {
    bg: { mode: 3, c: [[.002, .01, .02], [.01, .07, .10], [.3, .7, .8], [.2, .5, .6]] }, fog: [.004, .03, .045],
    bloom: [.7, .45, .82], dust: ['#bff8ff', '#ffc8f0'], ab: { n: 0 },
    items: [bub(1.3), bub(1.1), bub(1.2), bub(1.4), bub(1.2), bub(1.3), bub(1.1), bub(1.4), bub(1.2), bub(1.1), bub(1.3), bub(1.2)],
  },
  dna: {
    bg: { mode: 0, c: [[.006, .004, .02], [.03, .012, .08], [.01, .04, .07], [.10, .03, .16]] }, fog: [.008, .006, .03],
    bloom: [.8, .5, .78], dust: ['#8cf2ff', '#d09bff'], ab: { n: 0 }, dna: true, items: [],
  },
  aurora: {
    bg: { mode: 1, c: [[.004, .008, .02], [.04, .55, .28], [.25, .08, .45], [0, 0, 0]] }, fog: [.004, .01, .02],
    bloom: [.5, .5, .85], dust: ['#d6fff0', '#c8b8ff'], ab: { n: 0 }, items: [],
  },
};

/* ---------- сцена ---------- */
export function createScene(canvas, opts) {
  const reduced = opts.reduced;
  const isMobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let pr = opts.still ? devicePixelRatio : Math.min(devicePixelRatio, 1.5);
  const maxPR = pr;
  renderer.setPixelRatio(pr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, .1, 120);
  camera.position.set(0, 0, CAM_Z);
  const fog = { near: 12, far: 31, col: new THREE.Color() };
  const fogU = () => ({ uFogNear: { value: fog.near }, uFogFar: { value: fog.far }, uFogCol: { value: fog.col } });

  // фон
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,1.,1.); }`,
    fragmentShader: BG_FS, depthWrite: false, depthTest: false, defines: { BG_MODE: 0 },
    uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() } },
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false; bg.renderOrder = -10;
  scene.add(bg);

  // пылинки — общие для всех тем, меняются только цвета
  const dustCol = { a: new THREE.Color(), b: new THREE.Color() };
  function dustLayer(n, z0, z1, order, k) {
    const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = rnd(z0, z1), hh = (CAM_Z - z) * TAN * 1.2;
      const x = z > 0 ? (Math.random() < .5 ? -1 : 1) * rnd(.55, 1.25) * hh * .6 : rnd(-hh, hh);
      pos.set([x, rnd(-hh * 1.2, hh), z], i * 3);
      size[i] = z > 4 ? rnd(6, 14) : rnd(1.5, 5);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: pr }, uIntro: { value: 0 }, uDA: { value: dustCol.a }, uDB: { value: dustCol.b } } });
    m.userData.k = k;
    const p = new THREE.Points(g, m); p.renderOrder = order; p.frustumCulled = false;
    scene.add(p); return m;
  }
  const dustMats = [dustLayer(isMobile ? 260 : 420, -20, -.5, 1, 1), dustLayer(isMobile ? 40 : 60, .5, 8.5, 3, .22)];

  // искры и кольца
  const SP_N = 300;
  const spPos = new Float32Array(SP_N * 3), spLife = new Float32Array(SP_N), spCol = new Float32Array(SP_N * 3);
  const spVel = Array.from({ length: SP_N }, () => new THREE.Vector3());
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('aLife', new THREE.BufferAttribute(spLife, 1));
  spGeo.setAttribute('aCol', new THREE.BufferAttribute(spCol, 3));
  const spMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: { value: pr } } });
  const sparks = new THREE.Points(spGeo, spMat); sparks.frustumCulled = false; sparks.renderOrder = 5; scene.add(sparks);
  let spHead = 0;
  function emit(p, radius, col, n) {
    for (let i = 0; i < n; i++) {
      const j = spHead = (spHead + 1) % SP_N;
      const dir = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
      spPos.set([p.x + dir.x * radius, p.y + dir.y * radius, p.z + dir.z * radius], j * 3);
      spVel[j].copy(dir).multiplyScalar(rnd(.6, 2.4) * radius);
      spLife[j] = rnd(.7, 1);
      spCol.set([col.r, col.g, col.b], j * 3);
    }
  }
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uP: { value: 1 }, uCol: { value: new THREE.Color('#7ff3ff') } } }));
    m.renderOrder = 4; m.visible = false; scene.add(m);
    rings.push({ m, t: 1, size: 3 });
  }

  // пост-обработка; сглаживание MSAA — только на компьютере
  const canMSAA = !isMobile && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: canMSAA ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .6, .4, .86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = true;

  /* ---------- мир темы ---------- */
  let W = 1, H = 1;
  const halfAt = z => { const hh = (CAM_Z - z) * TAN; return { hh, hw: hh * camera.aspect }; };
  let world = null, items = [], abs = [], abMesh = null, flowMat = null, helices = [], themeId = null, def = null, compiled = false;

  function itemMat(spec) {
    const mode = spec.m ?? 0;
    return new THREE.ShaderMaterial({
      vertexShader: ITEM_VS, fragmentShader: ITEM_FS, transparent: true, depthWrite: mode !== 2 && mode !== 3,
      defines: { PATTERN: spec.p ?? 4, MODE: mode },
      uniforms: {
        uColA: { value: new THREE.Color(spec.a) }, uColB: { value: new THREE.Color(spec.b) },
        uTime: { value: 0 }, uHit: { value: 0 }, uDissolve: { value: 0 },
        uBump: { value: spec.bump ?? (spec.p === 1 ? .03 : .018) }, uPatCol: { value: spec.pc ?? 0 },
        uSeed: { value: Math.random() * 10 }, ...fogU(),
      },
    });
  }
  const glowMat = (col, k0, k1) => new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    uniforms: { uCol: { value: new THREE.Color(col) }, uK0: { value: k0 }, uK1: { value: k1 }, uFade: { value: 1 }, ...fogU() } });

  function makeItem(spec) {
    const mats = [], others = [];
    let obj, burstCol = new THREE.Color(spec.b || '#ffffff');
    if (spec.k === 'pinus') {
      const m1 = itemMat(spec), m2 = itemMat({ ...spec, p: 1, bump: .03 });
      m2.uniforms.uColA.value.offsetHSL(.04, 0, .05);
      mats.push(m1, m2);
      obj = new THREE.Group();
      obj.add(new THREE.Mesh(geo('pinusBody'), m1));
      for (const s of [-1, 1]) {
        const sac = new THREE.Mesh(geo('pinusSac'), m2);
        sac.position.set(s * .95, -.28, 0); sac.rotation.z = s * .35; obj.add(sac);
      }
    } else if (spec.k === 'mast') {
      const m = itemMat({ ...spec, p: 0, bump: .01 }); mats.push(m);
      obj = new THREE.Group();
      const cell = new THREE.Mesh(geo('cell'), m); cell.renderOrder = 2; obj.add(cell);
      const gm = glowMat('#ffffff', .5, 1.3); others.push(gm);
      const n = 34, gr = new THREE.InstancedMesh(geo('granule'), gm, n), d = new THREE.Object3D();
      const c1 = new THREE.Color(spec.g), c2 = new THREE.Color(spec.b);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(Math.cbrt(Math.random()) * .7);
        d.position.copy(v); d.scale.setScalar(rnd(.07, .13)); d.updateMatrix();
        gr.setMatrixAt(i, d.matrix); gr.setColorAt(i, c1.clone().lerp(c2, Math.random() * .5));
      }
      obj.add(gr);
      burstCol = c1;
    } else if (spec.k === 'strawberry') {
      const m = itemMat(spec), ml = itemMat({ m: 1, a: '#2c9a37', b: '#9cf07a', p: 4 }); mats.push(m, ml);
      obj = new THREE.Group();
      obj.add(new THREE.Mesh(geo('strawberry'), m), new THREE.Mesh(geo('leaves'), ml));
    } else if (spec.k === 'dandelion') {
      const ms = itemMat({ m: 1, a: '#6b4a2a', b: '#a07848', p: 0, pc: .3, bump: .01 }); mats.push(ms);
      const lm = new THREE.ShaderMaterial({ vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uCol: { value: new THREE.Color('#fff4e0') }, uOpacity: { value: .9 }, uFogNear: { value: fog.near }, uFogFar: { value: fog.far } } });
      lm.userData.base = .9; others.push(lm);
      obj = new THREE.Group();
      const seed = new THREE.Mesh(geo('seed'), ms); seed.position.y = -.72; obj.add(seed);
      obj.add(new THREE.LineSegments(geoCache.pappus ??= pappusGeo(), lm));
    } else {
      const m = itemMat(spec); mats.push(m);
      obj = new THREE.Mesh(geo(spec.k), m);
    }
    return { obj, mats, others, burstCol };
  }

  function disposeWorld() {
    if (!world) return;
    world.traverse(o => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) m.dispose();
      if (o.isInstancedMesh) o.dispose();            // общие геометрии из кэша не трогаем
      if (o.userData.ownGeo) o.geometry.dispose();
    });
    scene.remove(world);
    world = null; items = []; abs = []; abMesh = null; flowMat = null; helices = [];
  }

  function buildWorld(id) {
    disposeWorld();
    themeId = THEMES[id] ? id : DEFAULT_THEME;
    def = DEF[themeId];
    world = new THREE.Group(); scene.add(world);

    const b = def.bg;
    if (bgMat.defines.BG_MODE !== b.mode) { bgMat.defines.BG_MODE = b.mode; bgMat.needsUpdate = true; }
    ['uC0', 'uC1', 'uC2', 'uC3'].forEach((k, i) => bgMat.uniforms[k].value.copy(lin(b.c[i])));
    fog.col.copy(lin(def.fog));
    bloom.strength = def.bloom[0]; bloom.radius = def.bloom[1]; bloom.threshold = def.bloom[2];
    dustCol.a.set(def.dust[0]); dustCol.b.set(def.dust[1]);

    def.items.forEach((spec, i) => {
      const slot = SLOTS[i % SLOTS.length];
      const it = makeItem(spec);
      it.obj.rotation.set(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU));
      if (spec.calm) it.obj.rotation.set(rnd(-.3, .3), rnd(0, TAU), rnd(-.3, .3));
      world.add(it.obj);
      items.push({
        ...it, spec, slot, base: new THREE.Vector3(), radius: 1, sz: spec.sz ?? 1,
        spin: new THREE.Vector3(rnd(-.12, .12), rnd(-.18, .18), rnd(-.08, .08)).multiplyScalar(spec.calm ? .5 : 1),
        ph: rnd(0, TAU), fr: rnd(.12, .22), amp: rnd(.08, .22),
        hit: 0, dis: 0, state: 'live', t: 0, push: new THREE.Vector3(), kick: new THREE.Vector3(),
      });
    });

    // антитела
    const abN = Math.round((isMobile ? 22 : 34) * (def.ab.n || 0));
    if (abN) {
      const m = glowMat(def.ab.col, .12, 1.05);
      abMesh = new THREE.InstancedMesh(geoCache.ab ??= antibodyGeo(), m, abN);
      abMesh.frustumCulled = false; world.add(abMesh);
      const sz = def.ab.size || 1;
      for (let i = 0; i < abN; i++) abs.push({
        nx: rnd(-1.05, 1.05), ny: rnd(-1.05, 1.05), z: rnd(-10, 3.5), s: rnd(.1, .2) * sz,
        rot: new THREE.Euler(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)),
        spin: new THREE.Vector3(rnd(-.4, .4), rnd(-.4, .4), rnd(-.4, .4)), ph: rnd(0, TAU),
        off: new THREE.Vector3(), vel: new THREE.Vector3(),
      });
    }

    // потоки воздуха
    if (def.flow) {
      const n = isMobile ? 4200 : 7000, R = new Float32Array(n * 4), S = new Float32Array(n), pos = new Float32Array(n * 3);
      const lanes = Array.from({ length: 13 }, (_, i) => -1.05 + i * 2.1 / 12);
      for (let i = 0; i < n; i++) {
        R.set([lanes[i % lanes.length] + rnd(-.012, .012), Math.random(), rnd(.8, 1.2), rnd(-8, 1.5)], i * 4);
        S[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aR', new THREE.BufferAttribute(R, 4));
      g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
      flowMat = new THREE.ShaderMaterial({ vertexShader: FLOW_VS, fragmentShader: FLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPR: { value: pr }, uIntro: { value: 0 }, uAsp: { value: 1 }, uTap: { value: new THREE.Vector4(0, 0, -99, 0) },
          uDA: { value: new THREE.Color('#5fdcff') }, uDB: { value: new THREE.Color('#ffffff') } } });
      const pts = new THREE.Points(g, flowMat); pts.frustumCulled = false; pts.renderOrder = 1; pts.userData.ownGeo = true;
      world.add(pts);
    }

    // спирали ДНК
    if (def.dna) {
      for (const cfg of [{ z: -3, x: .62, tilt: .42, n: 64, s: 1 }, { z: -11, x: -.66, tilt: -.5, n: 52, s: .8 }]) {
        const grp = new THREE.Group(), N = cfg.n, R = .55, pitch = .2;
        const sm = glowMat('#ffffff', .35, 1.4), rm = glowMat('#ffffff', .3, .9);
        const sph = new THREE.InstancedMesh(geoCache.dnaS ??= new THREE.SphereGeometry(1, 16, 12), sm, N * 2);
        const rung = new THREE.InstancedMesh(geoCache.dnaR ??= new THREE.CylinderGeometry(1, 1, 1, 6), rm, N);
        const d = new THREE.Object3D(), cA = new THREE.Color('#2ee6ff'), cB = new THREE.Color('#c46bff');
        for (let i = 0; i < N; i++) {
          const a = i * .42, y = (i - N / 2) * pitch;
          const A = new THREE.Vector3(R * Math.cos(a), y, R * Math.sin(a)), B = A.clone().multiply(new THREE.Vector3(-1, 1, -1));
          d.quaternion.identity(); d.scale.setScalar(.09);
          d.position.copy(A); d.updateMatrix(); sph.setMatrixAt(i * 2, d.matrix); sph.setColorAt(i * 2, cA);
          d.position.copy(B); d.updateMatrix(); sph.setMatrixAt(i * 2 + 1, d.matrix); sph.setColorAt(i * 2 + 1, cB);
          d.position.copy(A).add(B).multiplyScalar(.5);
          d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
          d.scale.set(.022, R * 2, .022); d.updateMatrix(); rung.setMatrixAt(i, d.matrix);
          rung.setColorAt(i, cA.clone().lerp(cB, (i % 4) / 3));
        }
        const spin = new THREE.Group(); spin.add(sph, rung);
        grp.add(spin); grp.rotation.z = cfg.tilt;
        world.add(grp);
        helices.push({ grp, spin, mats: [sm, rm], cfg, boost: 0 });
      }
    }
    layout();
    opts.onTheme?.(THEMES[themeId]);
    // шейдеры собираем в фоне (тот же вариант, что рисует composer), чтобы страница не замирала
    compiled = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(composer.readBuffer);
    let job;
    try { job = renderer.compileAsync(scene, camera); } catch (e) { job = Promise.resolve(); }
    renderer.setRenderTarget(prev);
    return job.then(() => { compiled = true; }, () => { compiled = true; });
  }

  function layout() {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    bgMat.uniforms.uRes.value.set(W, H);
    for (const it of items) {
      const { hh, hw } = halfAt(it.slot.z);
      it.base.set(it.slot.x * hw, it.slot.y * hh, it.slot.z);
      it.radius = it.slot.s * it.sz * Math.min(hh, hw * 1.25);
      it.obj.scale.setScalar(it.radius);
    }
    if (flowMat) flowMat.uniforms.uAsp.value = camera.aspect;
    for (const h of helices) {
      const { hh, hw } = halfAt(h.cfg.z);
      h.grp.position.set(h.cfg.x * hw, 0, h.cfg.z);
      h.grp.scale.setScalar(h.cfg.s * Math.max(.6, Math.min(1.2, hh / 3.4)));
    }
  }
  addEventListener('resize', layout);

  /* ---------- ввод ---------- */
  const pointer = new THREE.Vector2(), pointerS = new THREE.Vector2();
  addEventListener('pointermove', e => { pointer.set(e.clientX / W * 2 - 1, -(e.clientY / H * 2 - 1)); }, { passive: true });
  let lastScroll = -1e9;
  addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });

  const px2w = () => 2 * CAM_Z * TAN / H;
  const proj = new THREE.Vector3();
  function screenOf(v) {
    proj.copy(v).project(camera);
    return { x: (proj.x + 1) / 2 * W, y: (1 - proj.y) / 2 * H, z: proj.z };
  }

  let time = 0;
  function burstAt(cx, cy, auto = false) {
    let best = null, bd = 1e9;
    for (const it of items) {
      if (it.state !== 'live') continue;
      const p = it.obj.getWorldPosition(new THREE.Vector3());
      const s = screenOf(p);
      if (s.z > 1 || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
      const rpx = it.radius / px2w() * (CAM_Z / (CAM_Z - p.z));
      const d = Math.hypot(s.x - cx, s.y - cy) - rpx;
      if (d < bd) { bd = d; best = { it, s, p }; }
    }
    if (best && bd < (auto ? 1e9 : 70)) {
      const { it, p, s } = best;
      it.state = 'dissolve'; it.t = 0; it.hit = 1;
      emit(p, it.radius, it.burstCol, it.spec.k === 'mast' ? 110 : 70);
      ring(p, it.radius * 5, it.burstCol);
      shock(p, 2.5);
      if (it.spec.label) opts.onBurst?.(it.spec.label, s.x, s.y);
      if (navigator.vibrate && !auto) navigator.vibrate(12);
      return true;
    }
    // промах — волна в плоскости z=0
    const k = px2w();
    const p = new THREE.Vector3((cx - W / 2) * k, -(cy - H / 2) * k, 0);
    ring(p, 2.4, new THREE.Color(THEMES[themeId].acc[0]));
    shock(p, 1.6);
    if (flowMat) flowMat.uniforms.uTap.value.set(p.x, p.y, time, 1);
    for (const h of helices) h.boost = 1;
    return items.length === 0;
  }
  function ring(p, size, col) {
    const r = rings.find(r => r.t >= 1) || rings[0];
    r.t = 0; r.size = size; r.m.position.copy(p); r.m.visible = true;
    r.m.material.uniforms.uCol.value.copy(col);
  }
  function shock(p, power) {
    for (const it of items) {
      const d = it.obj.position.clone().sub(p);
      const l = Math.max(.5, d.length());
      it.kick.add(d.normalize().multiplyScalar(power / (l * l) * 2.2));
    }
    for (const a of abs) {
      const d = abWorld(a, new THREE.Vector3()).sub(p); const l = Math.max(.4, d.length());
      a.vel.add(d.normalize().multiplyScalar(power / (l * l) * 3));
    }
  }
  function abWorld(a, out) {
    const { hh, hw } = halfAt(a.z);
    return out.set(a.nx * hw, a.ny * hh, a.z).add(a.off);
  }

  /* ---------- цикл ---------- */
  let introT = reduced ? 1 : 0;
  const INTRO = 2.6;
  let last = performance.now(), frameNo = 0, renders = 0;
  let frames = 0, acc = 0, slow = 0;
  const dummy = new THREE.Object3D();

  function frame(now) {
    // пока листают страницу — фон замирает, вся мощность телефона уходит на плавную прокрутку
    frameNo++;
    if (now - lastScroll < 160 && compiled && introT >= 1) { last = now; if (!stopped) requestAnimationFrame(frame); return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    time += dt * (reduced ? .25 : 1);
    if (introT < 1 && compiled) introT = Math.min(1, introT + dt / INTRO);
    const ie = ease(introT);
    opts.onIntro?.(introT);

    pointerS.lerp(pointer, 1 - Math.pow(.02, dt));
    const drift = reduced ? 0 : 1;
    camera.position.set(
      pointerS.x * .55 + Math.sin(time * .21) * .18 * drift,
      pointerS.y * .35 + Math.cos(time * .17) * .12 * drift,
      CAM_Z - (1 - ie) * 7.5);
    camera.lookAt(pointerS.x * .12, pointerS.y * .08, 0);
    fog.near = 2 + ie * 10; fog.far = 6 + ie * 25;

    bgMat.uniforms.uTime.value = time;
    for (const m of dustMats) { m.uniforms.uTime.value = time; m.uniforms.uIntro.value = ie * m.userData.k; m.uniforms.uPR.value = pr; }

    for (const it of items) {
      it.kick.multiplyScalar(Math.pow(.25, dt));
      it.push.addScaledVector(it.kick, dt);
      it.push.multiplyScalar(Math.pow(.55, dt));
      const t = time * it.fr + it.ph;
      it.obj.position.set(
        it.base.x + Math.sin(t) * it.amp + it.push.x,
        it.base.y + Math.cos(t * .8) * it.amp + it.push.y,
        it.base.z + Math.sin(t * .6) * it.amp * .5 + it.push.z);
      const sp = 1 + it.kick.length() * 3;
      if (it.spec.calm) {
        it.obj.rotation.y += it.spin.y * dt * sp;
        it.obj.rotation.x = Math.sin(t * .7) * .25 + it.kick.y * .3;
        it.obj.rotation.z = Math.cos(t * .5) * .3 - it.kick.x * .3;
      } else {
        it.obj.rotation.x += it.spin.x * dt * sp; it.obj.rotation.y += it.spin.y * dt * sp; it.obj.rotation.z += it.spin.z * dt * sp;
      }
      it.hit = Math.max(0, it.hit - dt * 2.2);
      if (it.state === 'dissolve') {
        it.t += dt; it.dis = Math.min(1.02, it.t / .9);
        if (it.t > 2.4) { it.state = 'return'; it.t = 0; }
      } else if (it.state === 'return') {
        it.t += dt; it.dis = Math.max(0, 1 - it.t / 1.4);
        if (it.dis <= 0) it.state = 'live';
      }
      for (const m of it.mats) {
        const u = m.uniforms;
        u.uTime.value = time; u.uHit.value = it.hit; u.uDissolve.value = it.dis;
        u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
      }
      for (const m of it.others) {
        const u = m.uniforms;
        if (u.uOpacity) u.uOpacity.value = m.userData.base * (1 - Math.min(1, it.dis * 1.4));
        if (u.uFade) u.uFade.value = (1 - Math.min(1, it.dis * 1.6)) * ie;
        u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
      }
    }

    if (abMesh) {
      const u = abMesh.material.uniforms;
      u.uFade.value = ie; u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
      for (let i = 0; i < abs.length; i++) {
        const a = abs[i];
        a.vel.multiplyScalar(Math.pow(.3, dt));
        a.off.addScaledVector(a.vel, dt);
        a.off.multiplyScalar(Math.pow(.6, dt));
        abWorld(a, dummy.position);
        dummy.position.x += Math.sin(time * .3 + a.ph) * .3;
        dummy.position.y += Math.cos(time * .23 + a.ph) * .3;
        const sp = 1 + a.vel.length() * 2;
        a.rot.x += a.spin.x * dt * sp; a.rot.y += a.spin.y * dt * sp; a.rot.z += a.spin.z * dt * sp;
        dummy.rotation.copy(a.rot);
        dummy.scale.setScalar(a.s);
        dummy.updateMatrix();
        abMesh.setMatrixAt(i, dummy.matrix);
      }
      abMesh.instanceMatrix.needsUpdate = true;
    }
    if (flowMat) { const u = flowMat.uniforms; u.uTime.value = time; u.uIntro.value = ie; u.uPR.value = pr; }
    for (const h of helices) {
      h.boost = Math.max(0, h.boost - dt * .6);
      h.spin.rotation.y += dt * (.35 + h.boost * 2.5);
      for (const m of h.mats) { m.uniforms.uFade.value = ie; m.uniforms.uFogNear.value = fog.near; m.uniforms.uFogFar.value = fog.far; }
    }

    for (let i = 0; i < SP_N; i++) {
      if (spLife[i] <= 0) continue;
      spLife[i] = Math.max(0, spLife[i] - dt * .9);
      spVel[i].multiplyScalar(Math.pow(.2, dt));
      spPos[i * 3] += spVel[i].x * dt; spPos[i * 3 + 1] += spVel[i].y * dt; spPos[i * 3 + 2] += spVel[i].z * dt;
    }
    spGeo.attributes.position.needsUpdate = true; spGeo.attributes.aLife.needsUpdate = true; spGeo.attributes.aCol.needsUpdate = true;
    spMat.uniforms.uPR.value = pr;
    for (const r of rings) {
      if (r.t >= 1) { r.m.visible = false; continue; }
      r.t = Math.min(1, r.t + dt / .9);
      r.m.material.uniforms.uP.value = ease(r.t);
      r.m.scale.setScalar(r.size);
      r.m.quaternion.copy(camera.quaternion);
    }

    const scrolling = now - lastScroll < 220;
    if (compiled) { renders++; if (useBloom) composer.render(); else renderer.render(scene, camera); }

    frames++; acc += dt;
    if (acc > 1.5) {
      const fps = frames / acc; frames = 0; acc = 0;
      if (opts.still || scrolling || !compiled) { /* не подстраиваемся */ }
      else if (fps < 45 && introT >= 1) {
        slow++;
        if (pr > .75) { pr = Math.max(.75, pr * .8); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); layout(); }
        else if (useBloom) useBloom = false;
      } else if (fps > 58 && pr < maxPR && slow < 3) {
        pr = Math.min(maxPR, pr * 1.1); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); layout();
      }
    }
    if (!stopped) requestAnimationFrame(frame);
  }

  buildWorld(opts.theme);
  let stopped = false;
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopped = true;
    else if (stopped) { stopped = false; last = performance.now(); requestAnimationFrame(frame); }
  });

  let switching = null;
  return {
    burstAt,
    skipIntro() { introT = Math.max(introT, .999); },
    quality: () => ({ pr, useBloom, theme: themeId, frames: frameNo, renders }),
    get theme() { return themeId; },
    // смена темы: экран плавно гаснет, мир пересобирается, экран проявляется
    setTheme(id, instant = false) {
      if (!THEMES[id] || id === themeId) return;
      clearTimeout(switching);
      if (instant) { buildWorld(id); return; }
      canvas.style.transition = 'opacity .45s ease';
      canvas.style.opacity = '0';
      switching = setTimeout(() => buildWorld(id).then(() => requestAnimationFrame(() => { canvas.style.opacity = '1'; })), 470);
    },
  };
}
