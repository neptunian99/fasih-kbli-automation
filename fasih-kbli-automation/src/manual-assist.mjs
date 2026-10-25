import crypto from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";
import { writeStatusVerified } from "./data.mjs";

const CHANGED_STATUSES = ["#1", "#2", "#3", "#4"];
const ALL_STATUSES = ["#0", ...CHANGED_STATUSES];

export function assignVisibleSlots(existingSlots, ownerRows, limit = 10) {
  const available = new Map(ownerRows.map((row) => [row.rowNumber, row]));
  const used = new Set();
  const slots = (Array.isArray(existingSlots) && existingSlots.length === limit ? [...existingSlots] : Array(limit).fill(null))
    .map((rowNumber) => {
      if (rowNumber !== null && available.has(rowNumber) && !used.has(rowNumber)) {
        used.add(rowNumber); return rowNumber;
      }
      return null;
    });
  for (let slot = 0; slot < slots.length; slot += 1) {
    if (slots[slot] !== null) continue;
    const next = ownerRows.find((row) => !used.has(row.rowNumber));
    if (!next) continue;
    slots[slot] = next.rowNumber; used.add(next.rowNumber);
  }
  return { slots, entries: slots.map((rowNumber, slotIndex) => ({ slotIndex, row: available.get(rowNumber) })).filter((item) => item.row) };
}

const json = (response, status, value) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
};
async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request terlalu besar.");
  }
  return JSON.parse(body || "{}");
}
function assignmentKey(link) {
  const url = new URL(link);
  return `${url.origin}${url.pathname.replace(/\/edit\/?$/i, "").replace(/\/$/, "")}`;
}
function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "google-chrome";
  const args = process.platform === "darwin" ? ["-a", "Google Chrome", url]
    : process.platform === "win32" ? ["/c", "start", "", "chrome", url] : [url];
  execFile(command, args, { windowsHide: true }, () => {});
}

export function pageHtml(token, visibleLimit) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pendamping Pemeriksaan KBLI</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17202a;font:14px system-ui,sans-serif}main{max-width:1180px;margin:28px auto;padding:0 18px}h1{margin:0 0 6px}.muted{color:#68727d}.panel,.card{background:#fff;border:1px solid #dce2e8;border-radius:15px;box-shadow:0 8px 24px #0000000a}.panel{padding:22px}.owner{display:grid;grid-template-columns:minmax(250px,380px) 1fr;gap:18px;align-items:end}.owner label,.target-label{font-weight:750;display:block;margin-bottom:7px}select,input{width:100%;border:1px solid #cbd4dd;border-radius:9px;background:#fff;padding:10px 12px;font:inherit}select:focus,input:focus{outline:3px solid #fed7aa;border-color:#f97316}.list{display:grid;gap:22px;margin-top:22px}.card{padding:22px}.slot{font-size:12px;color:#68727d;font-weight:700}.card h2{margin:8px 0 4px}.chips,.actions,.quick{display:flex;gap:8px;flex-wrap:wrap}.chip{padding:5px 9px;border-radius:999px;background:#eef2f6}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.source{border:1px solid #dce2e8;border-radius:11px;padding:13px;white-space:pre-wrap}.source h3{font-size:14px;margin:0 0 8px}.source.central{background:#fff7ed;border-color:#fb923c}.source.nfrq{background:#eff6ff;border-color:#60a5fa}.evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.evidence div{background:#f7f9fb;border-radius:9px;padding:9px}.evidence strong{display:block;font-size:11px;color:#68727d;margin-bottom:3px}.note{border-left:4px solid #94a3b8;padding:10px 12px;background:#f8fafc;white-space:pre-wrap}.target{margin:16px 0;padding:14px;border:1px solid #dce2e8;border-radius:11px}.suggestions{display:none;border:1px solid #cbd4dd;border-radius:9px;margin-top:5px;max-height:220px;overflow:auto}.suggestions.open{display:block}.suggestion{padding:9px 11px;cursor:pointer;border-bottom:1px solid #eef2f6}.suggestion:hover{background:#fff7ed}.selected{margin-top:7px;color:#18794e;font-weight:700}.quick button,button,a.action{border:0;border-radius:9px;padding:10px 13px;font-weight:700;cursor:pointer;text-decoration:none}.quick button{background:#e2e8f0}.actions{margin-top:15px}.actions button{background:#18794e;color:white}.actions button.zero{background:#2563eb}.actions button.skip{background:#e8edf2;color:#17202a}.actions a{background:#f97316;color:#fff}.actions button:disabled{opacity:.5;cursor:wait}.status{margin-top:12px;min-height:21px;font-weight:650}.error{color:#b42318}@media(max-width:780px){.owner,.compare,.evidence{grid-template-columns:1fr}}
</style></head><body><main><h1>Pendamping Pemeriksaan KBLI</h1><p class="muted">10 slot tetap · sumber Excel lokal · perubahan hanya pada rincian 13.g</p><div id="root" class="panel">Memuat antrean…</div></main><script>
const token=${JSON.stringify(token)},limit=${Number(visibleLimit)};let rows=[],master=[],owners=[],owner='';const slotsByOwner=new Map(),skipped=new Set(),states=new Map();const root=document.querySelector('#root');
${assignVisibleSlots.toString()}
function e(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function encode(value){const bytes=new TextEncoder().encode(JSON.stringify(value));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,options){const response=await fetch(path,options);const result=await response.json();if(!response.ok)throw new Error(result.error||('HTTP '+response.status));return result}
function choiceByCode(code){return master.find(item=>item.code===String(code||''))}
function setTarget(card,item){card.dataset.targetCode=item?.code||'';card.dataset.targetCategory=item?.category||'';card.dataset.targetLabel=item?.label||'';const selected=card.querySelector('.selected');selected.textContent=item?'Target: '+item.label:'Belum ada KBLI target dipilih.';selected.classList.toggle('error',!item)}
function source(title,body,cls=''){const box=e('div',undefined,'source '+cls);box.append(e('h3',title),e('div',body||'—'));return box}
function renderCard(row,slotIndex,total){const card=e('article',undefined,'card');card.dataset.rowNumber=row.rowNumber;card.append(e('div','Slot '+(slotIndex+1)+' · '+total+' usaha ditampilkan','slot'),e('h2',row.businessName),e('div','Baris '+row.rowNumber+' · '+row.owner,'muted'));
const chips=e('div',undefined,'chips');chips.append(e('span','Sebelumnya: '+(row.previousCategory||'—')+' / '+(row.previousCode||'—'),'chip'),e('span','NFRQ: '+(row.nfrqCategory||'—')+' / '+(row.nfrqCode||'—'),'chip'));card.append(chips);
const compare=e('div',undefined,'compare');compare.append(source('KBLI sebelumnya',(row.previousCategory||'—')+' · '+(row.previousCode||'—')),source('Rekomendasi pusat',(row.centralCategory||'—')+'\\nAlasan: '+(row.centralReason||'—'),'central'),source('Rekomendasi NFRQ',(row.nfrqLabel||row.nfrqCode||'—')+'\\nKategori: '+(row.nfrqCategory||'—')+'\\nStatus: '+(row.nfrqStatus||'—')+'\\nAlasan: '+(row.nfrqReason||'—'),'nfrq'));card.append(compare);
const ev=e('div',undefined,'evidence');for(const item of row.evidence){const box=e('div');box.append(e('strong',item.column+' · '+item.label),e('span',item.value));ev.append(box)}card.append(ev);const note=e('div','Catatan AF: '+(row.note||'Tidak ada catatan.'),'note');card.append(note);
const target=e('div',undefined,'target');target.append(e('label','Pilih KBLI target untuk #1–#4','target-label'));const quick=e('div',undefined,'quick');const old=choiceByCode(row.previousCode),nfrq=choiceByCode(row.nfrqCode);if(old){const b=e('button','Pakai KBLI sebelumnya');b.onclick=()=>setTarget(card,old);quick.append(b)}if(nfrq){const b=e('button','Pakai rekomendasi NFRQ');b.onclick=()=>setTarget(card,nfrq);quick.append(b)}target.append(quick);const input=e('input');input.placeholder='Ketik kode atau judul KBLI…';input.autocomplete='off';const suggestions=e('div',undefined,'suggestions');input.oninput=()=>{const q=input.value.trim().toUpperCase();suggestions.replaceChildren();if(q.length<2){suggestions.classList.remove('open');return}for(const item of master.filter(x=>x.code.includes(q)||x.title.toUpperCase().includes(q)).slice(0,30)){const option=e('div',item.label,'suggestion');option.onclick=()=>{input.value=item.label;setTarget(card,item);suggestions.classList.remove('open')};suggestions.append(option)}suggestions.classList.toggle('open',suggestions.childElementCount>0)};target.append(input,suggestions,e('div','Belum ada KBLI target dipilih.','selected error'));card.append(target);
const actions=e('div',undefined,'actions');const link=e('a','Buka FASIH','action');link.href=row.fasihLink;link.target='_blank';actions.append(link);const zero=e('button','Sesuai (#0)','zero');zero.onclick=()=>run(row,card,'#0');actions.append(zero);for(const status of ['#1','#2','#3','#4']){const b=e('button','Ubah data ('+status+')');b.onclick=()=>run(row,card,status);actions.append(b)}const skip=e('button','Lewati','skip');skip.onclick=()=>{skipped.add(row.rowNumber);render()};actions.append(skip);const state=states.get(row.rowNumber);if(state?.running)for(const b of actions.querySelectorAll('button'))b.disabled=true;card.append(actions,e('div',state?.message||'','status'+(state?.error?' error':'')));return card}
function render(){root.replaceChildren();const top=e('div',undefined,'owner');const field=e('div');field.append(e('label','Pilih nama petugas'));const select=e('select');select.append(new Option('— Pilih nama —',''));for(const item of owners)select.append(new Option(item,item));select.value=owner;select.onchange=()=>{owner=select.value;render()};field.append(select);const ownerRows=rows.filter(r=>r.owner===owner&&!skipped.has(r.rowNumber));top.append(field,e('div',owner?'Menampilkan '+Math.min(limit,ownerRows.length)+' dari '+ownerRows.length+' usaha belum selesai.':'Pilih petugas terlebih dahulu.','muted'));root.append(top);if(!owner)return;const assigned=assignVisibleSlots(slotsByOwner.get(owner),ownerRows,limit);slotsByOwner.set(owner,assigned.slots);const list=e('div',undefined,'list');for(const entry of assigned.entries)list.append(renderCard(entry.row,entry.slotIndex,assigned.entries.length));root.append(list);if(!assigned.entries.length)root.append(e('h2','Antrean '+owner+' selesai.'))}
async function waitResult(id){for(let n=0;n<1800;n++){const response=await fetch('/api/result?token='+encodeURIComponent(token)+'&requestId='+encodeURIComponent(id),{cache:'no-store'});const data=await response.json();if(response.status===202){await delay(1000);continue}if(!response.ok)throw new Error(data.error||'Gagal membaca hasil');return data}throw new Error('Proses melewati batas 30 menit.')}
async function run(row,card,status){try{const keepExisting=status==='#0';let target=null;if(!keepExisting){target=choiceByCode(card.dataset.targetCode);if(!target)throw new Error('Pilih KBLI target terlebih dahulu.');if(target.code===row.previousCode&&!confirm('KBLI target sama dengan KBLI sebelumnya. Tetap gunakan '+status+'?'))return}const targetCode=keepExisting?String(row.previousCode||''):target.code;const requestId=crypto.randomUUID();const payload={kind:'kbli',version:2,rowNumber:row.rowNumber,businessName:row.businessName,fasihLink:row.fasihLink,remark:status,suggestedStatus:status,keepExistingKbli:keepExisting,targetCode,targetCategory:target?.category||row.previousCategory||'',targetLabel:target?.label||'',previousCode:row.previousCode};const job={requestId,rowNumber:row.rowNumber,token,callbackUrl:location.origin+'/api/result',createdAt:Date.now(),payload};const url=new URL(row.fasihLink);url.hash='fasih-kbli-auto='+encode(job);const tab=window.open(url.href,'_blank');if(!tab)throw new Error('Pop-up diblokir. Izinkan pop-up untuk halaman ini.');await api('/api/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,requestId,rowNumber:row.rowNumber,status,targetCode})});states.set(row.rowNumber,{running:true,message:keepExisting?'Proses #0 berjalan tanpa mengubah KBLI.':'Proses '+status+' berjalan untuk target '+targetCode+'.'});render();const result=await waitResult(requestId);if(result.outcome==='manual-review'&&result.statusWritten){states.delete(row.rowNumber);rows=rows.filter(r=>r.rowNumber!==row.rowNumber);render();return}if(!result.ok)throw new Error(result.message||'Ekstensi melaporkan kegagalan.');if(!result.statusWritten)throw new Error('FASIH berhasil tetapi status Excel gagal ditulis: '+(result.statusWriteError||'tanpa rincian'));states.delete(row.rowNumber);rows=rows.filter(r=>r.rowNumber!==row.rowNumber);render()}catch(error){states.set(row.rowNumber,{running:false,error:true,message:'Gagal: '+error.message});render()}}
api('/api/data?token='+encodeURIComponent(token)).then(data=>{rows=data.rows;master=data.master;owners=[...new Set(rows.map(r=>r.owner))].sort((a,b)=>a.localeCompare(b,'id'));render()}).catch(error=>{root.textContent='Gagal memuat data: '+error.message;root.classList.add('error')});
</script></body></html>`;
}

export async function runManualAssist({ rows, master, config }) {
  const token = crypto.randomUUID();
  const allowed = new Map(rows.map((row) => [row.rowNumber, row]));
  const jobs = new Map(), results = new Map(), queues = new Map(), requestAssignment = new Map();
  let writeQueue = Promise.resolve();
  const release = (requestId) => {
    const key = requestAssignment.get(requestId); requestAssignment.delete(requestId);
    if (!key) return;
    const remaining = (queues.get(key) ?? []).filter((id) => id !== requestId && jobs.has(id));
    if (remaining.length) queues.set(key, remaining); else queues.delete(key);
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); response.end(pageHtml(token, config.visibleBusinessLimit)); return; }
      if (request.method === "GET" && url.pathname === "/api/data") {
        if (url.searchParams.get("token") !== token) return json(response, 403, { error: "Token tidak valid." });
        return json(response, 200, { rows: [...allowed.values()], master });
      }
      if (request.method === "POST" && url.pathname === "/api/job") {
        const input = await readJson(request); if (input.token !== token) return json(response, 403, { error: "Token tidak valid." });
        const row = allowed.get(Number(input.rowNumber)); const status = String(input.status); const targetCode = String(input.targetCode);
        const validTarget = status === "#0"
          ? targetCode === String(row?.previousCode ?? "")
          : master.some((item) => item.code === targetCode);
        if (!row || !ALL_STATUSES.includes(status) || !validTarget) return json(response, 400, { error: "Paket proses tidak valid." });
        const id = String(input.requestId), key = assignmentKey(row.fasihLink); jobs.set(id, { rowNumber: row.rowNumber, status, targetCode, key }); requestAssignment.set(id, key);
        const queue = (queues.get(key) ?? []).filter((item) => jobs.has(item)); if (!queue.includes(id)) queue.push(id); queues.set(key, queue);
        return json(response, 200, { ok: true, position: queue.indexOf(id) + 1 });
      }
      if (request.method === "GET" && url.pathname === "/api/automation-permit") {
        if (url.searchParams.get("token") !== token) return json(response, 403, { error: "Token tidak valid." });
        const id = String(url.searchParams.get("requestId")); const job = jobs.get(id); if (!job) return json(response, 404, { error: "Proses tidak terdaftar." });
        const queue = (queues.get(job.key) ?? []).filter((item) => jobs.has(item)); queues.set(job.key, queue); const position = queue.indexOf(id) + 1;
        return json(response, position === 1 ? 200 : 202, { permitted: position === 1, position });
      }
      if (request.method === "GET" && url.pathname === "/api/result") {
        if (url.searchParams.get("token") !== token) return json(response, 403, { error: "Token tidak valid." });
        const id = String(url.searchParams.get("requestId")); if (!results.has(id)) return json(response, 202, { pending: true }); const value = results.get(id); results.delete(id); return json(response, 200, value);
      }
      if (request.method === "POST" && url.pathname === "/api/result") {
        const input = await readJson(request); if (input.token !== token) return json(response, 403, { error: "Token tidak valid." });
        const id = String(input.requestId), job = jobs.get(id); if (!job) return json(response, 409, { error: "Proses tidak terdaftar atau sudah selesai." });
        if (Number(input.rowNumber) !== job.rowNumber) return json(response, 409, { error: "Nomor baris callback berbeda." });
        let statusWritten = false, statusWriteError = "";
        const manualReview = input.outcome === "manual-review" && Number(input.errorCount) > 1;
        if (input.ok === true || manualReview) {
          const row = allowed.get(job.rowNumber); if (!row) return json(response, 409, { error: "Baris sudah tidak ada dalam antrean." });
          const finalStatus = manualReview ? "Error" : job.status;
          const task = writeQueue.then(() => writeStatusVerified({ filePath: config.dataFile, sheetName: config.dataSheet, rowNumber: row.rowNumber, status: finalStatus, expectedBusinessName: row.businessName })); writeQueue = task.catch(() => {});
          try { await task; statusWritten = true; allowed.delete(row.rowNumber); } catch (error) { statusWriteError = error.message; }
        }
        results.set(id, { ok: input.ok === true, outcome: manualReview ? "manual-review" : undefined, errorCount: Number(input.errorCount) || undefined, message: String(input.message ?? ""), statusWritten, statusWriteError }); jobs.delete(id); release(id);
        return json(response, 200, { ok: true, closeTab: statusWritten });
      }
      return json(response, 404, { error: "Endpoint tidak ditemukan." });
    } catch (error) { return json(response, 500, { error: error.message }); }
  });
  await new Promise((resolve) => server.listen(Number(config.port) || 0, "127.0.0.1", resolve));
  const address = server.address(); const url = `http://127.0.0.1:${address.port}/`;
  console.log(`Pendamping KBLI aktif: ${url}`); console.log(`Antrean awal: ${rows.length} usaha; master: ${master.length} kode.`); console.log("Biarkan terminal ini tetap terbuka selama pemeriksaan.");
  if (process.env.FASIH_NO_OPEN !== "1") openBrowser(url);
  return new Promise(() => {});
}
