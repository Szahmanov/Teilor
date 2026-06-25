/* Tailor — Autonomous Career Application Manager (StaGove)
   Runs entirely in the browser on the user's own free Groq key.
   No backend, no telemetry. Every application is a persistent on-device project. */

(() => {
  "use strict";

  const PROXY_URL = "/api/groq";
  const FALLBACK_MODEL = "llama-3.1-8b-instant";
  const GATE = 85, MAX_REVISIONS = 2;
  const LS = { apps:"tailor.apps" };
  const getModel = () => "llama-3.3-70b-versatile";

  const STAGES = ["Created","CV tailored","Cover letter","Interview prep","Applied","Interview set","Offer"];

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const el = (t,c,h) => { const n=document.createElement(t); if(c)n.className=c; if(h!=null)n.innerHTML=h; return n; };
  const esc = (s) => String(s??"").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const clamp = (n) => Math.max(0,Math.min(100,Math.round(Number(n)||0)));
  const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
  let logLines=[];
  const log=(l)=>{logLines.push(l); if($("agentLog"))$("agentLog").textContent=logLines.join("\n");};
  function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2800);}

  /* ---------- state ---------- */
  const loadApps=()=>{try{return JSON.parse(localStorage.getItem(LS.apps)||"[]")}catch{return[]}};
  const saveApps=(a)=>localStorage.setItem(LS.apps,JSON.stringify(a.slice(0,40)));
  const getApp=(id)=>loadApps().find(a=>a.id===id);
  function upsertApp(app){const a=loadApps();const i=a.findIndex(x=>x.id===app.id);if(i>=0)a[i]=app;else a.unshift(app);saveApps(a);}
  let editingId=null;   // app id being created/edited
  let openId=null;      // app id open in workspace

  /* =====================================================================
     GROQ CALL LAYER
     ===================================================================== */
  async function groq(messages,{json=false,model=getModel(),temperature=0.4,retry=true}={}){
    const headers={"Content-Type":"application/json"};
    const body={model,messages,temperature,max_tokens:2200};
    if(json) body.response_format={type:"json_object"};
    let res;
    try{ res=await fetch(PROXY_URL,{method:"POST",headers,body:JSON.stringify(body)}); }
    catch{ throw new Error("NETWORK"); }
    if(res.status===401) throw new Error("BAD_KEY");
    if(res.status===429){
      if(retry&&model!==FALLBACK_MODEL){log(`  · rate-limited, retrying on ${FALLBACK_MODEL}…`);await sleep(1200);return groq(messages,{json,model:FALLBACK_MODEL,temperature,retry:false});}
      throw new Error("RATE_LIMIT");
    }
    if(!res.ok){const t=await res.text().catch(()=>"");throw new Error("API_"+res.status+(t?": "+t.slice(0,120):""));}
    const d=await res.json();
    return d?.choices?.[0]?.message?.content?.trim()||"";
  }
  async function groqJSON(messages,opts={}){
    const raw=await groq(messages,{...opts,json:true});
    const p=tryParse(raw); if(p) return p;
    log("  · malformed JSON — repairing…");
    const fixed=await groq([{role:"system",content:"Return ONLY valid minified JSON. No prose, no fences."},{role:"user",content:"Fix into valid JSON:\n\n"+raw}],{...opts,json:true,temperature:0});
    return tryParse(fixed)||{};
  }
  function tryParse(s){if(!s)return null;let t=s.replace(/```json/gi,"").replace(/```/g,"").trim();const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a!==-1&&b!==-1)t=t.slice(a,b+1);try{return JSON.parse(t)}catch{return null}}

  /* =====================================================================
     PIPELINE
     ===================================================================== */
  const STEPS=[
    ["read","Reading posting, company & CV"],
    ["score","Scoring ATS & simulating recruiter"],
    ["diagnose","Diagnosing resume health"],
    ["cv","Tailoring CV (draft → audit → revise)"],
    ["letter","Writing tone-matched cover letter"],
    ["plan","Interview prep, roadmap & probability"],
  ];
  function renderPipeline(){
    const ol=$("pipeline");ol.innerHTML="";
    STEPS.forEach(([id,label])=>{const li=el("li");li.id="step-"+id;li.append(el("span","ico","&middot;"),el("span","label",esc(label)),el("span","note"));ol.append(li);});
  }
  const stepState=(id,st,note)=>{const li=$("step-"+id);if(!li)return;li.className=st;if(st==="done")li.querySelector(".ico").innerHTML="&#10003;";if(note)li.querySelector(".note").textContent=note;};
  const safe=async(fn,fb={})=>{try{return await fn()}catch(e){if(["NO_KEY","BAD_KEY","RATE_LIMIT","NETWORK"].includes(e.message))throw e;log("  · step error: "+e.message);return fb;}};

  async function runAgent(job,cv){
    logLines=[];log("StaGove · Tailor — run @ "+new Date().toLocaleString());log("model: "+getModel());
    renderPipeline();$("run").hidden=false;

    const done={};

    // 1 — read everything
    stepState("read","active");log("\n[1] Extracting posting, company, and CV");
    const [jobco,cvData]=await Promise.all([
      safe(()=>groqJSON([
        {role:"system",content:"Expert recruiter. Extract a job posting AND read the company behind it. JSON only."},
        {role:"user",content:`Return JSON: role_title, company_name (string — company name if present in posting, else "the company"), seniority, must_have (array), nice_to_have (array), keywords (array of ATS keywords a screener scans for), hard_skills (array), soft_skills (array), responsibilities (array), red_flags (array, may be empty), company:{culture, communication_style, priorities (array), tone_recommendation, tone_reason}.\n\nPOSTING:\n${job}`}
      ],{temperature:0.2})),
      safe(()=>groqJSON([
        {role:"system",content:"Extract structured facts from a CV. Invent nothing. JSON only."},
        {role:"user",content:`Return JSON: skills (array), hard_skills (array), soft_skills (array), titles (array), domains (array), years_estimate (string), achievements (array of concrete accomplishments, keep numbers), raw_bullets (array of the candidate's real lines), metrics_present (boolean — does the CV contain quantified results).\n\nCV:\n${cv}`}
      ],{temperature:0.2})),
    ]);
    done.job=!!jobco.role_title; done.company=!!jobco.company_name; done.cv=!!(cvData.skills||cvData.raw_bullets);
    log("  · "+(jobco.must_have?.length||0)+" must-haves, "+(jobco.keywords?.length||0)+" ATS keywords; CV "+(cvData.skills?.length||0)+" skills");
    stepState("read","done");

    // 2 — ATS + recruiter (two calls, shown as one step)
    stepState("score","active");log("\n[2] ATS simulation + recruiter simulation");
    const ats=await safe(()=>groqJSON([
      {role:"system",content:"You simulate an Applicant Tracking System scoring a CV against a posting. JSON only."},
      {role:"user",content:`Return JSON: ats_score (0-100), keyword_coverage (0-100), matched_keywords (array), missing_keywords (array), keyword_density (short string e.g. "healthy"/"thin"/"stuffed"), hard_skills_coverage (0-100), soft_skills_coverage (0-100), formatting_risk ("Low"/"Medium"/"High"), likely_problems (array of short strings).\n\nPOSTING:\n${JSON.stringify({keywords:jobco.keywords,hard_skills:jobco.hard_skills,soft_skills:jobco.soft_skills,must_have:jobco.must_have})}\n\nCV:\n${JSON.stringify(cvData)}`}
    ]));
    done.ats=ats.ats_score!=null;
    const review=await safe(()=>groqJSON([
      {role:"system",content:"You are a candid recruiter giving a first-read verdict. Honest, not flattering. JSON only."},
      {role:"user",content:`Return JSON: fit_overall (0-100), verdict (one honest sentence), criteria (array of exactly 4 {name,score,why} for Skills match, Experience level, Domain fit, Keyword/ATS coverage), recruiter:{first_impression ("Positive"/"Mixed"/"Weak"), strengths (array 3-4), weaknesses (array 2-4), likely_questions (array 3-5), likely_concerns (array), reading_time_seconds (integer), interest_level ("High"/"Medium"/"Low"), interview_chance (0-100), why (one sentence)}.\n\nPOSTING:\n${JSON.stringify(jobco)}\n\nCV:\n${JSON.stringify(cvData)}`}
    ]));
    done.recruiter=!!review.recruiter;
    log("  · ATS "+(ats.ats_score??"?")+"/100 · recruiter interview chance "+(review.recruiter?.interview_chance??"?")+"%");
    stepState("score","done",(ats.ats_score??"?")+"% ATS");

    // 3 — resume health
    stepState("diagnose","active");log("\n[3] Resume health diagnosis");
    const risk=await safe(()=>groqJSON([
      {role:"system",content:"You audit a CV's writing quality. JSON only."},
      {role:"user",content:`Return JSON: risk_score (0-100, higher = more problems), risk_level ("Low"/"Medium"/"High"), findings (array of {issue, present:boolean} for: Weak bullet points, Generic wording, Repeated action verbs, Missing numbers, Long paragraphs, Weak summary, Empty sections, Weak achievements), reasons (array of short strings), recommendations (array of concrete fixes).\n\nCV:\n${JSON.stringify(cvData)}`}
    ]));
    done.risk=risk.risk_score!=null;
    log("  · resume risk "+(risk.risk_score??"?")+"/100 ("+(risk.risk_level||"?")+")");
    stepState("diagnose","done",(risk.risk_level||"?"));

    // 4 — tailor CV with audit→revise + decisions
    stepState("cv","active");log("\n[4] Tailoring CV — draft → audit("+GATE+") → revise");
    const cvRes=await draftAuditRevise({
      kind:"tailored CV",
      draft:()=>groqJSON([
        {role:"system",content:"You tailor a candidate's REAL experience to a posting. Never invent experience, skills, employers, numbers or qualifications not in their CV. Only reword and reframe what exists so it mirrors the posting and surfaces ATS keywords. JSON only."},
        {role:"user",content:`Return JSON: summary (2-3 sentence professional summary tuned to this role, true to the candidate), bullets (array 5-7 achievement bullets rewritten from real experience, weaving in posting keywords naturally, quantified only where the candidate gave numbers), keywords_used (array), decisions (array of {decision, reason, confidence (0-100), expected_effect} — the key tailoring choices you made).\n\nPOSTING:\n${JSON.stringify(jobco)}\n\nCANDIDATE (only use what is here):\n${JSON.stringify(cvData)}`}
      ]),
      audit:(d)=>groqJSON([
        {role:"system",content:"Strict reviewer of tailored CVs. JSON only."},
        {role:"user",content:`Return JSON: score (0-100), pass (boolean true only if >=${GATE} and nothing fabricated), fabrication (boolean), issues (array of fixes). Judge keyword coverage, truthfulness, specificity, ATS-safety.\n\nTRUE CV:\n${JSON.stringify(cvData)}\n\nKEYWORDS:\n${JSON.stringify(jobco.keywords)}\n\nDRAFT:\n${JSON.stringify(d)}`}
      ]),
      revise:(d,issues)=>groqJSON([
        {role:"system",content:"Revise the tailored CV to fix issues. Never fabricate. Same JSON shape (keep decisions)."},
        {role:"user",content:`Fix:\n${JSON.stringify(issues)}\n\nDRAFT:\n${JSON.stringify(d)}\n\nTRUE CV:\n${JSON.stringify(cvData)}`}
      ]),
    });
    done.cv_tailored=!!cvRes.data; done.cv_revised=cvRes.revisions>0;
    stepState("cv","done",cvRes.meta);

    // 5 — cover letter (tone-matched) with audit→revise
    stepState("letter","active");log("\n[5] Cover letter — tone-matched, audited");
    const tone=jobco.company?.tone_recommendation||"professional and specific";
    const letterRes=await draftAuditRevise({
      kind:"cover letter",isText:true,
      draft:()=>groq([
        {role:"system",content:`Write a concise cover letter (~180-240 words) in the candidate's voice, tone: ${tone}. Open on the company's real need, connect 2-3 genuine achievements, close with a confident interview ask. Never invent experience. No clichés. Plain paragraphs.`},
        {role:"user",content:`POSTING:\n${JSON.stringify(jobco)}\n\nCANDIDATE:\n${JSON.stringify(cvData)}\n\nSTRENGTHS:\n${JSON.stringify(review.recruiter?.strengths||[])}`}
      ],{temperature:0.55}),
      audit:(d)=>groqJSON([
        {role:"system",content:"Strict cover-letter reviewer. JSON only."},
        {role:"user",content:`Return JSON: score(0-100), pass(boolean true only if >=${GATE}), fabrication(boolean), issues(array). Judge specificity to THIS company, truthfulness, persuasiveness, ~200 words, no clichés, tone matches "${tone}".\n\nTRUE CANDIDATE:\n${JSON.stringify(cvData)}\n\nLETTER:\n${d}`}
      ]),
      revise:(d,issues)=>groq([
        {role:"system",content:"Rewrite the letter fixing each issue, same voice and length. Never fabricate. Return only the letter."},
        {role:"user",content:`Issues:\n${JSON.stringify(issues)}\n\nLETTER:\n${d}`}
      ],{temperature:0.45}),
    });
    done.letter=!!letterRes.text;
    stepState("letter","done",letterRes.meta);

    // 6 — prep + roadmap + probability
    stepState("plan","active");log("\n[6] Interview prep, roadmap & probability");
    const prep=await safe(()=>groqJSON([
      {role:"system",content:"Interview coach. JSON only."},
      {role:"user",content:`Return JSON: questions (array of 5 objects {q, approach} where "approach" is a full 2-3 sentence answer using the STAR method drawn from the candidate's real experience — not just the word STAR), recruiter_questions (array of {q, recommended_answer} — full sentence answers to the recruiter's likely concerns using only the real CV), ask_them (array of 3 strings — sharp questions the candidate should ask the interviewer).\n\nPOSTING:\n${JSON.stringify(jobco)}\n\nCANDIDATE:\n${JSON.stringify(cvData)}\n\nCONCERNS:\n${JSON.stringify(review.recruiter?.likely_concerns||review.recruiter?.weaknesses||[])}`}
    ]));
    done.prep=!!prep.questions;
    const road=await safe(()=>groqJSON([
      {role:"system",content:"Career strategist. JSON only."},
      {role:"user",content:`Current ATS score is ${ats.ats_score??60}. Return JSON: potential_ats (0-100, realistic ceiling after fixes), recommendations (array of concrete improvements ordered by impact), estimated_improvement (string like "+17%"), interview_chance (0-100), offer_chance (0-100), confidence ("High"/"Medium"/"Low"), why (one sentence).\n\nGAPS:\n${JSON.stringify(review.weaknesses||review.recruiter?.weaknesses||[])}\n\nMISSING KEYWORDS:\n${JSON.stringify(ats.missing_keywords||[])}`}
    ]));
    done.roadmap=road.potential_ats!=null; done.probability=road.interview_chance!=null;
    log("  · roadmap "+(ats.ats_score??"?")+" → "+(road.potential_ats??"?")+" · offer chance "+(road.offer_chance??"?")+"%");
    stepState("plan","done");

    log("\n✓ Run complete — "+Object.values(done).filter(Boolean).length+" autonomous tasks finished.");

    return {jobco,cvData,ats,review,risk,cv:cvRes,letter:letterRes,prep,road,done,ts:Date.now()};
  }

  /* the agentic core */
  async function draftAuditRevise({kind,draft,audit,revise,isText}){
    let cur=await draft(),attempt=0,last=0,revs=0;
    while(attempt<=MAX_REVISIONS){
      const a=await audit(cur);last=clamp(a.score);const fab=a.fabrication===true;
      log(`  · audit ${kind}: ${last}/100${fab?" ⚠ fabrication flag":""}`);
      if((a.pass===true||last>=GATE)&&!fab)break;
      if(attempt===MAX_REVISIONS){log(`  · kept best after ${revs} revision(s)`);break;}
      log(`  · below gate — revising`);
      cur=await revise(cur,a.issues||["raise specificity & keyword coverage"]);revs++;attempt++;
    }
    return {data:isText?null:cur,text:isText?cur:null,score:last,revisions:revs,meta:`audited ${last}/100 · ${revs}× revised`};
  }

  /* readiness = blended health of the application */
  function readiness(a){
    const v=[a.ats?.ats_score,a.review?.fit_overall,a.risk?.risk_score!=null?100-a.risk.risk_score:null,a.review?.recruiter?.interview_chance].filter(x=>x!=null).map(Number);
    return v.length?clamp(v.reduce((p,c)=>p+c,0)/v.length):0;
  }

  /* =====================================================================
     RUN ORCHESTRATION (create / improve)
     ===================================================================== */
  async function doRun(){
    const job=$("jobInput").value.trim(),cv=$("cvInput").value.trim();
    if(job.length<60){toast("Paste a fuller job posting.");$("jobInput").focus();return;}
    if(cv.length<60){toast("Paste your CV or fuller experience.");$("cvInput").focus();return;}
    const btn=$("runBtn");btn.disabled=true;btn.textContent="Working…";
    try{
      const analysis=await runAgent(job,cv);
      // build / update the project
      const existing=editingId?getApp(editingId):null;
      const id=existing?existing.id:"app_"+analysis.ts;
      const snapshot={ts:analysis.ts,ats:clamp(analysis.ats?.ats_score),keyword:clamp(analysis.ats?.keyword_coverage),interview:clamp(analysis.review?.recruiter?.interview_chance),readiness:readiness(analysis)};
      const app={
        id,
        title:analysis.jobco?.role_title||existing?.title||"Untitled role",
        company:analysis.jobco?.company_name||existing?.company||"the company",
        job,cv,
        stageIndex:Math.max(existing?.stageIndex||0,3), // auto-advance to "Interview prep"
        rejected:existing?.rejected||false,
        notes:existing?.notes||"",
        analysis,
        history:[...(existing?.history||[]),snapshot],
        createdAt:existing?.createdAt||analysis.ts,
        updatedAt:analysis.ts,
      };
      upsertApp(app);
      openWorkspace(id);
      toast(existing?"Application updated — see what improved.":"Application created.");
    }catch(e){
      const info=explainError(e);toast(info.msg);log("\n✗ "+info.msg);
    }finally{btn.disabled=false;btn.textContent="Run my career agent";$("run").hidden=true;}
  }

  /* =====================================================================
     VIEWS
     ===================================================================== */
  function showView(v){
    ["dashboard","editor","workspace"].forEach(x=>$(x).hidden=(x!==v));
    window.scrollTo({top:0,behavior:"auto"});
  }
  function openDashboard(){openId=null;renderDashboard();showView("dashboard");}
  function openEditor(id){
    editingId=id||null;
    const a=id?getApp(id):null;
    $("editorEyebrow").textContent=a?"Improve application":"New application";
    $("jobInput").value=a?a.job:"";$("cvInput").value=a?a.cv:"";updateCounts();$("run").hidden=true;
    showView("editor");$("jobInput").focus();
  }

  /* ---- dashboard ---- */
  function renderDashboard(){
    const apps=loadApps();
    $("emptyState").classList.toggle("show",apps.length===0);
    const grid=$("appGrid");grid.innerHTML="";
    // stats
    const stats=$("dashStats");
    if(apps.length){
      stats.hidden=false;stats.innerHTML="";
      const offers=apps.filter(a=>a.stageIndex>=6&&!a.rejected).length;
      const active=apps.filter(a=>!a.rejected&&a.stageIndex<6).length;
      const avg=apps.length?Math.round(apps.reduce((p,a)=>p+readiness(a.analysis||{}),0)/apps.length):0;
      [["Applications",apps.length],["Active",active],["Offers",offers],["Avg. readiness",avg+"%"]].forEach(([l,v])=>{
        const s=el("div","dash-stat");s.innerHTML=`<b>${v}</b><span>${l}</span>`;stats.append(s);
      });
    }else stats.hidden=true;

    apps.forEach(a=>{
      const an=a.analysis||{};
      const card=el("button","app-card");
      const ats=clamp(an.ats?.ats_score),rec=clamp(an.review?.recruiter?.interview_chance),rd=readiness(an);
      const stage=a.rejected?"Rejected":STAGES[Math.min(a.stageIndex||0,6)];
      const pillCls=a.rejected?"rejected":(a.stageIndex>=6?"offer":"");
      card.innerHTML=
        `<div class="ac-top"><div><p class="ac-role">${esc(a.title)}</p><p class="ac-co">${esc(a.company)}</p></div>`+
        `<span class="stage-pill ${pillCls}">${esc(stage)}</span></div>`+
        `<div class="ac-scores"><span class="mini">ATS <b>${ats}%</b></span><span class="mini">Recruiter <b>${rec}%</b></span><span class="mini">Ready <b>${rd}%</b></span></div>`+
        `<div class="ac-bar"><i style="width:${rd}%"></i></div>`+
        `<div class="ac-foot"><span>${a.history?.length||1} version${(a.history?.length||1)>1?"s":""}</span><span>${new Date(a.updatedAt).toLocaleDateString()}</span></div>`;
      card.addEventListener("click",()=>openWorkspace(a.id));
      grid.append(card);
    });
  }

  /* ---- workspace ---- */
  function openWorkspace(id){openId=id;renderWorkspace(getApp(id));showView("workspace");}
  function renderWorkspace(a){
    if(!a){openDashboard();return;}
    const an=a.analysis||{};
    $("wsRole").textContent=a.title;$("wsCompany").textContent=a.company;
    $("wsUpdated").textContent="Updated "+new Date(a.updatedAt).toLocaleString();
    renderTracker(a);

    // score strip
    const strip=$("scoreStrip");strip.innerHTML="";
    const items=[
      ["ATS score",clamp(an.ats?.ats_score)+"%",an.ats?.keyword_density?("keywords "+an.ats.keyword_density):""],
      ["Recruiter fit",clamp(an.review?.fit_overall)+"%",an.review?.verdict?"":""],
      ["Interview chance",clamp(an.review?.recruiter?.interview_chance)+"%","recruiter sim"],
      ["Resume health",(100-clamp(an.risk?.risk_score))+"%",an.risk?.risk_level||""],
      ["Readiness",readiness(an)+"%","blended"],
    ];
    items.forEach(([l,v,s])=>{const n=el("div","ss");n.innerHTML=`<span class="micro">${l}</span><b>${v}</b>${s?`<small>${esc(s)}</small>`:""}`;strip.append(n);});

    // jump nav
    const nav=$("wsNav");nav.innerHTML="";
    [["p-ats","ATS"],["p-recruiter","Recruiter"],["p-risk","Health"],["p-roadmap","Roadmap"],["p-prob","Odds"],["p-cv","CV"],["p-letter","Letter"],["p-prep","Prep"],["p-log","Log"]].forEach(([id,l])=>{const x=el("a",null,l);x.href="#"+id;nav.append(x);});

    renderTasks(an);
    renderATS(an.ats||{});
    renderRecruiter(an.review||{});
    renderRisk(an.risk||{});
    renderRoadmap(an);
    renderProb(an.road||{});
    renderDelta(a);
    renderCompany(an.jobco?.company||{});
    renderCV(an.cv?.data||{},an.cv?.meta);
    renderLetter(an.letter?.text,an.letter?.meta,an.jobco?.company);
    renderPrep(an.prep||{});
    renderDecisions(an.cv?.data?.decisions||[]);
    $("agentLog").textContent=logLines.join("\n")||"(trace available on the run that created this version)";
    $("notesInput").value=a.notes||"";
  }

  function renderTracker(a){
    const t=$("tracker");t.innerHTML="";t.classList.toggle("rejected",!!a.rejected);
    STAGES.forEach((s,i)=>{
      const step=el("button","step"+(i<a.stageIndex?" done":i===a.stageIndex?" current":""));
      step.innerHTML=`<div class="dot"></div><span class="lbl">${esc(s)}</span>`;
      step.addEventListener("click",()=>{const app=getApp(openId);app.stageIndex=i;app.rejected=false;app.updatedAt=Date.now();upsertApp(app);renderWorkspace(app);});
      t.append(step);
    });
    const rt=$("rejectToggle");
    rt.textContent=a.rejected?"Reopen application":"Mark as rejected";
    rt.classList.toggle("is-rejected",!!a.rejected);
  }

  function renderTasks(an){
    const d=an.done||{};
    const rows=[
      ["Extracted job requirements",d.job],["Researched the company",d.company],["Structured your CV",d.cv],
      ["Evaluated ATS compatibility",d.ats],["Simulated a recruiter review",d.recruiter],["Diagnosed resume health",d.risk],
      ["Tailored your CV",d.cv_tailored],["Audited & rewrote weak sections",d.cv_revised??d.cv_tailored],
      ["Generated a tone-matched cover letter",d.letter],["Built interview preparation",d.prep],
      ["Estimated interview & offer probability",d.probability],["Created an improvement roadmap",d.roadmap],
    ];
    const ul=$("taskList");ul.innerHTML="";
    rows.forEach(([l,ok])=>{const li=el("li",ok?"":"skip",esc(l));ul.append(li);});
  }

  function gauge(node,val,label,col){
    val=clamp(val);node.style.setProperty("--v",val);if(col)node.style.setProperty("--col",col);
    node.innerHTML=`<div class="g-in"><b>${val}<small style="display:inline">%</small></b><small>${esc(label||"")}</small></div>`;
  }

  function renderATS(ats){
    $("atsStamp").textContent=ats.formatting_risk?("Formatting risk: "+ats.formatting_risk):"";
    gauge($("atsGauge"),ats.ats_score,"ATS");
    const bars=$("atsBars");bars.innerHTML="";
    [["Keyword coverage",ats.keyword_coverage],["Hard skills",ats.hard_skills_coverage],["Soft skills",ats.soft_skills_coverage]].forEach(([l,v])=>{
      const b=el("div","ats-bar");b.innerHTML=`<div class="ab-top"><span>${l}</span><b>${clamp(v)}%</b></div><div class="track"><i style="width:${clamp(v)}%"></i></div>`;bars.append(b);
    });
    const miss=$("atsMissing");miss.innerHTML="";
    (ats.missing_keywords||[]).slice(0,12).forEach(k=>miss.append(el("span","kw-tag",esc(k))));
    if(!(ats.missing_keywords||[]).length)miss.append(el("span","kw-tag ok","No critical gaps"));
    fill("atsProblems",ats.likely_problems);
  }

  function renderRecruiter(r){
    const rec=r.recruiter||{};
    const imp=rec.first_impression||"Mixed";
    const badge=$("recBadge");badge.textContent=imp;badge.className="badge"+(/pos/i.test(imp)?"":/weak/i.test(imp)?" bad":" warn");
    const ch=clamp(rec.interview_chance);$("recMeter").style.width=ch+"%";$("recChance").textContent=ch+"%";
    const f=$("recFacts");f.innerHTML="";
    [["Interest",rec.interest_level||"—"],["Reading time",(rec.reading_time_seconds?rec.reading_time_seconds+"s":"—")]].forEach(([l,v])=>{const c=el("div","rec-fact");c.innerHTML=`<b>${esc(String(v))}</b>${l}`;f.append(c);});
    fill("recStrengths",rec.strengths);fill("recWeak",rec.weaknesses);
    fill("recQuestions",rec.likely_questions);
  }

  function renderRisk(risk){
    const lvl=risk.risk_level||"—";
    const badge=$("riskBadge");badge.textContent=lvl+" risk";badge.className="badge"+(/low/i.test(lvl)?"":/high/i.test(lvl)?" bad":" warn");
    gauge($("riskGauge"),100-clamp(risk.risk_score),"health",getComputedStyle(document.documentElement).getPropertyValue("--pine"));
    const fnd=$("riskFindings");fnd.innerHTML="";
    (risk.findings||[]).forEach(x=>{const row=el("div","rf");row.innerHTML=`<span>${esc(x.issue)}</span><span class="rf-flag ${x.present?"bad":"ok"}">${x.present?"needs work":"ok"}</span>`;fnd.append(row);});
    fill("riskRecs",risk.recommendations);
  }

  function renderRoadmap(an){
    const now=clamp(an.ats?.ats_score),pot=clamp(an.road?.potential_ats||now);
    $("roadNow").textContent=now+"%";$("roadPot").textContent=pot+"%";
    $("roadGain").textContent=an.road?.estimated_improvement||("+"+Math.max(0,pot-now)+"%");
    fill("roadList",an.road?.recommendations);
  }

  function renderProb(road){
    $("probInterview").textContent=clamp(road.interview_chance)+"%";
    $("probOffer").textContent=clamp(road.offer_chance)+"%";
    $("probConf").textContent="Confidence: "+(road.confidence||"—");
    $("probWhy").textContent=road.why||"";
  }

  function renderDelta(a){
    const h=a.history||[];const panel=$("p-delta");
    if(h.length<2){panel.hidden=true;return;}
    panel.hidden=false;const prev=h[h.length-2],cur=h[h.length-1];
    const g=$("deltaGrid");g.innerHTML="";
    [["ATS score","ats"],["Keyword coverage","keyword"],["Interview chance","interview"],["Readiness","readiness"]].forEach(([l,k])=>{
      const o=clamp(prev[k]),n=clamp(cur[k]),diff=n-o;const dir=diff>0?"up":diff<0?"down":"same";const sign=diff>0?"+":"";
      const c=el("div","delta");c.innerHTML=`<span class="micro">${l}</span><span class="d-val">${o}% → <b>${n}%</b> <span class="${dir}">(${sign}${diff})</span></span>`;g.append(c);
    });
  }

  function renderCompany(co){
    const g=$("companyGrid");g.innerHTML="";
    const cells=[["Culture",co.culture],["Communication",co.communication_style],["Likely priorities",(co.priorities||[]).join(", ")],["Cover-letter tone",co.tone_recommendation]];
    cells.forEach(([l,v])=>{const c=el("div","co-cell");c.innerHTML=`<span class="micro">${l}</span><p>${esc(v||"—")}</p>`;g.append(c);});
  }

  function renderCV(cv,meta){
    $("cvStamp").textContent=meta||"";
    let h="";
    if(cv.summary)h+=`<h4>Professional summary</h4><p>${esc(cv.summary)}</p>`;
    if(cv.bullets?.length)h+=`<h4>Tailored experience</h4><ul>${cv.bullets.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>`;
    if(cv.keywords_used?.length)h+=`<h4>Posting keywords worked in</h4><p>${cv.keywords_used.map(esc).join(" · ")}</p>`;
    $("cvOut").innerHTML=h||"<p>No output.</p>";
  }
  function renderLetter(text,meta,co){
    $("letterStamp").textContent=meta||"";
    $("letterTone").textContent=co?.tone_recommendation?`Tone matched to the company: ${co.tone_recommendation}.`:"";
    $("letterOut").innerHTML=`<p>${esc(text||"")}</p>`;
  }
  function renderPrep(p){
    let h="";
    if(p.questions?.length){h+=`<h4>Likely questions &amp; how to answer</h4>`;p.questions.forEach(q=>h+=`<div class="qa"><span class="q">${esc(q.q)}</span><p>${esc(q.approach)}</p></div>`);}
    if(p.recruiter_questions?.length){h+=`<h4>Answering the recruiter's concerns</h4>`;p.recruiter_questions.forEach(q=>h+=`<div class="qa"><span class="q">${esc(q.q)}</span><p>${esc(q.recommended_answer)}</p></div>`);}
    if(p.ask_them?.length)h+=`<h4>Ask the interviewer</h4><ul>${p.ask_them.map(x=>`<li>${esc(typeof x==="string"?x:x.q||x.question||JSON.stringify(x))}</li>`).join("")}</ul>`;
    $("prepOut").innerHTML=h||"<p>No output.</p>";
  }
  function renderDecisions(d){
    const box=$("decisions");box.innerHTML="";
    if(!d.length){box.innerHTML='<p class="panel-note">No discrete decisions were logged on this run.</p>';return;}
    d.forEach(x=>{const n=el("div","dec");n.innerHTML=`<div class="dec-act">${esc(x.decision)}</div><div class="dec-reason">${esc(x.reason||"")}</div><div class="dec-meta"><span>Confidence <b>${clamp(x.confidence)}%</b></span><span>Effect: ${esc(x.expected_effect||"—")}</span></div>`;box.append(n);});
  }

  function fill(id,arr){const n=$(id);n.innerHTML="";(arr||[]).forEach(x=>n.append(el("li",null,esc(typeof x==="string"?x:x.text||JSON.stringify(x)))));if(!arr||!arr.length)n.append(el("li",null,"—"));}

  /* plain-text export */
  function plainText(id){
    const a=getApp(openId)?.analysis||{};
    if(id==="cvOut"){const cv=a.cv?.data||{};let t="TAILORED CV\n\n";if(cv.summary)t+=cv.summary+"\n\n";if(cv.bullets)t+=cv.bullets.map(b=>"• "+b).join("\n");return t;}
    if(id==="letterOut")return a.letter?.text||"";
    return $(id).innerText.trim();
  }

  /* =====================================================================
     ERRORS
     ===================================================================== */
  function explainError(e){
    const m=String(e.message||e);
    if(m.includes("GROQ_API_KEY"))return{msg:"Server configuration error — GROQ_API_KEY is not set on the host."};
    if(m==="RATE_LIMIT")return{msg:"Groq's free limit is busy right now. Wait a minute and run again."};
    if(m==="NETWORK")return{msg:"Couldn't reach the server. Check your connection."};
    return{msg:"Something went wrong: "+m};
  }

  /* =====================================================================
     SAMPLE + WIRING
     ===================================================================== */
  const SAMPLE_JOB=`Junior Data Analyst — FinTech (Remote, EU)
Northbridge Payments is a fast-growing payments company. You'll turn raw transaction data into dashboards and answers for product and ops.
Responsibilities: build and maintain SQL queries; create dashboards in Looker or Power BI; analyse user funnels and churn; present findings to non-technical stakeholders.
Requirements: solid SQL; Python (pandas); experience with a BI tool; clear communication; attention to detail. Nice to have: A/B testing, dbt, finance background. We value curiosity, ownership and fast iteration.`;
  const SAMPLE_CV=`Maria Ivanova — Sofia
Recent economics graduate (BSc, 2025).
Internship, Operations Analyst at a logistics startup (6 months): wrote SQL queries to pull delivery data, built weekly Excel dashboards that cut reporting time by ~40%, presented results to the ops manager.
University projects: Python (pandas) analysis of public transport data; churn analysis on a public telecom dataset.
Skills: SQL, Excel, Python (pandas, matplotlib), basic statistics. Languages: Bulgarian (native), English (fluent).`;

  function updateCounts(){$("jobCount").textContent=$("jobInput").value.length;$("cvCount").textContent=$("cvInput").value.length;}

  document.addEventListener("DOMContentLoaded",()=>{
    renderDashboard();showView("dashboard");
    $("jobInput")&&$("jobInput").addEventListener("input",updateCounts);
    $("cvInput")&&$("cvInput").addEventListener("input",updateCounts);
    $("newAppBtn").addEventListener("click",()=>openEditor(null));
    $("emptyNewBtn").addEventListener("click",()=>openEditor(null));
    $("brandHome").addEventListener("click",openDashboard);
    $("editorBack").addEventListener("click",openDashboard);
    $("wsBack").addEventListener("click",openDashboard);
    $("runBtn").addEventListener("click",doRun);
    $("sampleBtn").addEventListener("click",()=>{$("jobInput").value=SAMPLE_JOB;$("cvInput").value=SAMPLE_CV;updateCounts();toast("Sample loaded — run the agent.");});
    $("wsImprove").addEventListener("click",()=>openEditor(openId));
    $("wsDelete").addEventListener("click",()=>{if(confirm("Delete this application permanently?")){saveApps(loadApps().filter(x=>x.id!==openId));openDashboard();toast("Application deleted.");}});
    $("rejectToggle").addEventListener("click",()=>{const a=getApp(openId);a.rejected=!a.rejected;a.updatedAt=Date.now();upsertApp(a);renderWorkspace(a);});
    $("notesInput").addEventListener("input",()=>{const a=getApp(openId);if(!a)return;a.notes=$("notesInput").value;upsertApp(a);});
    document.querySelectorAll(".copy-btn").forEach(b=>b.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(plainText(b.dataset.copy));toast("Copied.");}catch{toast("Copy failed — select manually.");}}));
  });

  /* PWA */
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  let deferred=null;
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;$("installBtn").hidden=false;});
  document.addEventListener("DOMContentLoaded",()=>{$("installBtn").addEventListener("click",async()=>{if(!deferred)return;deferred.prompt();await deferred.userChoice;deferred=null;$("installBtn").hidden=true;});});
})();
