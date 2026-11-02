import re
p='console.src.html'; s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:70]
    s=s.replace(old,new,count)
rep("const EVENTS = [","let EVENTS = [")
a=s.index("const SEC = ALLIN1.segments"); b=s.index("let looksReady=true;")
new='''let SEC=[];
const FR = ENV.env.fps;
function envAvg(k,a,b){const A=ENV.env[k],i=Math.floor(a*FR),j=Math.max(i+1,Math.floor(b*FR));let s=0;for(let x=i;x<j&&x<A.length;x++)s+=A[x];return s/(j-i)}
const ALL_RMS = envAvg('rms',0,DUR);
function buildSections(segs){
  SEC=segs.map(s=>({start:s.start,end:s.end,label:SEC_COLOR[s.label]?s.label:'verse'}));
  if(SEC[SEC.length-1].end<DUR-1)SEC.push({start:SEC[SEC.length-1].end,end:DUR,label:'outro',ext:true});
  SEC.forEach((s,i)=>{
    s.i=i; s.color=SEC_COLOR[s.label]; s.bars=((s.end-s.start)/(4*60/BPM));
    s.st={rms:envAvg('rms',s.start,s.end),bass:envAvg('bass',s.start,s.end),vocal:envAvg('vocal',s.start,s.end),hi:envAvg('hi',s.start,s.end),drums:envAvg('drums',s.start,s.end)};
    const R=LOOK_RULE[s.label]; s.fx={...R.fx}; s.on={};FXK.forEach(f=>s.on[f.k]=true);
    s.pat=R.pat; s.crowd=R.crowd; s.shot=R.shot; s.cam=R.cam; s.why=R.why;
    const rel=(s.st.rms-ALL_RMS)/ALL_RMS; s.rel=rel;   // 곡 통계로 미세 보정: 평균보다 센 구간은 조도·펀치 가산
    s.fx.light=clamp(s.fx.light+rel*.5,.2,1); s.fx.punch=clamp(s.fx.punch+(s.st.bass-.65)*.6,0,1);
  });
}
/* 라벨 규칙으로 클립 기본 배정 — allin1 JSON 을 새로 불러왔을 때 AI 가 먼저 까는 값 */
function autoEvents(){const ev=[];let verseN=0,chorusN=0;
  SEC.forEach(s=>{const L=s.end-s.start,mid=s.start+L/2,add=(a,b,c)=>ev.push({s:a,e:b,clip:c,ext:s.ext});
    if(s.label==='intro')add(s.start,s.end,'T1');
    else if(s.label==='verse'){const a=verseN++%2?'C2':'C1';add(s.start,mid,a);add(mid,s.end,a==='C1'?'C2':'C1')}
    else if(s.label==='solo')add(s.start,s.end,'C3');
    else if(s.label==='chorus'){if(chorusN++%2&&L>16)add(s.start,s.end,'T2');else add(s.start,s.end,'C1')}
    else if(s.label==='bridge'){const q=L/4;['C3','C4','C1','C4'].forEach((c,i)=>add(s.start+q*i,s.start+q*(i+1),c))}
    else add(s.start,s.end,'C3')});
  EVENTS=ev}
buildSections(ALLIN1.segments);
'''
s=s[:a]+new+s[b:]
rep("const DUR = ENV.duration, BPM = ENV.bpm, BEATS = ENV.beats;","const DUR = ENV.duration; let BPM = ENV.bpm, BEATLIST=null, BEATPOS=null;")
rep("  const bi=Math.floor((t-ENV.beatPhase)/(60/BPM));","  let bi;if(BEATLIST){let lo=0,hi=BEATLIST.length;while(lo<hi){const md=(lo+hi)>>1;if(BEATLIST[md]<=t)lo=md+1;else hi=md}bi=lo-1}else bi=Math.floor((t-ENV.beatPhase)/(60/BPM));")
rep("SIG.bib=((bi%4)+4)%4+1; SIG.bar=Math.floor(bi/4)+1;","SIG.bib=(BEATPOS&&bi>=0)?(BEATPOS[bi]||1):((bi%4)+4)%4+1; SIG.bar=Math.floor(Math.max(0,bi)/4)+1;")
rep("if(V.pps>2){const per=60/BPM;for(let i=0;;i++){const t=ENV.beatPhase+i*per;if(t>V.t0+(TW-GUT)/V.pps+1)break;if(t<V.t0-1)continue;const x=xOf(t),db=i%4===0;",
    "if(V.pps>2){const per=60/BPM;for(let i=0;;i++){const t=BEATLIST?BEATLIST[i]:ENV.beatPhase+i*per;if(t==null||t>V.t0+(TW-GUT)/V.pps+1)break;if(t<V.t0-1)continue;const x=xOf(t),db=BEATPOS?BEATPOS[i]===1:i%4===0;")
loader='''
/* ═══════════════ allin1 JSON 불러오기 ═══════════════
   allin1 출력 형식:  {bpm, beats:[s], downbeats:[s], beat_positions:[1..4], segments:[{start,end,label}]}  */
function loadAnalysis(a,name){
  if(!a||!Array.isArray(a.segments)||!a.segments.length)throw new Error('segments 없음');
  const segs=a.segments.filter(x=>!/^(start|end)$/.test(x.label)).map(x=>({start:+x.start,end:+x.end,label:x.label}));
  if(a.bpm)BPM=a.bpm; if(a.beats&&a.beats.length){BEATLIST=a.beats;BEATPOS=a.beat_positions||null}
  buildSections(segs);autoEvents();S.sel=SEC[0];S.selEv=EVENTS[0];secVisible=true;
  PADN.slice(0,8).forEach((_,i)=>{const el=$('pd'+i);el.style.setProperty('--c',SEC[i]?SEC[i].color:'#333')});
  PIPE[2][1]=`${name||'JSON'} · BPM ${BPM} · ${(a.beats||[]).length||'?'} beats · ${(a.downbeats||[]).length||'?'} downbeats · ${SEC.length} sections`;
  $('pipeSrc').textContent='allin1 JSON · '+(name||'');$('sBpm').textContent=Math.round(BPM);
  const end=segs[segs.length-1].end;$('mismatch').innerHTML=Math.abs(end-DUR)>1?`<b class="warn">⚠ 길이 불일치</b> — JSON ${fmt(end)} / mp3 ${fmt(DUR)}`:`<b style="color:var(--cyan)">✓ 길이 일치</b> — JSON ${fmt(end)} / mp3 ${fmt(DUR)}`;
  lastSecIdx=-1;renderPipe();renderInspector();drawTL();applyLook(true)}
$('btnJson').onclick=()=>$('jsonFile').click();
$('jsonFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{loadAnalysis(JSON.parse(await f.text()),f.name)}catch(err){$('mismatch').innerHTML='<b class="warn">JSON 오류</b> '+err.message}e.target.value=''};
'''
rep("window.R={S,SEC,EVENTS",loader+"window.R={S,get SEC(){return SEC},get EVENTS(){return EVENTS},loadAnalysis")
rep('<button class="btn" id="btnRun">','<button class="btn" id="btnJson" style="margin-top:6px">allin1 JSON 불러오기</button><input type="file" id="jsonFile" accept=".json" hidden>\n      <button class="btn" id="btnRun">')
# 카메라 캔버스 재사용
rep("let prevMot=null,motion=new Float32Array(64*36),fdet=null,faces=[];","let prevMot=null,motion=new Float32Array(64*36),fdet=null,faces=[];\nconst mkC=document.createElement('canvas');mkC.width=64;mkC.height=36;const mkX=mkC.getContext('2d');const stC=document.createElement('canvas');stC.width=W;stC.height=H;const stX=stC.getContext('2d');const tileC=document.createElement('canvas');const tileX=tileC.getContext('2d');")
i0=s.index("    const mk=document.createElement('canvas');mk.width=64;mk.height=36;"); i1=s.index("    c.drawImage(st,0,0);c.globalCompositeOperation='source-over';return}")
s=s[:i0]+"""    const id=mkX.createImageData(64,36);for(let i=0;i<motion.length;i++){const a=clamp(motion[i]*1.6,0,1)*255;id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=255;id.data[i*4+3]=a}mkX.putImageData(id,0,0);
    stX.globalCompositeOperation='source-over';stX.clearRect(0,0,W,H);tigerStripes(stX,0,0,W,H,S.t,'#FF6A1F',22,4);stX.globalCompositeOperation='destination-in';stX.imageSmoothingEnabled=true;stX.drawImage(mkC,0,0,W,H);stX.globalCompositeOperation='source-over';
"""+s[i1:]
rep("    c.drawImage(st,0,0);c.globalCompositeOperation='source-over';return}","    c.drawImage(stC,0,0);return}")
s=re.sub(r"    const tw=Math\.max\(6,Math\.round\(w\*\(1-mos\*\.9\)/ \(1\)\)\);const t2=document\.createElement\('canvas'\);\n","",s,count=1)
rep("const px=Math.max(6,Math.round(w*(1-mos*.92)/1)),s2=document.createElement('canvas');s2.width=px;s2.height=Math.round(px*h/w);s2.getContext('2d').drawImage(camVid,sx,sy,sw,sh2,0,0,s2.width,s2.height);\n    c.imageSmoothingEnabled=false;c.filter='grayscale(.6) contrast(1.2)';c.drawImage(s2,x,y,w,h);c.filter='none'}",
    "const px=Math.max(6,Math.round(w*(1-mos*.92)));tileC.width=px;tileC.height=Math.max(4,Math.round(px*h/w));tileX.drawImage(camVid,sx,sy,sw,sh2,0,0,tileC.width,tileC.height);\n    c.imageSmoothingEnabled=false;c.filter='grayscale(.6) contrast(1.2)';c.drawImage(tileC,x,y,w,h);c.filter='none'}")
open(p,'w',encoding='utf-8').write(s); print('patched')
