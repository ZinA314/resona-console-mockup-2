p='console.src.html'; s=open(p,encoding='utf-8').read()
def rep(a,b):
    global s
    assert a in s,a[:70]; s=s.replace(a,b,1)

# ── 1) 자막 렌더러 교체
a=s.index("function drawLyrics(c){"); b=s.index("/* ═══════════════ CAMERA LAYER")
new=r'''const SC={dir:'h',speed:.5,rot:0,slices:70,inten:.75,ease:1.6,rx:1,ry:1,rndD:false,rndT:false,seed:7,settle:.5,react:.6,area:'band',color:'#ffffff',text:''};
let scPh=0,FDT=.016;
const scSrc=document.createElement('canvas'),scs=scSrc.getContext('2d'),scOut=document.createElement('canvas'),sco=scOut.getContext('2d');
const h3=(a,b,c)=>{const x=Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453;return x-Math.floor(x)};
const sstep=(a,b,x)=>{x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x)};
function wrapLines(c,tx,maxW){const w=c.measureText(tx).width;if(w<=maxW)return[tx];const sp=tx.indexOf(' ',Math.floor(tx.length/2));if(sp<0)return[tx];return[tx.slice(0,sp),tx.slice(sp+1)]}
function motionOf(sec){return sec.lyMotion&&sec.lyMotion!=='inherit'?sec.lyMotion:S.lyMotion}
function drawLyrics(c){const sec=secAt(S.t),mo=motionOf(sec),i=lyAt(S.t),ov=SC.text.trim();
  if(i<0&&!(ov&&mo==='scan'))return;
  const L=i>=0?LY[i]:{t:S.t,e:S.t+1e3,text:ov},text=(ov&&mo==='scan')?ov:L.text,p=i>=0?clamp((S.t-L.t)/(L.e-L.t),0,1):0,
    fade=i>=0?clamp((S.t-L.t)/.18,0,1)*clamp((L.e+.25-S.t)/.25,0,1):1;
  if(mo==='scan')drawScan(c,text,p,fade);else drawBasic(c,{...L,text},p,fade,S.basicMode)}
/* BASIC — 한 번 뿌려지는 방식: once(한번에) · karaoke(채움) · type(글자 순차) */
function drawBasic(c,L,p,fade,mode){const px=S.lySize*(1+SIG.pulse*.015),y=H*S.lyY;c.save();c.textAlign='left';c.textBaseline='middle';c.font=lyFont(px);
  const lines=wrapLines(c,L.text,W-60),n=lines.length,lh=px*1.08,y0=y-(n-1)*lh/2,total=Math.max(1,L.text.replace(/ /g,'').length);let used=0;
  const rise=mode==='once'?(1-clamp((S.t-L.t)/.22,0,1))*px*.35:0;
  lines.forEach((ln,k)=>{const w=c.measureText(ln).width,x=W/2-w/2,yy=y0+k*lh+rise,len=Math.max(1,ln.replace(/ /g,'').length);
    let shown=ln;if(mode==='type'){const f=clamp((clamp(p/.6,0,1)*total-used)/len,0,1);shown=ln.slice(0,Math.ceil(ln.length*f))}
    c.globalAlpha=fade;c.lineJoin='round';c.lineWidth=px*.12;c.strokeStyle='rgba(0,0,0,.85)';c.shadowColor='rgba(0,0,0,.9)';c.shadowBlur=14;c.strokeText(shown,x,yy);c.shadowBlur=0;
    if(mode==='karaoke'){c.fillStyle='rgba(232,228,220,.35)';c.fillText(ln,x,yy);const f=clamp((p*total-used)/len,0,1);c.save();c.beginPath();c.rect(x,0,w*f,H);c.clip();c.fillStyle='#fff';c.fillText(ln,x,yy);c.restore();c.fillStyle='#FF2A00';c.fillRect(x,yy+px*.62,w*f,3)}
    else{c.fillStyle='#fff';c.fillText(shown,x,yy)}
    used+=len});
  c.restore()}
/* SCAN TYPE — 텍스트에 슬릿스캔: 스캔선 뒤쪽 열들이 스캔선 위치의 한 줄로 끌려와 줄무늬로 번진다 (DIA Scan Type 방식) */
function drawScan(c,text,p,fade){
  const area=SC.area==='full'?{x:0,y:0,w:W,h:H}:{x:W*.03,y:H*S.lyY-H*.19,w:W*.94,h:H*.38};
  const tiles=SC.rx*SC.ry,tw=Math.max(60,Math.round(area.w/SC.rx)),th=Math.max(40,Math.round(area.h/SC.ry));
  scSrc.width=tw;scSrc.height=th;scs.clearRect(0,0,tw,th);scs.fillStyle='#fff';scs.textAlign='center';scs.textBaseline='middle';
  // 글자 크기 맞춤 (1줄/2줄 중 큰 쪽)
  scs.font=lyFont(100);let best=null;
  for(const n of [1,2]){const lines=n===1?[text]:wrapLines(scs,text,0);if(n===2&&lines.length<2)continue;const wmax=Math.max(...lines.map(l=>scs.measureText(l).width));
    const px=Math.min(tw*.9/(wmax/100),th*.86/(lines.length*1.04));if(!best||px>best.px*1.15)best={px,lines}}
  const lh=best.px*1.04;scs.font=lyFont(best.px);scs.save();scs.translate(tw/2,th/2);scs.rotate(-SC.rot*Math.PI/180);
  best.lines.forEach((l,k)=>scs.fillText(l,0,(k-(best.lines.length-1)/2)*lh));scs.restore();
  // 스캔 위상 (박자·음량에 반응)
  scPh+=FDT*SC.speed*(1+SC.react*(SIG.rms*1.5+SIG.pulse));
  const ie=clamp(SC.inten*(1-SC.settle*sstep(0,.85,p)),0,1);
  const N=Math.round(clamp(SC.slices,6,tiles>4?80:tiles>1?120:220));
  scOut.width=tw;scOut.height=th;
  for(let iy=0;iy<SC.ry;iy++)for(let ix=0;ix<SC.rx;ix++){
    const r1=h3(ix,iy,SC.seed),r2=h3(ix,iy,SC.seed+11),r3=h3(ix,iy,SC.seed+23);
    const ph=(scPh+(SC.rndT?r1*2:0))%2,sP=ph<1?ph:2-ph,s0=sstep(0,1,sP)*.9+.05;
    let dir=SC.dir,sign=1;if(SC.rndD){if(r2>.5)sign=-1;if(r3>.7)dir=dir==='h'?'v':'h'}
    sco.globalCompositeOperation='source-over';sco.clearRect(0,0,tw,th);sco.imageSmoothingEnabled=false;
    for(let i=0;i<N;i++){const u=(i+.5)/N,uu=sign>0?u:1-u,d=uu-s0;let cc=uu;
      if(d<0){const k=clamp(-d/Math.max(s0,.1),0,1),g=1-ie*Math.pow(k,1/SC.ease);cc=s0+d*g}
      const col=sign>0?cc:1-cc;
      if(dir==='h'){const sx=clamp(Math.floor(col*tw),0,tw-1);sco.drawImage(scSrc,sx,0,1,th,Math.floor(i*tw/N),0,Math.ceil(tw/N)+1,th)}
      else{const sy=clamp(Math.floor(col*th),0,th-1);sco.drawImage(scSrc,0,sy,tw,1,0,Math.floor(i*th/N),tw,Math.ceil(th/N)+1)}}
    sco.globalCompositeOperation='source-in';sco.fillStyle=SC.color;sco.fillRect(0,0,tw,th);
    c.save();c.globalAlpha=fade;c.shadowColor='rgba(0,0,0,.85)';c.shadowBlur=SC.area==='full'?0:12;
    c.translate(area.x+(ix+.5)*tw,area.y+(iy+.5)*th);c.rotate(SC.rot*Math.PI/180);c.drawImage(scOut,-tw/2,-th/2);c.restore()}}
'''
s=s[:a]+new+"\n"+s[b:]
rep("function composite(dt){","function composite(dt){FDT=dt;")
rep("let SEC=[];","let SEC=[];")  # no-op sanity

# ── 2) 상태
rep("camMode:'wall',camOn:false,","lyMotion:'basic',basicMode:'once',camMode:'wall',camOn:false,")
rep("s.pat=R.pat; s.crowd=R.crowd;","s.lyMotion='inherit'; s.pat=R.pat; s.crowd=R.crowd;")

# ── 3) 왼쪽 패널 UI
rep('''      <div class="row"><label>크기</label><input type="range" id="lySize"''','''      <div class="row"><label>모션</label><div class="seg" id="lyMotionSeg"><button data-k="basic" class="on">BASIC</button><button data-k="scan">SCAN TYPE</button></div></div>
      <div class="row" id="basicRow"><label>기본</label><select id="basicSel"><option value="once">한번에 표시</option><option value="karaoke">카라오케 채움</option><option value="type">글자 순차</option></select></div>
      <details id="scanOpts"><summary>SCAN TYPE 설정 <span class="cap" style="text-transform:none;font-family:var(--mono);font-weight:400">· slit-scan</span></summary><div id="scanBody"></div></details>
      <div class="row"><label>크기</label><input type="range" id="lySize"''')
rep(".row label{color:var(--dim);font-size:10px}",".row label{color:var(--dim);font-size:10px}\ndetails summary{cursor:pointer;color:var(--bone);margin-top:7px;font-size:10px;letter-spacing:.06em}details[open] summary{color:var(--alert)}\n.sc{display:grid;grid-template-columns:58px 1fr 30px;gap:5px;align-items:center;margin-top:3px}.sc label{color:var(--dim);font-size:9.5px}.sc .v{text-align:right}\n.sc input[type=text]{grid-column:2/4}.sc input[type=color]{width:100%;height:18px;border:1px solid var(--rule2);background:none;padding:0}")

# ── 4) 설정 JS
ui=r'''
/* 자막 모션 UI */
const SCCFG=[['speed','SPEED',0,200,100],['rot','ROTATION',-90,90,1],['slices','SLICES',6,220,1],['inten','INTENSITY',0,100,100],['ease','EASE',30,400,100],['rx','REPEAT X',1,6,1],['ry','REPEAT Y',1,4,1],['seed','SEED',1,99,1],['settle','SETTLE',0,100,100],['react','REACT',0,100,100]];
$('scanBody').innerHTML=`<div class="sc"><label>DIRECTION</label><div class="seg" id="scDir"><button data-k="h" class="on">↔</button><button data-k="v">↕</button></div><span></span></div>`+
 SCCFG.map(([k,n,mn,mx,sc])=>`<div class="sc"><label>${n}</label><input type="range" min="${mn}" max="${mx}" value="${Math.round(SC[k]*sc)}" data-k="${k}" data-sc="${sc}"><span class="v" id="scv_${k}">${Math.round(SC[k]*sc)}</span></div>`).join('')+
 `<div class="sc"><label>RANDOM</label><div class="seg"><button id="scRD">D 방향</button><button id="scRT">T 시간</button></div><span></span></div>
  <div class="sc"><label>AREA</label><select id="scArea"><option value="band">하단 자막 띠</option><option value="full">화면 전체 (대형 타이포)</option></select><span></span></div>
  <div class="sc"><label>COLOR</label><input type="color" id="scColor" value="#ffffff"><span></span></div>
  <div class="sc"><label>TEXT</label><input type="text" id="scText" placeholder="비우면 가사 사용 · 입력하면 이 글자 고정"></div>
  <div class="cap" style="text-transform:none;font-family:var(--mono);font-weight:400;margin-top:5px;line-height:1.5;color:var(--dim)">SETTLE = 줄이 진행될수록 번짐이 풀려 읽히게 · REACT = 음량·박자에 스캔 속도 반응</div>`;
document.querySelectorAll('#scanBody input[type=range]').forEach(el=>el.oninput=()=>{const sc=+el.dataset.sc,v=+el.value;SC[el.dataset.k]=v/sc;$('scv_'+el.dataset.k).textContent=v});
document.querySelectorAll('#scDir button').forEach(b=>b.onclick=()=>{SC.dir=b.dataset.k;document.querySelectorAll('#scDir button').forEach(x=>x.classList.toggle('on',x===b))});
$('scRD').onclick=e=>{SC.rndD=!SC.rndD;e.currentTarget.classList.toggle('on',SC.rndD)};$('scRT').onclick=e=>{SC.rndT=!SC.rndT;e.currentTarget.classList.toggle('on',SC.rndT)};
$('scArea').onchange=e=>SC.area=e.target.value;$('scColor').oninput=e=>SC.color=e.target.value;$('scText').oninput=e=>SC.text=e.target.value;
function setLyMotion(k){S.lyMotion=k;document.querySelectorAll('#lyMotionSeg button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));$('basicRow').style.display=k==='basic'?'flex':'none';if(k==='scan')$('scanOpts').open=true}
document.querySelectorAll('#lyMotionSeg button').forEach(b=>b.onclick=()=>setLyMotion(b.dataset.k));
$('basicSel').onchange=e=>S.basicMode=e.target.value;
'''
rep("$('btnLy').onclick=()=>{",ui+"$('btnLy').onclick=()=>{")

# ── 5) 섹션별 덮어쓰기 (인스펙터 08)
rep('''      <div class="row"><label>인물 합성</label>''','''      <div class="row"><label>자막 모션</label><div class="seg" id="lyMoSec"><button data-k="inherit">상속</button><button data-k="basic">BASIC</button><button data-k="scan">SCAN</button></div></div>
      <div class="row"><label>인물 합성</label>''')
rep("document.querySelectorAll('#camSecSeg button').forEach(b=>b.onclick=","document.querySelectorAll('#lyMoSec button').forEach(b=>b.onclick=()=>{S.sel.lyMotion=b.dataset.k;renderInspector()});\ndocument.querySelectorAll('#camSecSeg button').forEach(b=>b.onclick=")
rep("  document.querySelectorAll('#camSecSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.k===s.cam));","  document.querySelectorAll('#camSecSeg button').forEach(b=>b.classList.toggle('on',+b.dataset.k===s.cam));\n  document.querySelectorAll('#lyMoSec button').forEach(b=>b.classList.toggle('on',b.dataset.k===(s.lyMotion||'inherit')));")

# ── 6) 단축키 S
rep("else if(e.key==='m'||e.key==='M')","else if(e.key==='s'||e.key==='S')setLyMotion(S.lyMotion==='scan'?'basic':'scan');else if(e.key==='m'||e.key==='M')")
open(p,'w',encoding='utf-8').write(s); print('ok')
