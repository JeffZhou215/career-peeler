/* Render the repository's actual React side panel. Never connects to Apple/OpenAI.
 * Run a local Vite server on127.0.0.1:4177, then NODE_PATH=<...> node this-file.
 * Requires Playwright+Chromium and Sharp; runtime dependencies are not shipped.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'store-assets');
const now = Date.now();
const search = { scanId:'demo-scan', url:'https://jobs.apple.com/en-us/search?team=software-and-services', complete:true, jobsRead:80, pagesRead:8, startedAt:now-120000, completedAt:now-30000 };
function job(id,title,score,extra={}) { return {jobId:String(id),title,url:`https://jobs.apple.com/en-us/details/${id}/demo`,score,eligible:true,stale:false,discoveryStatus:'current_scan',reason:'Relevant software engineering and machine-learning experience supports the main responsibilities.',breakdown:{responsibilities:score,minimum:score,level:90,domain:85},blockers:[],...extra}; }
const ranked = [job(299900001,'Software Engineer, Developer Tools',91),job(299900002,'Machine Learning Engineer',88),job(299900003,'Software Engineer, AI Platform',85),job(299900004,'Software Engineer, Data Services',82)];
const queued = [job(299900005,'Software Engineer, App Experiences',86,{queueStatus:'queued'}),job(299900006,'Machine Learning Engineer, Search',84,{queueStatus:'queued'})];
const roles = [job(299901001,'Infrastructure Software Engineer',52,{favorite:false,protectedFromBatchWithdrawal:false,active:true,submittedAt:'2026-09-15',matchBasis:'job_description'}),job(299901002,'Software Engineer, Developer Tools',89,{favorite:false,protectedFromBatchWithdrawal:false,active:true,submittedAt:'2026-09-16',matchBasis:'job_description'}),job(299901003,'Machine Learning Engineer',92,{favorite:true,protectedFromBatchWithdrawal:true,active:true,submittedAt:'2026-09-17',matchBasis:'job_description'})];
const view={running:false,phase:'Ranking complete',savedJobCount:80,scoresReused:64,ranked,candidates:ranked,queued,excludedMatches:[],staleMatches:[],staleCount:0,applicationFailures:[],capacity:{known:true,submitted:3,remaining:47,checkedAt:now},topN:5,latestSearch:search,searches:{demo:search},latestSearchStrongCount:6};
const archive={pages:{1:{pageIndex:1,pageCount:1,roles,updatedAt:now}},latestScan:{complete:true,inventoryState:'confirmed',accountVerified:true,updatedAt:now,roles,scorePolicyVersion:2}};
const local={appleCareersUserProfile:{userYearsOfExperience:2,afterRanking:'review',llmEnabled:false,llmApiKey:'',workAuthorized:'',requiresSponsorship:''},appleCareersRankingView:{topN:5,query:'',listView:'ranked'},appleSubmissionSyncStatus:{state:'synced',lastSuccessAt:now,lastVerifiedCount:3},appleSubmittedRoleReviews:archive};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.CAREER_PEELER_CAPTURE_BROWSER || 'chrome'});
 try {
 const context=await browser.newContext({viewport:{width:450,height:800},deviceScaleFactor:1,colorScheme:'dark'});
 const errors=[];
 await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'?r.continue():r.abort('blockedbyclient');});
 await context.addInitScript(({local,view})=>{
  const listeners=new Set();const messages=new Set(); const data=structuredClone(local);
  window.chrome={storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},local:{get:async k=>k==null?structuredClone(data):Object.fromEntries((Array.isArray(k)?k:typeof k==='string'?[k]:Object.keys(k)).filter(k=>Object.hasOwn(data,k)).map(k=>[k,structuredClone(data[k])])),set:async patch=>{Object.assign(data,structuredClone(patch));for(const f of listeners)f(Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,{newValue:v}])),'local');},remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete data[k];}},session:{set:async()=>{}}},runtime:{onMessage:{addListener:f=>messages.add(f),removeListener:f=>messages.delete(f)},sendMessage:async m=>m.type==='APPLE_CAREERS_GET_JOB_RANKING'?{ok:true,data:structuredClone(view)}:{ok:false,error:'Offline screenshot: actions disabled.'}},windows:{getCurrent:async()=>({id:1})},tabs:{query:async()=>[],onActivated:{addListener:()=>{},removeListener:()=>{}},onUpdated:{addListener:()=>{},removeListener:()=>{}}}};
 },{local,view});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR:',e)});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error('CONSOLE:',m.text())}});page.on('requestfailed',r=>console.error('FAILED:',r.url(),r.failure()));
 await page.goto('http://127.0.0.1:4177/sidepanel.html',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'Apple Careers',exact:true}).waitFor();
 // Use the real helper for cache signature, avoiding a misleading stale-score banner.
 await page.evaluate(async archive=>{const p=await import('/src/sidepanel/lib/profile.js');archive.latestScan.matchSignature=p.fingerprintText(p.resolveResumeProfileText(p.normalizeProfile({userYearsOfExperience:2,llmEnabled:false}))+'|2');await window.CareerPeelerJobStore.set({appleSubmittedRoleReviews:archive});},archive);
 const shots=[['jobs','screenshot-1-overview-1280x800.png','Rank Your Search','Compare jobs against your resume.','Scan the complete filtered search, review','ranked roles, then choose what to queue.'],['setup','screenshot-2-settings-1280x800.png','Your Resume. Your Settings.','Start with a PDF resume.','Review extracted evidence and saved answers.','Use your own OpenAI key for AI features.'],['submissions','screenshot-3-progress-logs-1280x800.png','Manage Submissions','See capacity and synchronization status.','Search one saved collection, analyze fit,','and explicitly review withdrawal selections.'],['answers','screenshot-4-application-answers-1280x800.png','Your Answers. No Guessing.','Save personal answers explicitly.','Missing or ambiguous answers stop for review.','No inferred legal answers or start dates.']];
 for(const [tab,file,title,sub,l1,l2] of shots){
  await page.getByRole('tab',{name:tab==='jobs'?'Jobs':['setup','answers'].includes(tab)?'Setup':'Submissions',exact:true}).click();
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.querySelector('.ios-workspace').scrollTop=0);
  if(tab==='answers'){
   await page.getByText('Application Profile',{exact:true}).click();
   await page.getByText('Saved Question Answers',{exact:true}).click();
   await page.evaluate(()=>{
    const workspace=document.querySelector('.ios-workspace');
    const target=document.querySelector('label[for="age-over-18"]');
    workspace.scrollTop+=target.getBoundingClientRect().top-workspace.getBoundingClientRect().top-10;
   });
  }
  const raw=await page.screenshot();
  const bg=Buffer.from(`<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#101114"/><stop offset="1" stop-color="#1e2529"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><text x="528" y="186" fill="#51daa5" font-size="17" letter-spacing="4" font-family="Arial,sans-serif">CAREER PEELER · PRIVATE BETA</text><text x="528" y="266" fill="#f6f6f8" font-size="39" font-weight="700" font-family="Arial,sans-serif">${title}</text><text x="528" y="325" fill="#e1e3e7" font-size="24" font-family="Arial,sans-serif">${sub}</text><text x="528" y="375" fill="#a7aab4" font-size="21" font-family="Arial,sans-serif">${l1}</text><text x="528" y="410" fill="#a7aab4" font-size="21" font-family="Arial,sans-serif">${l2}</text><rect x="528" y="668" rx="9" width="646" height="61" fill="#272b31"/><text x="549" y="693" fill="#d5d8df" font-size="15" font-family="Arial,sans-serif">Actual side-panel UI · Sanitized offline demonstration data</text><text x="549" y="714" fill="#a7aab4" font-size="14" font-family="Arial,sans-serif">No real account, applications, withdrawals, credentials or API calls</text></svg>`);
  await sharp(bg).composite([{input:raw,left:24,top:0}]).png().toFile(path.join(out,file));
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Captured four actual React UI screenshots for 0.2.2. External network requests blocked.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
