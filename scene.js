// Микромир: пыльца под «электронным микроскопом» вокруг портрета врача.
import * as THREE from 'three';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';
import { mergeGeometries, mergeVertices } from './vendor/addons/utils/BufferGeometryUtils.js';

const FOV = 32, CAM_Z = 12;
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = t => 1 - Math.pow(1 - t, 4);
const clamp01 = t => Math.min(1, Math.max(0, t));

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

const POLLEN_VS = /* glsl */`
attribute float aPat;
varying vec3 vObj; varying vec3 vView; varying vec3 vN; varying float vPat;
varying vec3 vM0; varying vec3 vM1; varying vec3 vM2;
void main(){
  vObj=position; vPat=aPat; vM0=normalMatrix[0]; vM1=normalMatrix[1]; vM2=normalMatrix[2];
  vec4 mv=modelViewMatrix*vec4(position,1.);
  vView=mv.xyz; vN=normalize(normalMatrix*normal);
  gl_Position=projectionMatrix*mv;
}`;

const POLLEN_FS = /* glsl */`
uniform vec3 uColA; uniform vec3 uColB; uniform float uTime; uniform float uHit;
uniform float uDissolve; uniform float uBump; uniform int uPattern;
uniform float uFogNear; uniform float uFogFar; uniform vec3 uFogCol; uniform float uSeed;
varying vec3 vObj; varying vec3 vView; varying vec3 vN; varying float vPat;
varying vec3 vM0; varying vec3 vM1; varying vec3 vM2;
${NOISE}
float pattern(vec3 p){
  float fw;
  if(uPattern==1){ fw=length(fwidth(p))*6.; vec2 v=voro(p*6.+uSeed); return (1.-smoothstep(.02,.16+fw,v.y-v.x))*(1.-smoothstep(.25,.6,fw)); }  // сетчатая (сосна)
  if(uPattern==2){ fw=length(fwidth(p))*8.; return smoothstep(.45,.85,.5+.5*snoise(p*8.+uSeed))*(1.-smoothstep(.2,.5,fw)); }               // бородавчатая
  fw=length(fwidth(p))*10.; return smoothstep(.35,.95,.5+.5*snoise(p*10.+uSeed))*(1.-smoothstep(.2,.5,fw));                                   // зернистая
}
void main(){
  float dn=.5+.5*snoise(vObj*2.6+uSeed);
  if(dn<uDissolve) discard;
  float edge=1.-smoothstep(0.,.07,dn-uDissolve);
  edge*=step(.001,uDissolve);

  vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n;
  // рельеф: градиент узора конечными разностями (без «квадратиков» от dFdx)
  float h=pattern(vObj)*vPat;
  if(vPat>.01){
    float e=.012;
    vec3 g=vec3(pattern(vObj+vec3(e,0.,0.)),pattern(vObj+vec3(0.,e,0.)),pattern(vObj+vec3(0.,0.,e)))*vPat-h;
    g=mat3(vM0,vM1,vM2)*(g/e);
    n=normalize(n-uBump*(g-dot(g,n)*n));
  }
  vec3 v=normalize(-vView);
  float ndv=clamp(dot(n,v),0.,1.);
  float fres=pow(1.-ndv,2.3);
  vec3 L=normalize(vec3(-.55,.75,.55));
  float diff=clamp(dot(n,L)*.5+.5,0.,1.); diff*=diff;
  float back=clamp(dot(n,normalize(vec3(.8,-.2,-.6)))*.5+.5,0.,1.);

  vec3 col=uColA*(.03+.42*diff);
  col*=.7+.6*h;                                    // рельеф как на снимке SEM
  vec3 irid=.5+.5*cos(TAU_*(vec3(0.,.33,.67)+ndv*1.3+uTime*.03+uSeed));
  col+=uColB*fres*.75;
  col+=uColB*pow(fres,5.)*1.6;                     // тонкий яркий контур — только он светится
  col+=irid*fres*.22;
  col+=uColB*pow(back,4.)*.18;
  col+=(uColB*1.6+vec3(.6))*uHit*(.2+fres);
  col+=(uColB*5.+vec3(1.5))*edge;

  float d=length(vView);
  float fog=smoothstep(uFogNear,uFogFar,d);
  col=mix(col,uFogCol,fog*.5);
  gl_FragColor=vec4(col,1.-fog);                   // дальние растворяются в фоне, а не чернеют
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`.replace('TAU_', '6.2831853');

const PORTRAIT_VS = /* glsl */`
varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

const PORTRAIT_FS = /* glsl */`
uniform sampler2D uMap; uniform vec2 uTexel; uniform float uScan; uniform float uTime;
uniform vec3 uRimL; uniform vec3 uRimR; uniform float uFadeBottom;
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 c=texture2D(uMap,vUv);
  float a=smoothstep(.3,.95,c.a);                  // срезаем тёмную кайму от старого фона
  float an=0.;
  for(int i=0;i<8;i++){
    float ang=float(i)*.785398;
    an+=texture2D(uMap,vUv+vec2(cos(ang),sin(ang))*uTexel*7.).a;
  }
  float edge=clamp(a-an/8.,0.,1.)*2.2;
  vec3 rim=mix(uRimL,uRimR,smoothstep(.25,.75,vUv.x));
  vec3 col=c.rgb;
  float l=dot(col,vec3(.299,.587,.114));
  col=mix(col,col*vec3(.86,.96,1.06),.35)*.86;
  col+=rim*edge*(.12+.5*smoothstep(.15,.5,abs(vUv.x-.5)))*smoothstep(.25,.6,l);

  // проявление построчно, как растр электронного микроскопа
  float y=1.-vUv.y;
  float t=uScan*1.35-y;
  float line=exp(-pow(t*55.,2.));
  float gray=1.-smoothstep(0.,.35,t);
  float grain=h21(floor(vUv*vec2(420.,520.))+floor(uTime*24.));
  vec3 sem=vec3(l)*vec3(.82,.96,1.05)*(.85+.3*grain);
  col=mix(col,sem,gray*.92);
  col+=vec3(.55,.95,1.)*line*3.*max(a,.12);

  float fade=smoothstep(0.,uFadeBottom,vUv.y);
  float alpha=max(a*fade*step(0.,t), line*.12*fade);
  gl_FragColor=vec4(col,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BG_FS = /* glsl */`
uniform float uTime; uniform vec2 uRes; uniform vec2 uHalo; uniform float uHaloR; uniform float uIntro;
varying vec2 vUv;
${NOISE}
float fbm(vec3 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*snoise(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec2 asp=vec2(uRes.x/uRes.y,1.);
  vec2 p=vUv*asp;
  float n=fbm(vec3(p*1.6,uTime*.025));
  float m=fbm(vec3(p*1.1+7.3,uTime*.018));
  vec3 col=vec3(.004,.010,.016);
  col+=vec3(.010,.050,.058)*smoothstep(-.3,.7,n);
  col+=vec3(.045,.010,.050)*smoothstep(.15,.85,m);
  float d=length((vUv-uHalo)*asp);
  col+=vec3(.05,.20,.22)*exp(-d*d/(uHaloR*uHaloR))*uIntro;
  col+=vec3(.10,.02,.12)*exp(-pow(length((vUv-vec2(.05,.95))*asp),2.)/.12)*.5;
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
varying float vA; varying float vSeed;
void main(){
  float d=length(gl_PointCoord-.5);
  float a=smoothstep(.5,.0,d); a*=a;
  vec3 c=mix(vec3(.55,.95,1.),vec3(1.,.55,.85),step(.72,vSeed));
  gl_FragColor=vec4(c*a*vA*.9,a*vA);
}`;

const SPARK_VS = /* glsl */`
attribute float aLife; attribute vec3 aCol; uniform float uPR;
varying float vL; varying vec3 vC;
void main(){ vL=aLife; vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.);
  gl_PointSize=(2.+6.*aLife)*uPR*(14./-mv.z); gl_Position=projectionMatrix*mv; }`;
const SPARK_FS = /* glsl */`
varying float vL; varying vec3 vC;
void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d);
  gl_FragColor=vec4(vC*a*vL*3.,a*vL); }`;

const RING_FS = /* glsl */`
uniform float uP; uniform vec3 uCol; varying vec2 vUv;
void main(){ float d=length(vUv-.5)*2.; float r=uP;
  float a=exp(-pow((d-r)*18.,2.))*(1.-uP)+exp(-pow((d-r*.82)*40.,2.))*(1.-uP)*.5;
  gl_FragColor=vec4(uCol*a*2.5,a); }`;

const AB_FS = /* glsl */`
uniform float uIntro; varying vec3 vN; varying vec3 vView;
void main(){ vec3 n=normalize(vN); float f=pow(1.-abs(dot(n,normalize(-vView))),2.);
  vec3 c=vec3(.7,.92,1.)*(.12+1.05*f);
  float d=length(vView); c=mix(c,vec3(.01,.03,.04),smoothstep(12.,30.,d));
  gl_FragColor=vec4(c*uIntro,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const AB_VS = /* glsl */`
varying vec3 vN; varying vec3 vView;
void main(){ vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);
  vView=mv.xyz; vN=normalize(normalMatrix*mat3(instanceMatrix)*normal); gl_Position=projectionMatrix*mv; }`;

/* ---------- геометрия пыльцы ---------- */
function withPat(geo, v) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aPat', new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
  return geo;
}
function fibDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), th = g * i;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}
function deformSphere(fn, ws = 96, hs = 64, scale = [1, 1, 1]) {
  let g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position, d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    const r = fn(d);
    p.setXYZ(i, d.x * r * scale[0], d.y * r * scale[1], d.z * r * scale[2]);
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
  return new THREE.LatheGeometry(pts, 10);
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
    s.deleteAttribute('uv');
    parts.push(withPat(s, .15));
  }
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
const tri = [0, 1, 2].map(i => new THREE.Vector3(Math.cos(i * TAU / 3), Math.sin(i * TAU / 3), 0));
const GEO = {
  helianthus: () => echinate({ n: 54, len: .5, rad: .1 }),
  ambrosia: () => echinate({ n: 70, len: .22, rad: .075, pores: [tri[0], tri[1], tri[2]].map(v => v.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), .3)) }),
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
      let dp = Math.abs(((ph - k * TAU / 3) % TAU + TAU + Math.PI) % TAU - Math.PI);
      r -= .1 * Math.exp(-dp * dp / .012) * (1 - Math.pow(Math.abs(d.y), 3));
    }
    return r;
  }, 96, 64, [.92, 1.16, .92]),
};
function pinusGroup(mat, matSac) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(deformSphere(() => 1, 64, 40, [1.1, .72, .8]), mat);
  g.add(body);
  for (const s of [-1, 1]) {
    const sac = new THREE.Mesh(deformSphere(() => 1, 64, 40, [.78, .74, .8]), matSac);
    sac.position.set(s * .95, -.28, 0); sac.rotation.z = s * .35;
    g.add(sac);
  }
  return g;
}

function antibodyGeo() {
  const parts = [];
  const cap = (len, x, y, rot) => {
    const c = new THREE.CapsuleGeometry(.07, len, 3, 8);
    c.rotateZ(rot); c.translate(x, y, 0); c.deleteAttribute('uv'); parts.push(c);
  };
  cap(.5, 0, -.3, 0);
  cap(.5, -.2, .2, .7);
  cap(.5, .2, .2, -.7);
  return mergeGeometries(parts);
}

/* ---------- сцена ---------- */
export const POLLEN = {
  helianthus: { ru: 'Подсолнечник', la: 'Helianthus' },
  ambrosia: { ru: 'Амброзия', la: 'Ambrosia' },
  betula: { ru: 'Берёза', la: 'Betula' },
  phleum: { ru: 'Тимофеевка', la: 'Phleum' },
  artemisia: { ru: 'Полынь', la: 'Artemisia' },
  pinus: { ru: 'Сосна', la: 'Pinus' },
};

// x, y — доля видимого кадра на своей глубине; s — доля от меньшей стороны кадра
const LAYOUT = [
  { k: 'helianthus', x: -.96, y: .64, z: 3.4, s: .26, a: '#ff2e88', b: '#ff9fcf', p: 0 },
  { k: 'betula', x: .98, y: .10, z: 2.4, s: .20, a: '#14c8d8', b: '#7ff3ff', p: 2 },
  { k: 'ambrosia', x: .68, y: .86, z: -1.6, s: .17, a: '#ffb020', b: '#ffe08a', p: 0 },
  { k: 'pinus', x: -.72, y: .30, z: -4.5, s: .20, a: '#7a5cff', b: '#c4b4ff', p: 0 },
  { k: 'phleum', x: -.92, y: -.26, z: 1.0, s: .15, a: '#8fe23a', b: '#d8ff9a', p: 0 },
  { k: 'artemisia', x: .88, y: -.42, z: -2.6, s: .17, a: '#ff6a3d', b: '#ffc0a0', p: 2 },
  { k: 'ambrosia', x: -.22, y: .96, z: -9, s: .16, a: '#ff2e88', b: '#ffb0d8', p: 0 },
  { k: 'helianthus', x: .46, y: .42, z: -13, s: .22, a: '#14c8d8', b: '#9ff6ff', p: 0 },
  { k: 'betula', x: -.88, y: -.80, z: -8, s: .20, a: '#ffb020', b: '#ffe08a', p: 2 },
  { k: 'phleum', x: .92, y: -.88, z: 4.2, s: .20, a: '#7a5cff', b: '#cfc2ff', p: 0 },
  { k: 'pinus', x: -.98, y: -.66, z: 2.2, s: .17, a: '#ff6a3d', b: '#ffc4ac', p: 0 },
  { k: 'artemisia', x: .14, y: -.32, z: -15, s: .26, a: '#8fe23a', b: '#dcffa8', p: 2 },
];

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

  const fog = { near: 12, far: 31, col: new THREE.Color(0.006, 0.016, 0.024) };

  // фон
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,1.,1.); }`,
    fragmentShader: BG_FS, depthWrite: false, depthTest: false,
    uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uHalo: { value: new THREE.Vector2(.5, .7) }, uHaloR: { value: .3 }, uIntro: { value: 0 } },
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false; bg.renderOrder = -10;
  scene.add(bg);

  // пыльца
  const geoCache = {};
  const grains = [];
  const makeMat = (L, pattern) => new THREE.ShaderMaterial({
    vertexShader: POLLEN_VS, fragmentShader: POLLEN_FS, transparent: true,
    uniforms: {
      uColA: { value: new THREE.Color(L.a) }, uColB: { value: new THREE.Color(L.b) },
      uTime: { value: 0 }, uHit: { value: 0 }, uDissolve: { value: 0 }, uBump: { value: pattern === 1 ? .03 : .018 },
      uPattern: { value: pattern }, uFogNear: { value: fog.near }, uFogFar: { value: fog.far },
      uFogCol: { value: fog.col }, uSeed: { value: Math.random() * 10 },
    },
  });
  for (const L of LAYOUT) {
    let obj; const mats = [];
    if (L.k === 'pinus') {
      const m1 = makeMat(L, 0), m2 = makeMat(L, 1);
      m2.uniforms.uColA.value.offsetHSL(.04, 0, .05);
      mats.push(m1, m2);
      obj = pinusGroup(m1, m2);
    } else {
      geoCache[L.k] ??= GEO[L.k]();
      const m = makeMat(L, L.p); mats.push(m);
      obj = new THREE.Mesh(geoCache[L.k], m);
    }
    obj.rotation.set(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU));
    scene.add(obj);
    grains.push({
      L, obj, mats, base: new THREE.Vector3(), radius: 1,
      spin: new THREE.Vector3(rnd(-.12, .12), rnd(-.18, .18), rnd(-.08, .08)),
      ph: rnd(0, TAU), fr: rnd(.12, .22), amp: rnd(.08, .22),
      hit: 0, dis: 0, state: 'live', t: 0, push: new THREE.Vector3(), kick: new THREE.Vector3(),
    });
  }

  // антитела
  const AB_N = isMobile ? 22 : 34;
  const abMat = new THREE.ShaderMaterial({ vertexShader: AB_VS, fragmentShader: AB_FS, uniforms: { uIntro: { value: 0 } } });
  const abMesh = new THREE.InstancedMesh(antibodyGeo(), abMat, AB_N);
  abMesh.frustumCulled = false;
  scene.add(abMesh);
  const abs = [];
  for (let i = 0; i < AB_N; i++) abs.push({
    nx: rnd(-1.05, 1.05), ny: rnd(-1.05, 1.05), z: rnd(-10, 3.5), s: rnd(.1, .2),
    rot: new THREE.Euler(rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)),
    spin: new THREE.Vector3(rnd(-.4, .4), rnd(-.4, .4), rnd(-.4, .4)), ph: rnd(0, TAU),
    off: new THREE.Vector3(), vel: new THREE.Vector3(),
  });
  const dummy = new THREE.Object3D();

  // пылинки — два слоя: за портретом и перед ним
  function dustLayer(n, z0, z1, order) {
    const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = rnd(z0, z1), hh = (CAM_Z - z) * Math.tan(FOV / 2 * Math.PI / 180) * 1.2;
      // передние пылинки — только по краям, чтобы не садились на лицо
      const x = z > 0 ? (Math.random() < .5 ? -1 : 1) * rnd(.55, 1.25) * hh * .6 : rnd(-hh, hh);
      pos.set([x, rnd(-hh * 1.4, hh), z], i * 3);
      size[i] = z > 4 ? rnd(6, 14) : rnd(1.5, 5);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: pr }, uIntro: { value: 0 } } });
    const p = new THREE.Points(g, m); p.renderOrder = order; p.frustumCulled = false;
    scene.add(p); return m;
  }
  const dustMats = [dustLayer(isMobile ? 260 : 420, -20, -.5, 1), dustLayer(isMobile ? 40 : 60, .5, 8.5, 3)];
  dustMats[1].uniforms.uIntro.value = 0; dustMats[1].userData.k = .45;

  // портрет
  const tex = new THREE.TextureLoader().load(opts.portrait, t => {
    portraitMat.uniforms.uTexel.value.set(1 / t.image.width, 1 / t.image.height);
    portraitAspect = t.image.width / t.image.height;
    layout();
    opts.onReady?.();
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let portraitAspect = .84;
  const portraitMat = new THREE.ShaderMaterial({
    vertexShader: PORTRAIT_VS, fragmentShader: PORTRAIT_FS, transparent: true, depthWrite: false,
    uniforms: {
      uMap: { value: tex }, uTexel: { value: new THREE.Vector2(1 / 700, 1 / 850) }, uScan: { value: 0 }, uTime: { value: 0 },
      uRimL: { value: new THREE.Color('#ff3d9a') }, uRimR: { value: new THREE.Color('#2ee6ff') }, uFadeBottom: { value: .3 },
    },
  });
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), portraitMat);
  portrait.renderOrder = 2;
  portrait.visible = !opts.noPortrait;
  scene.add(portrait);

  // искры и кольцо удара
  const SP_N = 260;
  const spPos = new Float32Array(SP_N * 3), spLife = new Float32Array(SP_N), spCol = new Float32Array(SP_N * 3);
  const spVel = Array.from({ length: SP_N }, () => new THREE.Vector3());
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('aLife', new THREE.BufferAttribute(spLife, 1));
  spGeo.setAttribute('aCol', new THREE.BufferAttribute(spCol, 3));
  const spMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: { value: pr } } });
  const sparks = new THREE.Points(spGeo, spMat); sparks.frustumCulled = false; sparks.renderOrder = 5; scene.add(sparks);
  let spHead = 0;

  const rings = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: PORTRAIT_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uP: { value: 1 }, uCol: { value: new THREE.Color('#7ff3ff') } } }));
    m.renderOrder = 4; m.visible = false; scene.add(m);
    rings.push({ m, t: 1, size: 3 });
  }

  // пост-обработка
  const canMSAA = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: canMSAA ? 4 : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .6, .4, .86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = true;

  /* ---------- раскладка ---------- */
  let W = 1, H = 1;
  const heroEl = opts.hero;
  const halfAt = z => {
    const hh = (CAM_Z - z) * Math.tan(FOV / 2 * Math.PI / 180);
    return { hh, hw: hh * camera.aspect };
  };
  function layout() {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    bgMat.uniforms.uRes.value.set(W, H);
    for (const g of grains) {
      const { hh, hw } = halfAt(g.L.z);
      g.base.set(g.L.x * hw, g.L.y * hh, g.L.z);
      g.radius = g.L.s * Math.min(hh, hw * 1.25);
      g.obj.scale.setScalar(g.radius);
    }
  }
  addEventListener('resize', layout);
  layout();

  // где на экране портрет: по прямоугольнику блока .hero (с учётом прокрутки)
  const px2w = () => 2 * CAM_Z * Math.tan(FOV / 2 * Math.PI / 180) / H;
  function placePortrait() {
    const r = heroEl.getBoundingClientRect();
    const k = px2w();
    const top0 = r.top + Math.min(64, r.height * .1);
    let h = (r.bottom - top0) * 1.04 + 40;
    let pw = h * portraitAspect;
    if (pw > r.width * 1.05) { pw = r.width * 1.05; h = pw / portraitAspect; }
    // низ портрета всегда уходит под край блока — без «отрезанного» края
    const bottom = r.bottom + Math.max(40, h * .08);
    const cx = r.left + r.width / 2, cy = bottom - h / 2;
    portrait.scale.set(pw * k, h * k, 1);
    portrait.position.set((cx - W / 2) * k, -(cy - H / 2) * k, 0);
    // ореол за головой
    bgMat.uniforms.uHalo.value.set(cx / W, 1 - (bottom - h * .8) / H);
    bgMat.uniforms.uHaloR.value = Math.max(.12, pw / H * .45);
  }

  /* ---------- ввод ---------- */
  const pointer = new THREE.Vector2(), pointerS = new THREE.Vector2();
  addEventListener('pointermove', e => {
    pointer.set(e.clientX / W * 2 - 1, -(e.clientY / H * 2 - 1));
  }, { passive: true });

  const proj = new THREE.Vector3();
  function screenOf(v) {
    proj.copy(v).project(camera);
    return { x: (proj.x + 1) / 2 * W, y: (1 - proj.y) / 2 * H, z: proj.z };
  }

  function burstAt(cx, cy, auto = false) {
    // ближайшая к касанию пыльца
    let best = null, bd = 1e9;
    for (const g of grains) {
      if (g.state !== 'live') continue;
      const p = g.obj.getWorldPosition(new THREE.Vector3());
      const s = screenOf(p);
      if (s.z > 1) continue;
      const rpx = g.radius / px2w() * (CAM_Z / (CAM_Z - p.z));
      const d = Math.hypot(s.x - cx, s.y - cy) - rpx;
      if (d < bd) { bd = d; best = { g, s, p }; }
    }
    const hitR = auto ? 1e9 : 70;
    if (best && bd < hitR) {
      const { g, p, s } = best;
      g.state = 'dissolve'; g.t = 0; g.hit = 1;
      const col = g.mats[0].uniforms.uColB.value;
      for (let i = 0; i < 70; i++) {
        const j = spHead = (spHead + 1) % SP_N;
        const dir = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
        spPos.set([p.x + dir.x * g.radius, p.y + dir.y * g.radius, p.z + dir.z * g.radius], j * 3);
        spVel[j].copy(dir).multiplyScalar(rnd(.6, 2.4) * g.radius);
        spLife[j] = rnd(.7, 1);
        spCol.set([col.r, col.g, col.b], j * 3);
      }
      ring(p, g.radius * 5, col);
      shock(p, 2.5);
      opts.onBurst?.(POLLEN[g.L.k], s.x, s.y);
      if (navigator.vibrate && !auto) navigator.vibrate(12);
      return true;
    }
    // промах — волна в плоскости портрета
    const k = px2w();
    const p = new THREE.Vector3((cx - W / 2) * k, -(cy - H / 2) * k, 0);
    ring(p, 2.2, new THREE.Color('#7ff3ff'));
    shock(p, 1.6);
    return false;
  }
  function ring(p, size, col) {
    const r = rings.find(r => r.t >= 1) || rings[0];
    r.t = 0; r.size = size; r.m.position.copy(p); r.m.visible = true;
    r.m.material.uniforms.uCol.value.copy(col);
  }
  function shock(p, power) {
    for (const g of grains) {
      const d = g.obj.position.clone().sub(p);
      const l = Math.max(.5, d.length());
      g.kick.add(d.normalize().multiplyScalar(power / (l * l) * 2.2));
    }
    for (const a of abs) {
      const wp = abWorld(a, new THREE.Vector3());
      const d = wp.sub(p); const l = Math.max(.4, d.length());
      a.vel.add(d.normalize().multiplyScalar(power / (l * l) * 3));
    }
  }
  function abWorld(a, out) {
    const { hh, hw } = halfAt(a.z);
    return out.set(a.nx * hw, a.ny * hh, a.z).add(a.off);
  }

  /* ---------- вступление и цикл ---------- */
  let introT = reduced ? 1 : 0;
  const INTRO = 2.6;
  let last = performance.now(), time = 0;
  let frames = 0, acc = 0, slow = 0;

  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    time += dt * (reduced ? .25 : 1);
    if (introT < 1) introT = Math.min(1, introT + dt / INTRO);
    const ie = ease(introT);
    opts.onIntro?.(introT);

    // камера: отъезд из «объектива», параллакс, прокрутка
    pointerS.lerp(pointer, 1 - Math.pow(.02, dt));
    const sy = scrollY * px2w() * .35;
    const drift = reduced ? 0 : 1;
    camera.position.set(
      pointerS.x * .55 + Math.sin(time * .21) * .18 * drift,
      pointerS.y * .35 + Math.cos(time * .17) * .12 * drift - sy,
      CAM_Z - (1 - ie) * 7.5);
    camera.lookAt(pointerS.x * .12, -sy + pointerS.y * .08, 0);
    fog.near = 2 + ie * 10; fog.far = 6 + ie * 25;

    placePortrait();
    portraitMat.uniforms.uScan.value = reduced ? 1.2 : clamp01((introT - .14) / .6) * 1.15;
    portraitMat.uniforms.uTime.value = time;
    bgMat.uniforms.uTime.value = time;
    bgMat.uniforms.uIntro.value = opts.noPortrait ? 0 : ie;
    for (const m of dustMats) { m.uniforms.uTime.value = time; m.uniforms.uIntro.value = ie * (m.userData.k ?? 1); m.uniforms.uPR.value = pr; }
    abMat.uniforms.uIntro.value = ie;

    // пыльца
    for (const g of grains) {
      g.kick.multiplyScalar(Math.pow(.25, dt));
      g.push.addScaledVector(g.kick, dt);
      g.push.multiplyScalar(Math.pow(.55, dt));
      const t = time * g.fr + g.ph;
      g.obj.position.set(
        g.base.x + Math.sin(t) * g.amp + g.push.x,
        g.base.y + Math.cos(t * .8) * g.amp + g.push.y,
        g.base.z + Math.sin(t * .6) * g.amp * .5 + g.push.z);
      const sp = 1 + g.kick.length() * 3;
      g.obj.rotation.x += g.spin.x * dt * sp;
      g.obj.rotation.y += g.spin.y * dt * sp;
      g.obj.rotation.z += g.spin.z * dt * sp;
      g.hit = Math.max(0, g.hit - dt * 2.2);
      if (g.state === 'dissolve') {
        g.t += dt; g.dis = Math.min(1.02, g.t / .9);
        if (g.t > 2.4) { g.state = 'return'; g.t = 0; g.obj.rotation.set(rnd(0, TAU), rnd(0, TAU), 0); }
      } else if (g.state === 'return') {
        g.t += dt; g.dis = Math.max(0, 1 - g.t / 1.4);
        if (g.dis <= 0) g.state = 'live';
      }
      for (const m of g.mats) {
        const u = m.uniforms;
        u.uTime.value = time; u.uHit.value = g.hit; u.uDissolve.value = g.dis;
        u.uFogNear.value = fog.near; u.uFogFar.value = fog.far;
      }
    }

    // антитела
    for (let i = 0; i < AB_N; i++) {
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

    // искры
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

    if (useBloom) composer.render(); else renderer.render(scene, camera);

    // подстройка качества под телефон
    frames++; acc += dt;
    if (acc > 1.5) {
      const fps = frames / acc; frames = 0; acc = 0;
      if (opts.still) { /* кадр для печати — качество не трогаем */ }
      else if (fps < 42 && introT >= 1) {
        slow++;
        if (pr > .75) { pr = Math.max(.75, pr * .8); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); layout(); }
        else if (useBloom) useBloom = false;
      } else if (fps > 58 && pr < maxPR && slow < 3) {
        pr = Math.min(maxPR, pr * 1.1); renderer.setPixelRatio(pr); composer.setPixelRatio(pr); layout();
      }
    }
    if (!stopped) requestAnimationFrame(frame);
  }
  let stopped = false;
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopped = true;
    else if (stopped) { stopped = false; last = performance.now(); requestAnimationFrame(frame); }
  });

  return {
    burstAt,
    skipIntro() { introT = Math.max(introT, .999); },
    quality: () => ({ pr, useBloom }),
  };
}
