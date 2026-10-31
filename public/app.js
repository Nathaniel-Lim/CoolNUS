const $ = id => document.getElementById(id);
let state, selectedRole = 'atc', selectedId = 'ATC-1', selectedResource = null, toastTimer, jsonText = '';
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Singapore', hour12: false });
const shortTime = iso => clock(iso).slice(0, 5);
const now = () => new Date(Date.parse(state.startedAt) + state.elapsedSeconds * 1000).toISOString();
const crews = () => state.ground.crews.flat();
const resources = () => [...state.airport.runways, ...state.airport.taxiways, ...state.airport.gates];
const phase = text => `<span class="badge ${esc(text)}">${esc(text.replaceAll('_', ' '))}</span>`;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500); }
async function request(url, body) {
  try {
    const result = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await result.json(); if (!result.ok) throw new Error(data.error || 'Request failed.'); return data;
  } catch (error) { toast(error.message); throw error; }
}
async function act(command, actor = { role: 'operator', id: 'OPERATOR' }) {
  const result = await request('/api/actions', { actor, expectedRevision: state.revision, command }); render(result);
}
async function control(type, extra = {}) { render(await request('/api/control', { type, ...extra })); }
function fire(fn) { Promise.resolve().then(fn).catch(() => {}); }
function svgMap() {
  const color = r => r.status === 'closed' ? '#e7a270' : r.occupiedBy ? '#91bdda' : '#b8e78e';
  const runway = (r, y) => `<g data-resource="${r.id}" role="button" tabindex="0" aria-label="Inspect runway ${esc(r.name)}"><rect x="90" y="${y}" width="940" height="52" rx="3" fill="#0b1214" stroke="${color(r)}" stroke-width="1.3"/><path d="M145 ${y + 26}H975" stroke="#d4ddd2" stroke-width="2" stroke-dasharray="30 26" opacity=".6"/>${Array.from({length:5},(_,i)=>`<path d="M110 ${y+9+i*7}h22 M990 ${y+9+i*7}h22" stroke="#a4b0a5" stroke-width="3"/>`).join('')}<text x="90" y="${y-15}" fill="${color(r)}" font-size="12">${esc(r.name)}</text><text x="1030" y="${y-15}" text-anchor="end" font-size="10" fill="${color(r)}">${r.status === 'closed' ? 'CLOSED / '+esc(r.reason) : r.occupiedBy ? 'RESERVED / '+esc(r.occupiedBy) : 'AVAILABLE'}</text>${r.status === 'closed' ? `<text x="560" y="${y+35}" text-anchor="middle" fill="#e7a270" font-size="30">×</text>` : ''}</g>`;
  const taxi = (r, x1, x2, y) => `<g data-resource="${r.id}" role="button" tabindex="0" aria-label="Inspect taxiway ${r.name}"><path d="M${x1} 127V${y}H${x2}V267" fill="none" stroke="#263936" stroke-width="21" stroke-linejoin="round"/><path d="M${x1} 127V${y}H${x2}V267" fill="none" stroke="${color(r)}" opacity=".6" stroke-width="2" stroke-dasharray="${r.status === 'closed' ? '6 6' : '0'}"/><text x="${(x1+x2)/2}" y="${y-12}" fill="${color(r)}" font-size="11">${esc(r.id)} / ${r.status.toUpperCase()}</text></g>`;
  const gates = state.airport.gates.map((g,i) => { const x=190+i*145; return `<g data-resource="${g.id}" role="button" tabindex="0" aria-label="Inspect ${g.name}"><path d="M${x} 385V440" stroke="${color(g)}" stroke-width="2" opacity=".55"/><rect x="${x-47}" y="440" width="94" height="64" rx="5" fill="${g.occupiedBy?'#1d3038':'#1a2c24'}" stroke="${color(g)}" stroke-opacity=".7"/><text x="${x}" y="482" text-anchor="middle" fill="${color(g)}" font-size="12">${g.id}</text></g>`; }).join('');
  const aircraft = state.pilots.filter(p=>!['departed','diverted'].includes(p.phase)).map((p,i)=>{
    let x=140+Math.max(0,i-2)*180,y=38,angle=90;
    if (['landing','takeoff'].includes(p.phase)) { const duration=p.phase==='landing'?60:45; x=160+(1-p.remainingSeconds/duration)*780; y=p.runwayId==='RWY-1'?101:241; }
    else if (['at_gate','ready'].includes(p.phase)) { x=190+(Number(p.gateId?.slice(1)||1)-1)*145; y=457; angle=0; }
    else if (['taxi_in','taxi_out','holding_short'].includes(p.phase)) { const progress=p.phase==='taxi_out'?1-p.remainingSeconds/90:p.phase==='holding_short'?1:p.remainingSeconds/90; const gx=190+(Number(p.gateId?.slice(1)||1)-1)*145; x=gx+(p.taxiwayId==='TWY-A'?175-gx:945-gx)*progress; y=385-45*progress; }
    return `<g data-pilot="${p.id}" role="button" tabindex="0" aria-label="Inspect pilot ${p.id}"><circle cx="${x}" cy="${y}" r="16" fill="#91bdda14"/><path transform="translate(${x} ${y}) rotate(${angle})" d="M0-12 3-3 11 3 11 6 3 3 2 10 5 12 5 14 0 12-5 14-5 12-2 10-3 3-11 6-11 3-3-3Z" fill="${p.maintenanceHold?'#e7a270':'#edf1e9'}"/><text x="${x+19}" y="${y+4}" fill="#c9d9cf" font-size="10">${esc(p.callsign)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 1120 565" xmlns="http://www.w3.org/2000/svg" aria-label="Schematic airport with two runways, two taxiways and six gates"><defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#2b413c" stroke-width=".5" opacity=".4"/></pattern></defs><rect width="1120" height="565" fill="url(#grid)"/><text x="1030" y="35" text-anchor="end" fill="#60756e" font-size="10">N ↑ · NOT TO SCALE</text>${taxi(state.airport.taxiways[0],175,440,175)}${taxi(state.airport.taxiways[1],945,680,190)}<path d="M175 267V385H945V267" stroke="#263936" stroke-width="21" fill="none"/><path d="M175 267V385H945V267" stroke="#7e9a72" stroke-width="1.4" fill="none" opacity=".6"/><text x="560" y="362" text-anchor="middle" fill="#78918a" font-size="10" letter-spacing="3">APRON / STAND ACCESS</text>${runway(state.airport.runways[0],75)}${runway(state.airport.runways[1],215)}${gates}<rect x="115" y="516" width="890" height="33" rx="4" fill="#23302d" stroke="#46574a"/><text x="560" y="538" text-anchor="middle" fill="#93a891" font-size="10" letter-spacing="4">MERIDIAN TERMINAL</text>${aircraft}</svg>`;
}
function render(s) {
  if (!s) return; state=s;
  $('clock').textContent=clock(now()); $('elapsed').textContent=`T+ ${String(Math.floor(s.elapsedSeconds/60)).padStart(2,'0')}:${String(s.elapsedSeconds%60).padStart(2,'0')}`;
  $('play').textContent=s.running?'Ⅱ Pause simulation':'▶ Run simulation'; $('step').disabled=s.running; $('speed').value=String(s.speed); $('auto-dispatch').checked=s.autoDispatch;
  const active=s.pilots.filter(p=>!['departed','diverted'].includes(p.phase)).length, runwayCount=s.airport.runways.filter(r=>r.status==='open').length;
  const freeGates=s.airport.gates.filter(g=>g.status==='open'&&!g.occupiedBy).length, incidents=s.incidents.filter(i=>i.status==='active').length;
  $('metrics').innerHTML=[['ACTIVE AIRCRAFT',active,'6 flights in this scenario'],['OPEN RUNWAYS',`${runwayCount}<em>/ 2</em>`,'Availability excludes reservations'],['AVAILABLE STANDS',`${freeGates}<em>/ 6</em>`,'Inbound stands are reserved early'],['ACTIVE INCIDENTS',incidents,`${s.tasks.filter(t=>t.status==='active').length} crew tasks in progress`]].map(([label,n,note])=>`<div class="metric"><span class="metric-label">${label}</span><div class="metric-number" ${label==='ACTIVE INCIDENTS'&&incidents?'style="color:var(--orange)"':''}>${n}</div><small>${note}</small></div>`).join('');
  $('map').innerHTML=svgMap();
  if(selectedResource) renderResource();
  $('flight-count').textContent=String(s.pilots.length);
  $('flights').innerHTML=s.pilots.map(p=>`<tr data-pilot="${p.id}" tabindex="0"><td><strong>${esc(p.callsign)}</strong><small>${p.id} · ${esc(p.name)}</small></td><td>${phase(p.phase)}${p.maintenanceHold?'<small style="color:var(--orange)">Maintenance hold</small>':''}</td><td>${Math.round(p.fuelRemainingKg).toLocaleString()}<div class="fuel-bar"><i style="width:${Math.min(100,p.fuelRemainingKg/5000*100)}%;${p.fuelRemainingKg<1200?'background:var(--orange)':''}"></i></div></td><td>${shortTime(p.expectedArrival)}</td><td>${shortTime(p.expectedDeparture)}</td><td>${p.gateId||'—'}</td></tr>`).join('');
  const titles=['Emergency response','Mechanics','Inspectors'];
  $('crews').innerHTML=s.ground.crews.map((group,i)=>`<div class="crew-group"><div class="crew-title"><i class="dot ${['orange','blue','green'][i]}"></i>${titles[i]} <span>${group.length}</span></div>${group.map(c=>{const t=s.tasks.find(t=>t.id===c.currentTaskId);return `<div class="crew-card" data-crew="${c.id}" role="button" tabindex="0"><div class="crew-card-top"><span class="crew-id">${c.id}</span>${phase(c.status)}</div><p>${t?esc(t.title):esc(c.name)}<br>${esc(c.location)}${t?` · ${t.remainingSeconds}s remaining`:''}</p>${t?`<div class="task-progress"><i style="width:${(1-t.remainingSeconds/t.totalSeconds)*100}%"></i></div>`:''}</div>`}).join('')}</div>`).join('');
  $('events').innerHTML=s.events.map(e=>`<div class="event ${esc(e.kind)}"><time>${clock(e.at)}</time><i class="event-dot"></i><span>${esc(e.message)}</span></div>`).join(''); $('event-count').textContent=`${s.events.length} events retained`;
  renderTargets(); renderAgents(); void refreshObservation();
}
function renderTargets() {
  const kind=$('incident-kind').value, previous=$('incident-target').value;
  const list=kind==='aircraft_fault'?state.pilots.filter(p=>['at_gate','ready'].includes(p.phase)&&!p.maintenanceHold).map(p=>({id:p.id,name:p.callsign})):
    (kind==='surface_debris'?[...state.airport.runways,...state.airport.taxiways]:state.airport.runways).filter(r=>r.status==='open'&&!r.occupiedBy);
  const html=list.map(r=>`<option value="${r.id}">${esc(r.name)} · ${r.id}</option>`).join('')||'<option value="">No eligible target</option>';
  if ($('incident-target').innerHTML!==html) { $('incident-target').innerHTML=html; if(list.some(r=>r.id===previous)) $('incident-target').value=previous; }
  $('inject').disabled=!$('incident-target').value;
}
function renderResource() {
  const r=resources().find(r=>r.id===selectedResource); if(!r)return;
  const incident=state.incidents.some(i=>i.status==='active'&&i.targetId===r.id);
  $('resource-detail').innerHTML=`<strong>${esc(r.id)}</strong><span>${esc(r.name)} · ${r.status.toUpperCase()} · ${r.occupiedBy?'Reserved by '+r.occupiedBy:'No reservation'}</span><button id="resource-toggle" ${r.occupiedBy||incident?'disabled':''}>${r.status==='open'?'Close resource':'Reopen resource'}</button>`;
  $('resource-toggle').onclick=()=>fire(()=>act({type:'resource_status',targetId:r.id,status:r.status==='open'?'closed':'open'}));
}
function renderAgents() {
  document.querySelectorAll('[data-role]').forEach(b=>b.classList.toggle('active',b.dataset.role===selectedRole));
  const options=selectedRole==='atc'?[{id:'ATC-1',label:'ATC-1 · Entire airport'}]:selectedRole==='pilot'?state.pilots.map(p=>({id:p.id,label:`${p.id} · ${p.callsign} · ${p.name}`})):crews().map(c=>({id:c.id,label:`${c.id} · ${c.type.replaceAll('_',' ')}`}));
  if(!options.some(o=>o.id===selectedId))selectedId=options[0].id;
  const html=options.map(o=>`<option value="${o.id}">${esc(o.label)}</option>`).join('');
  if($('agent-select').innerHTML!==html)$('agent-select').innerHTML=html;
  $('agent-select').value=selectedId;
  $('scope-card').innerHTML=selectedRole==='atc'?'<strong>Global observation</strong>All flights, resources, incidents and the three nested crew lists, in one canonical format.':selectedRole==='pilot'?'<strong>Individual pilot observation</strong>Own aircraft, fuel, expected times, assigned resources and relevant restrictions.':'<strong>Individual personnel observation</strong>Own availability, location and assignment. Queued tasks are filtered to this person’s crew type.';
}
let observationRequest=0;
async function refreshObservation() {
  const index=++observationRequest;
  const endpoint=selectedRole==='atc'?'/api/views/atc':`/api/views/${selectedRole==='pilot'?'pilots':'ground'}/${selectedId}`;
  try {
    const response=await fetch(endpoint);const obs=await response.json();if(!response.ok||index!==observationRequest)return;
    jsonText=JSON.stringify(obs,null,2);const scroll=$('json').scrollTop;$('json').textContent=jsonText;$('json').scrollTop=scroll;
    $('revision').textContent=`REVISION ${obs.revision}`;$('endpoint').textContent=`GET ${endpoint}`;
    renderAgentActions(obs);
  }catch{ /* EventSource will report a disconnection; no repeated toast on polling. */ }
}
function renderAgentActions(obs) {
  if(selectedRole==='pilot') {
    const can=['approach','holding','ready','holding_short'].includes(obs.pilot.phase);
    $('agent-actions').innerHTML=`<span class="eyebrow">TRY A SCOPED COMMAND</span><button id="pilot-hold" ${!can?'disabled':''}>Request a 60-second hold</button>`;
    $('pilot-hold').onclick=()=>fire(()=>act({type:'hold',pilotId:selectedId,seconds:60},{role:'pilot',id:selectedId}));
  } else if(selectedRole==='ground') {
    const crew=obs.crew;
    $('agent-actions').innerHTML=`<span class="eyebrow">TRY A SCOPED COMMAND</span>${obs.availableTasks.length?`<select id="task-select" aria-label="Task to claim">${obs.availableTasks.map(t=>`<option value="${t.id}">${esc(t.id+' · '+t.title)}</option>`).join('')}</select><button id="claim-task" ${crew.status!=='available'?'disabled':''}>Assign this person to selected task</button>`:''}<button id="crew-availability" ${crew.status==='busy'?'disabled':''}>${crew.status==='off_shift'?'Return to available':'Mark off shift'}</button>`;
    if($('claim-task'))$('claim-task').onclick=()=>fire(()=>act({type:'assign_task',crewId:selectedId,taskId:$('task-select').value},{role:'ground',id:selectedId}));
    $('crew-availability').onclick=()=>fire(()=>act({type:'crew_availability',crewId:selectedId,available:crew.status==='off_shift'},{role:'ground',id:selectedId}));
  } else $('agent-actions').innerHTML='';
}
document.addEventListener('click',e=>{
  const resource=e.target.closest('[data-resource]'),pilot=e.target.closest('[data-pilot]'),crew=e.target.closest('[data-crew]'),tab=e.target.closest('[data-role]');
  if(resource){selectedResource=resource.dataset.resource;renderResource();}
  if(pilot){selectedRole='pilot';selectedId=pilot.dataset.pilot;renderAgents();void refreshObservation();}
  if(crew){selectedRole='ground';selectedId=crew.dataset.crew;renderAgents();void refreshObservation();}
  if(tab){selectedRole=tab.dataset.role;renderAgents();void refreshObservation();}
});
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-resource],[data-pilot],[data-crew]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
$('play').onclick=()=>fire(()=>control(state.running?'pause':'play'));
$('step').onclick=()=>fire(()=>control('step',{seconds:30}));
$('speed').onchange=e=>fire(()=>control('speed',{speed:Number(e.target.value)}));
$('reset').onclick=()=>{if(confirm('Reset the scenario, including incidents, crew assignments and simulation time?')){selectedResource=null;fire(()=>control('reset'));}};
$('incident-kind').onchange=renderTargets;
$('inject').onclick=()=>fire(async()=>{await act({type:'incident',kind:$('incident-kind').value,targetId:$('incident-target').value});toast('Disruption injected. Track the response in Ground personnel.');});
$('auto-dispatch').onchange=e=>fire(()=>act({type:'auto_dispatch',enabled:e.target.checked}));
$('agent-select').onchange=e=>{selectedId=e.target.value;void refreshObservation();};
$('copy').onclick=()=>fire(async()=>{await navigator.clipboard.writeText(jsonText);toast('Agent observation copied.');});
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='meridian-state.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const stream=new EventSource('/api/events');
stream.onmessage=e=>{render(JSON.parse(e.data));$('connection').textContent='STATE CONNECTED';};
stream.onerror=()=>{$('connection').textContent='RECONNECTING';};
fire(async()=>render(await request('/api/state')));
