(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))n(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const d of r.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&n(d)}).observe(document,{childList:!0,subtree:!0});function o(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(s){if(s.ep)return;s.ep=!0;const r=o(s);fetch(s.href,r)}})();const _=document.querySelector("#app");if(!_)throw new Error("#app not found");const t={baseUrl:"http://localhost:3000",token:"",activeTab:"verification",verificationStatus:"pending",listingStatus:"pending_review",verificationRows:[],listingRows:[],homeownerRows:[],homeownerListingRows:[],maintenancePlans:[],upgradeIntents:[],upgradeIntentSummary:null,upgradeIntentStatusFilter:"all",upgradeIntentSourceFilter:"all",upgradeIntentSort:"requested_desc",upgradeIntentOverdueOnly:!1,selectedUpgradeIntentIds:new Set,currentUser:null,verificationTimelineById:{},listingTimelineById:{},upgradeTraceByIntentId:{}},N="yourhome.reviewer.upgradeIntentPreset.v1",$=e=>{const a=String(e??"unknown").trim().toLowerCase().replaceAll("_","-");return{"mobile-cta":"mobile-upgrade-cta","mobile-upgrade-cta":"mobile-upgrade-cta","web-upgrade-cta":"web-upgrade-cta",checkout:"checkout",billing:"checkout","billing-stub":"checkout"}[a]??a},f=()=>{const e={status:t.upgradeIntentStatusFilter,source:t.upgradeIntentSourceFilter,sort:t.upgradeIntentSort,overdueOnly:t.upgradeIntentOverdueOnly};localStorage.setItem(N,JSON.stringify(e))},P=()=>{try{const e=localStorage.getItem(N);if(!e)return;const a=JSON.parse(e);a.status&&["all","new","contacted","converted"].includes(a.status)&&(t.upgradeIntentStatusFilter=a.status),a.source&&(t.upgradeIntentSourceFilter=a.source),a.sort&&["requested_desc","requested_asc","status_desc","status_asc"].includes(a.sort)&&(t.upgradeIntentSort=a.sort),t.upgradeIntentOverdueOnly=!!a.overdueOnly}catch{}},i=(e,a="ok")=>{const o=document.createElement("div");o.textContent=e,o.style.position="fixed",o.style.right="16px",o.style.bottom="16px",o.style.padding="10px 12px",o.style.borderRadius="10px",o.style.color="white",o.style.zIndex="9999",o.style.background=a==="ok"?"#16a34a":"#dc2626",document.body.appendChild(o),setTimeout(()=>o.remove(),2200)},c=async(e,a)=>{try{const o=await fetch(`${t.baseUrl}${e}`,{...a,headers:{"content-type":"application/json",...t.token?{authorization:`Bearer ${t.token}`}:{},...a?.headers??{}}}),n=await o.text(),s=n?JSON.parse(n):{};return{status:o.status,data:s}}catch{return{status:0,data:{error:"network_error"}}}},p=(e,a)=>{const o=e?.error;return o?String(o).replaceAll("_"," "):a},L=()=>({documentType:"utility_bill",ownerNameOnDocument:"",issueDate:"",fileUrl:"",shortNote:"",consentConfirmed:!1}),D=e=>{if(!e)return L();try{const a=JSON.parse(e);return{documentType:a.documentType??"utility_bill",ownerNameOnDocument:a.ownerNameOnDocument??"",issueDate:a.issueDate??"",fileUrl:a.fileUrl??"",shortNote:a.shortNote??"",consentConfirmed:!!a.consentConfirmed}}catch{return L()}},q=e=>{if(!e)return"";try{const a=JSON.parse(e);return Array.isArray(a)&&typeof a[0]=="string"?a[0]:a&&typeof a=="object"&&typeof a.coverUrl=="string"?a.coverUrl:""}catch{return""}},w=e=>`<span class="status status-${e}">${e.replaceAll("_"," ")}</span>`,B=e=>`<span class="status" style="background:#ede9fe;color:#5b21b6">${e}</span>`,h=e=>!e||e.length===0?'<div class="small">No history loaded yet.</div>':`<div class="timeline">${e.map(a=>{const o=new Date(a.at).toLocaleString(),n=a.status?a.status.replaceAll("_"," "):a.action.replaceAll("_"," "),s=a.actor?.email?`by ${a.actor.email}`:"system";return`<div class="timeline-item">
        <div><strong>${n}</strong> <span class="small">${o} • ${s}</span></div>
        ${a.reviewNotes?`<div class="small">Note: ${a.reviewNotes}</div>`:""}
      </div>`}).join("")}</div>`,F=e=>!e||e.length===0?'<div class="small">No trace loaded yet.</div>':`<div class="timeline">${e.map(a=>{const o=new Date(a.at).toLocaleString(),n=a.status?a.status.replaceAll("_"," "):a.action.replaceAll("_"," "),s=a.actor?.email?`by ${a.actor.email}`:"system";return`<div class="timeline-item">
        <div><strong>${n}</strong> <span class="small">${o} • ${s}</span></div>
        <div class="small">Event: ${a.id} • ${a.entityType??"n/a"}/${a.entityId??"n/a"}</div>
        ${a.reviewNotes?`<div class="small">Note: ${a.reviewNotes}</div>`:""}
      </div>`}).join("")}</div>`,j=()=>t.verificationRows.length?t.verificationRows.map(e=>`
      <div class="item">
        <div>${w(e.status)} • ${e.user?.email??"unknown"}</div>
        <div class="small">${e.property?.addressLine1??""}, ${e.property?.city??""} ${e.property?.state??""}</div>
        <div class="small">ID: ${e.id}</div>
        ${e.reviewNotes?`<div class="small"><strong>Last review note:</strong> ${e.reviewNotes}</div>`:""}
        <textarea id="vnote-${e.id}" placeholder="review notes (optional)"></textarea>
        <div class="row">
          <button data-vapprove="${e.id}">Approve</button>
          <button class="reject" data-vreject="${e.id}">Reject</button>
          <button class="tab" data-vmore="${e.id}">Needs more info</button>
          <button class="tab" data-vhistory="${e.id}">Load history</button>
        </div>
        ${h(t.verificationTimelineById[e.id])}
      </div>`).join(""):'<p class="small">No submissions for this status.</p>',C=()=>t.listingRows.length?t.listingRows.map(e=>`
      <div class="item">
        <div>${w(e.status)} • ${e.title??"Untitled"}</div>
        <div class="small">By: ${e.createdBy?.email??"unknown"}</div>
        <div class="small">ID: ${e.id} • trustBadge: ${e.trustBadge??"none"}</div>
        <div class="small">Value-preservation: ${e.valuePreservation?.maintenanceTracked?"tracked":"none"} • completed evidence items: ${e.valuePreservation?.completedWithEvidence??0}</div>
        ${e.valuePreservation?.lastCompletedAt?`<div class="small">Last maintenance evidence: ${new Date(e.valuePreservation.lastCompletedAt).toLocaleDateString()}</div>`:""}
        <textarea id="lnote-${e.id}" placeholder="review notes (optional)"></textarea>
        <div class="row">
          <button data-lapprove="${e.id}">Approve</button>
          <button class="reject" data-lreject="${e.id}">Reject</button>
          <button class="tab" data-lmore="${e.id}">Needs more info</button>
          <button class="tab" data-lhistory="${e.id}">Load history</button>
        </div>
        ${h(t.listingTimelineById[e.id])}
      </div>`).join(""):'<p class="small">No listings for this status.</p>',O=()=>{const e=t.upgradeIntentStatusFilter,a=$(t.upgradeIntentSourceFilter);return[...t.upgradeIntents.filter(s=>{const r=s.status??"new",d=$(s.source);return!(e!=="all"&&r!==e||a!=="all"&&d!==a||t.upgradeIntentOverdueOnly&&(r!=="contacted"||!s.followUpDueAt||new Date(s.followUpDueAt).getTime()>=Date.now()))})].sort((s,r)=>{const d=new Date(s.at).getTime(),l=new Date(r.at).getTime(),m=s.statusUpdatedAt?new Date(s.statusUpdatedAt).getTime():0,v=r.statusUpdatedAt?new Date(r.statusUpdatedAt).getTime():0;switch(t.upgradeIntentSort){case"requested_asc":return d-l;case"status_desc":return v-m;case"status_asc":return m-v;default:return l-d}})},M=()=>{const e=O();if(!e.length){i("No upgrade intents to export.","error");return}const a=l=>`"${String(l??"").replaceAll('"','""')}"`,n=[["intentId","requestedAt","userEmail","userRole","source","status","statusUpdatedAt","intentNote","statusNote"].join(",")];for(const l of e)n.push([a(l.id),a(l.at),a(l.user?.email??""),a(l.user?.role??""),a(l.source??""),a(l.status??"new"),a(l.statusUpdatedAt??""),a(l.note??""),a(l.statusNote??"")].join(","));t.upgradeIntentSummary&&(n.push(""),n.push('"summary"'),n.push(`"new",${t.upgradeIntentSummary.new}`),n.push(`"contacted",${t.upgradeIntentSummary.contacted}`),n.push(`"converted",${t.upgradeIntentSummary.converted}`),n.push(`"conversionRate",${t.upgradeIntentSummary.conversionRate}`),n.push(`"lastConvertedAt",${a(t.upgradeIntentSummary.lastConvertedAt??"")}`));const s=new Blob([n.join(`
`)],{type:"text/csv;charset=utf-8;"}),r=URL.createObjectURL(s),d=document.createElement("a");d.href=r,d.download=`yourhome-upgrade-intents-${new Date().toISOString().slice(0,19).replaceAll(":","-")}.csv`,document.body.appendChild(d),d.click(),document.body.removeChild(d),URL.revokeObjectURL(r),i("Upgrade intents CSV exported")},J=()=>{if(!t.upgradeIntents.length)return'<p class="small">No upgrade intents yet.</p>';const e=t.upgradeIntentSummary?`<div class="item" style="background:#f8fafc;">
        <div><strong>Conversion summary</strong></div>
        <div class="small">New: ${t.upgradeIntentSummary.new} • Contacted: ${t.upgradeIntentSummary.contacted} • Converted: ${t.upgradeIntentSummary.converted}</div>
        <div class="small">Conversion rate: ${t.upgradeIntentSummary.conversionRate}%</div>
        ${t.upgradeIntentSummary.lastConvertedAt?`<div class="small">Last converted at: ${new Date(t.upgradeIntentSummary.lastConvertedAt).toLocaleString()}</div>`:""}
        ${t.upgradeIntentSummary.followUp?`<div class="small">Follow-up: due today ${t.upgradeIntentSummary.followUp.dueToday} • overdue ${t.upgradeIntentSummary.followUp.overdue} • no due date ${t.upgradeIntentSummary.followUp.noDueDate}</div>`:""}
      </div>`:"",a=O(),o=a.length===0?'<div class="small">No intents match current filters.</div>':"",n=t.selectedUpgradeIntentIds.size;return`${e}
    <div class="item" style="background:#f8fafc;">
      <div class="row">
        <strong>Bulk actions</strong>
        <span class="small">Selected: ${n}</span>
        <button class="tab" data-ubulk-contacted>Mark selected contacted</button>
        <button data-ubulk-converted>Mark selected converted</button>
        <button class="tab" data-upreset-all>Preset: all intents</button>
        <button class="tab" data-upreset-stale>Preset: stale new (oldest first)</button>
        <button class="tab" data-upreset-stale-contacted>Preset: stale contacted (oldest status update)</button>
      </div>
    </div>
    ${o}${a.map(s=>`
      <div class="item">
        <div class="row" style="justify-content:space-between;align-items:flex-start;">
          <div>
            <div><strong>${s.user?.email??"unknown user"}</strong> ${s.user?.role?B(s.user.role):""}</div>
            <div class="small">Intent ID: ${s.id}</div>
          </div>
          <label class="small"><input type="checkbox" data-uselect="${s.id}" ${t.selectedUpgradeIntentIds.has(s.id)?"checked":""} /> Select</label>
        </div>
        <div class="small">Requested: ${new Date(s.at).toLocaleString()}</div>
        <div class="small">Source: ${s.source??"unknown"} • tag: ${$(s.source)}</div>
        <div class="small">Status: ${s.status??"new"}${s.statusUpdatedAt?` • updated ${new Date(s.statusUpdatedAt).toLocaleString()}`:""}</div>
        ${(s.status??"new")==="converted"&&s.statusUpdatedAt?`<div class="small"><strong>Converted at:</strong> ${new Date(s.statusUpdatedAt).toLocaleString()}</div>`:""}
        ${s.note?`<div class="small">Intent note: ${s.note}</div>`:""}
        ${s.statusNote?`<div class="small">Status note: ${s.statusNote}</div>`:""}
        ${s.followUpDueAt?`<div class="small">Follow-up due: ${new Date(s.followUpDueAt).toLocaleString()}</div>`:'<div class="small">Follow-up due: none</div>'}
        ${s.followUpOwner?`<div class="small">Follow-up owner: ${s.followUpOwner}</div>`:""}
        <div class="row" style="margin-top:8px;">
          <button class="tab" data-ucontact="${s.id}">Mark contacted</button>
          <button data-uconvert="${s.id}">Mark converted</button>
          <select id="ustatus-${s.id}">
            <option value="new" ${(s.status??"new")==="new"?"selected":""}>new</option>
            <option value="contacted" ${(s.status??"new")==="contacted"?"selected":""}>contacted</option>
            <option value="converted" ${(s.status??"new")==="converted"?"selected":""}>converted</option>
          </select>
          <input id="unote-${s.id}" placeholder="status note (optional)" value="${(s.statusNote??"").replaceAll('"',"&quot;")}" />
          <input id="ufollowdue-${s.id}" type="datetime-local" value="${s.followUpDueAt?new Date(s.followUpDueAt).toISOString().slice(0,16):""}" />
          <input id="ufollowowner-${s.id}" placeholder="follow-up owner" value="${(s.followUpOwner??"").replaceAll('"',"&quot;")}" />
          <button data-ustatus-save="${s.id}">Save status</button>
          <button class="tab" data-utrace="${s.id}">Load trace</button>
          ${s.user?.id?`<button class="tab" data-uentitle="${s.id}">Grant premium</button>`:""}
        </div>
        ${F(t.upgradeTraceByIntentId[s.id])}
      </div>`).join("")}`},V=()=>t.homeownerRows.length?t.homeownerRows.map(e=>{const a=D(e.docsJson),o=e.status==="needs_more_info";return`
      <div class="item">
        <div>${w(e.status)} • ${e.property?.addressLine1??"unknown property"}</div>
        <div class="small">${e.property?.city??""} ${e.property?.state??""}</div>
        <div class="small">ID: ${e.id}</div>
        ${e.reviewNotes?`<div class="small"><strong>Reviewer note:</strong> ${e.reviewNotes}</div>`:""}

        <div class="row">
          <label>Document type
            <select id="hdocType-${e.id}">
              <option value="utility_bill" ${a.documentType==="utility_bill"?"selected":""}>Utility bill</option>
              <option value="property_tax_bill" ${a.documentType==="property_tax_bill"?"selected":""}>Property tax bill</option>
              <option value="mortgage_statement" ${a.documentType==="mortgage_statement"?"selected":""}>Mortgage statement</option>
              <option value="hoa_statement" ${a.documentType==="hoa_statement"?"selected":""}>HOA statement</option>
              <option value="other" ${a.documentType==="other"?"selected":""}>Other</option>
            </select>
          </label>
          <label>Name on document <input id="hownerName-${e.id}" value="${a.ownerNameOnDocument}" placeholder="Full legal name" /></label>
          <label>Issue date <input id="hissueDate-${e.id}" type="date" value="${a.issueDate}" /></label>
        </div>

        <label>Document upload
          <input id="hfile-${e.id}" type="file" />
        </label>
        <div class="row">
          <button class="tab" data-hupload="${e.id}">Upload document</button>
          <input id="hfileUrl-${e.id}" value="${a.fileUrl}" placeholder="Uploaded document URL" readonly />
        </div>

        <label>Short note for reviewer
          <textarea id="hshortNote-${e.id}" placeholder="Tell us what changed and what to review first">${a.shortNote}</textarea>
        </label>

        <label class="small"><input id="hconsent-${e.id}" type="checkbox" ${a.consentConfirmed?"checked":""} /> I confirm this document is accurate and belongs to this property.</label>

        <div class="row">
          <button data-hresubmit="${e.id}" ${o?"":"disabled"}>Resubmit</button>
          <button class="tab" data-vhistory="${e.id}">Load history</button>
          ${o?"":'<span class="small">Resubmission is available only when status is needs_more_info.</span>'}
        </div>
        ${h(t.verificationTimelineById[e.id])}
      </div>`}).join(""):'<p class="small">No homeowner submissions found.</p>',H=()=>t.homeownerListingRows.length?t.homeownerListingRows.map(e=>{const a=e.status==="needs_more_info",o=q(e.photosJson);return`
      <div class="item">
        <div>${w(e.status)} • ${e.title||"Untitled listing"}</div>
        <div class="small">${e.property?.addressLine1??""}, ${e.property?.city??""} ${e.property?.state??""}</div>
        <div class="small">ID: ${e.id}</div>
        <div class="small">Home value-preservation: ${e.valuePreservation?.maintenanceTracked?"active":"not active"} • evidence completions: ${e.valuePreservation?.completedWithEvidence??0}</div>
        ${e.valuePreservation?.lastCompletedAt?`<div class="small">Last completed maintenance: ${new Date(e.valuePreservation.lastCompletedAt).toLocaleDateString()}</div>`:""}
        ${e.reviewNotes?`<div class="small"><strong>Reviewer note:</strong> ${e.reviewNotes}</div>`:""}

        <label>Listing title
          <input id="ltitle-${e.id}" value="${e.title??""}" placeholder="Bright 3-bed home near downtown" />
        </label>
        <label>Description
          <textarea id="ldesc-${e.id}" placeholder="Describe updates, condition, and key highlights">${e.description??""}</textarea>
        </label>
        <div class="row">
          <label>Price (optional)
            <input id="lprice-${e.id}" type="number" min="1" step="1" value="${e.price??""}" placeholder="450000" />
          </label>
          <label>Photo URL (optional)
            <input id="lphoto-${e.id}" value="${o}" placeholder="https://..." />
          </label>
        </div>

        <div class="row">
          <button data-lresubmit="${e.id}" ${a?"":"disabled"}>Resubmit Listing</button>
          <button class="tab" data-lhistory="${e.id}">Load history</button>
          ${a?"":'<span class="small">Listing resubmission is available only when status is needs_more_info.</span>'}
        </div>
        ${h(t.listingTimelineById[e.id])}
      </div>`}).join(""):'<p class="small">No homeowner listings found.</p>',z=()=>t.maintenancePlans.length?t.maintenancePlans.map(e=>{const a=e.tasks?.[0],o=a?.dueAt?new Date(a.dueAt).toLocaleDateString():new Date(e.nextDueAt).toLocaleDateString(),n=a?.id;return`
      <div class="item">
        <div><strong>${e.title}</strong> <span class="small">every ${e.cadenceMonths} month(s)</span></div>
        <div class="small">${e.property?.addressLine1??""}, ${e.property?.city??""} ${e.property?.state??""}</div>
        <div class="small">Next due: ${o}</div>
        ${e.description?`<div class="small">${e.description}</div>`:""}
        <div class="row">
          <label>Before photo URL (required)
            <input id="mbefore-${e.id}" placeholder="https://..." />
          </label>
          <label>After photo URL (required)
            <input id="mafter-${e.id}" placeholder="https://..." />
          </label>
        </div>
        <label>Completion note (optional)
          <textarea id="mnote-${e.id}" placeholder="What was done?"></textarea>
        </label>
        <div class="row">
          <button data-mcomplete="${e.id}" ${n?"":"disabled"}>Mark Completed</button>
          ${n?"":'<span class="small">No upcoming task available.</span>'}
        </div>
      </div>`}).join(""):'<p class="small">No maintenance plans yet.</p>',u=()=>{_.innerHTML=`
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 0; background: #f4f6fb; }
    .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 6px rgba(0,0,0,.08); }
    h1,h2 { margin: 0 0 10px; }
    input, textarea, button, select { font: inherit; }
    input, select, textarea { padding: 10px; border: 1px solid #d9deea; border-radius: 8px; }
    textarea { width: 100%; min-height: 64px; margin-top: 8px; }
    button { padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer; background: #2f5bff; color: #fff; }
    button.tab { background: #e5e7eb; color: #111827; }
    button.tab.active { background: #2f5bff; color: #fff; }
    button.reject { background: #dc2626; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .item { border: 1px solid #e4e7f0; border-radius: 10px; padding: 12px; margin-top: 10px; }
    .small { color: #5b6477; font-size: 12px; }
    .status { display: inline-block; font-weight: 600; font-size: 12px; border-radius: 999px; padding: 4px 8px; text-transform: lowercase; }
    .status-pending, .status-pending_review { background: #fef3c7; color: #92400e; }
    .status-approved { background: #dcfce7; color: #166534; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-needs_more_info { background: #dbeafe; color: #1e40af; }
    .timeline { margin-top: 10px; border-left: 2px solid #d9deea; padding-left: 10px; }
    .timeline-item { margin-bottom: 8px; }
    .hidden { display: none; }
    @media (max-width: 640px) {
      .wrap { margin: 12px auto; padding: 0 10px; }
      .card { padding: 12px; border-radius: 10px; }
      button, input, select, textarea { width: 100%; }
    }
  </style>

  <div class="wrap">
    <div class="card">
      <h1>YourHome Console (Demo)</h1>
      <div class="row">
        <label>API URL <input id="baseUrl" value="${t.baseUrl}" /></label>
        <label>Email <input id="email" placeholder="admin@example.com" /></label>
        <label>Password <input id="password" type="password" placeholder="••••••••" /></label>
        <button id="loginBtn">Login</button>
      </div>
      <p class="small">Reviewer/admin accounts can moderate queues. Homeowner accounts can respond to "needs more info" requests.</p>
      <p class="small">${t.currentUser?["admin","reviewer"].includes(t.currentUser.role)?"Mode: Reviewer/Admin — use Verification Queue + Listing Queue.":"Mode: Homeowner — use Homeowner Resubmission.":"Tip: login first, then use queue tabs for reviewer/admin or homeowner tab for resubmission."}</p>
      <div class="row" style="margin-top:8px;">
        <div class="small" id="sessionIdentity">${t.currentUser?`Logged in as <strong>${t.currentUser.email}</strong> ${B(t.currentUser.role)} • verification: ${t.currentUser.verificationStatus}`:"Not logged in"}</div>
        <button id="logoutBtn" ${t.token?"":"disabled"}>Logout</button>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <button id="tabVerification" class="tab ${t.activeTab==="verification"?"active":""}">Verification Queue</button>
        <button id="tabListing" class="tab ${t.activeTab==="listing"?"active":""}">Listing Queue</button>
        <button id="tabHomeowner" class="tab ${t.activeTab==="homeowner"?"active":""}">Homeowner Resubmission</button>
      </div>
    </div>

    <div class="card ${t.activeTab==="verification"?"":"hidden"}">
      <h2>Verification Submissions</h2>
      <div class="row">
        <select id="verificationStatus">
          <option value="pending" ${t.verificationStatus==="pending"?"selected":""}>pending</option>
          <option value="approved" ${t.verificationStatus==="approved"?"selected":""}>approved</option>
          <option value="rejected" ${t.verificationStatus==="rejected"?"selected":""}>rejected</option>
          <option value="needs_more_info" ${t.verificationStatus==="needs_more_info"?"selected":""}>needs_more_info</option>
        </select>
        <button id="loadVerification">Refresh Verification Queue</button>
      </div>
      <div id="verificationList">${j()}</div>
    </div>

    <div class="card ${t.activeTab==="listing"?"":"hidden"}">
      <h2>Listings</h2>
      <div class="row">
        <select id="listingStatus">
          <option value="pending_review" ${t.listingStatus==="pending_review"?"selected":""}>pending_review</option>
          <option value="approved" ${t.listingStatus==="approved"?"selected":""}>approved</option>
          <option value="rejected" ${t.listingStatus==="rejected"?"selected":""}>rejected</option>
          <option value="needs_more_info" ${t.listingStatus==="needs_more_info"?"selected":""}>needs_more_info</option>
        </select>
        <button id="loadListings">Refresh Listing Queue</button>
      </div>
      <div id="listingList">${C()}</div>

      <h3 style="margin-top:14px;">Property Manager Upgrade Intents</h3>
      <div class="row">
        <button id="loadUpgradeIntents">Load Upgrade Intents</button>
        <select id="upgradeIntentStatusFilter">
          <option value="all" ${t.upgradeIntentStatusFilter==="all"?"selected":""}>all statuses</option>
          <option value="new" ${t.upgradeIntentStatusFilter==="new"?"selected":""}>new</option>
          <option value="contacted" ${t.upgradeIntentStatusFilter==="contacted"?"selected":""}>contacted</option>
          <option value="converted" ${t.upgradeIntentStatusFilter==="converted"?"selected":""}>converted</option>
        </select>
        <input id="upgradeIntentSourceFilter" placeholder="source tag filter (e.g. mobile-upgrade-cta or all)" value="${t.upgradeIntentSourceFilter}" />
        <select id="upgradeIntentSort">
          <option value="requested_desc" ${t.upgradeIntentSort==="requested_desc"?"selected":""}>requested newest</option>
          <option value="requested_asc" ${t.upgradeIntentSort==="requested_asc"?"selected":""}>requested oldest</option>
          <option value="status_desc" ${t.upgradeIntentSort==="status_desc"?"selected":""}>status updated newest</option>
          <option value="status_asc" ${t.upgradeIntentSort==="status_asc"?"selected":""}>status updated oldest</option>
        </select>
        <button class="tab" id="exportUpgradeIntentsCsv">Export CSV</button>
        <label class="small"><input id="upgradeIntentOverdueOnly" type="checkbox" ${t.upgradeIntentOverdueOnly?"checked":""} /> overdue follow-ups only</label>
      </div>
      <div id="upgradeIntentList">${J()}</div>
    </div>

    <div class="card ${t.activeTab==="homeowner"?"":"hidden"}">
      <h2>Homeowner Resubmission Center</h2>
      <div class="row">
        <button id="loadMine">Load My Requests</button>
      </div>

      <h3>Verification Requests</h3>
      <div id="homeownerList">${V()}</div>

      <h3 style="margin-top:14px;">Listing Requests</h3>
      <div id="homeownerListingList">${H()}</div>

      <h3 style="margin-top:14px;">Property Manager (Premium)</h3>
      <div class="row">
        <button id="loadMaintenancePlans">Load Maintenance Plans</button>
      </div>
      <div id="maintenancePlanList">${z()}</div>
    </div>
  </div>`,te()},A=async()=>{const e=await c(`/review/verification-submissions?status=${t.verificationStatus}`);if(e.status!==200){i(`Verification queue load failed: ${p(e.data,`status ${e.status}`)}`,"error");return}t.verificationRows=e.data.submissions??[],u()},T=async()=>{const e=await c(`/review/listings?status=${t.listingStatus}`);if(e.status!==200){i(`Listing queue load failed: ${p(e.data,`status ${e.status}`)}`,"error");return}t.listingRows=e.data.listings??[],u()},k=async()=>{const[e,a]=await Promise.all([c("/verification-submissions/me"),c("/listings/me")]);if(e.status!==200){i(`My verification requests load failed: ${p(e.data,`status ${e.status}`)}`,"error");return}if(a.status!==200){i(`My listings load failed: ${p(a.data,`status ${a.status}`)}`,"error");return}t.homeownerRows=e.data.submissions??[],t.homeownerListingRows=a.data.listings??[],u()},y=async(e,a)=>{const o=await c(`/history/${e}/${a}`);if(o.status!==200){i(`History load failed: ${p(o.data,`status ${o.status}`)}`,"error");return}const n=o.data.timeline??[];e==="verification_submission"?t.verificationTimelineById[a]=n:t.listingTimelineById[a]=n,u()},R=async()=>{const e=await c("/property-manager/plans");if(e.status!==200){i(`Maintenance plans load failed: ${p(e.data,`status ${e.status}`)}`,"error");return}t.maintenancePlans=e.data.plans??[],u()},b=async()=>{const e=await c("/review/property-manager/upgrade-intents");if(e.status!==200){i(`Upgrade intents load failed: ${p(e.data,`status ${e.status}`)}`,"error");return}t.upgradeIntents=e.data.intents??[],t.upgradeIntentSummary=e.data.summary??null,t.selectedUpgradeIntentIds.forEach(a=>{t.upgradeIntents.some(o=>o.id===a)||t.selectedUpgradeIntentIds.delete(a)}),u()},Q=async e=>{const a=await c(`/review/property-manager/upgrade-intents/${e}/trace`);if(a.status!==200){i(`Upgrade trace load failed: ${p(a.data,`status ${a.status}`)}`,"error");return}t.upgradeTraceByIntentId[e]=a.data.events??[],u()},G=async e=>{const a=document.getElementById(`ustatus-${e}`)?.value??"new",o=document.getElementById(`unote-${e}`)?.value?.trim()??"",n=document.getElementById(`ufollowdue-${e}`)?.value?.trim()??"",s=document.getElementById(`ufollowowner-${e}`)?.value?.trim()??"",r=await c(`/review/property-manager/upgrade-intents/${e}/status`,{method:"POST",body:JSON.stringify({status:a,note:o||void 0,followUpDueAt:n?new Date(n).toISOString():void 0,followUpOwner:s||void 0})});if(r.status!==200){i(`Upgrade intent status save failed: ${p(r.data,`status ${r.status}`)}`,"error");return}i(`Intent marked ${a}`),await b()},E=async(e,a)=>{const o=a==="contacted"?"Quick action: contacted":"Quick action: converted",n=await c(`/review/property-manager/upgrade-intents/${e}/status`,{method:"POST",body:JSON.stringify({status:a,note:o})});if(n.status!==200){i(`Quick status update failed: ${p(n.data,`status ${n.status}`)}`,"error");return}i(`Intent marked ${a}`),await b()},W=(e,a)=>{a?t.selectedUpgradeIntentIds.add(e):t.selectedUpgradeIntentIds.delete(e)},x=async e=>{const a=Array.from(t.selectedUpgradeIntentIds);if(!a.length){i("Select one or more intents first.","error");return}let o=0;for(const n of a)(await c(`/review/property-manager/upgrade-intents/${n}/status`,{method:"POST",body:JSON.stringify({status:e,note:`Bulk action: ${e}`})})).status!==200&&(o+=1);o?i(`Bulk update finished with ${o} failures.`,"error"):i(`Bulk updated ${a.length} intents to ${e}`),t.selectedUpgradeIntentIds.clear(),await b()},I=e=>{if(e==="all"){t.upgradeIntentStatusFilter="all",t.upgradeIntentSourceFilter="all",t.upgradeIntentSort="requested_desc",t.upgradeIntentOverdueOnly=!1,f(),u();return}if(e==="stale_new"){t.upgradeIntentStatusFilter="new",t.upgradeIntentSourceFilter="all",t.upgradeIntentSort="requested_asc",t.upgradeIntentOverdueOnly=!1,f(),u();return}e==="stale_contacted"&&(t.upgradeIntentStatusFilter="contacted",t.upgradeIntentSourceFilter="all",t.upgradeIntentSort="status_asc",t.upgradeIntentOverdueOnly=!0,f(),u())},K=async e=>{const o=t.upgradeIntents.find(s=>s.id===e)?.user?.id;if(!o){i("Missing user id for this intent.","error");return}const n=await c(`/review/property-manager/entitlements/${o}`,{method:"POST",body:JSON.stringify({enabled:!0,note:"granted from reviewer-web intent panel"})});if(n.status!==200){i(`Grant premium failed: ${p(n.data,`status ${n.status}`)}`,"error");return}i("Premium entitlement granted"),await b()},Y=async e=>{const o=t.maintenancePlans.find(l=>l.id===e)?.tasks?.[0]?.id;if(!o){i("No upcoming maintenance task found.","error");return}const n=document.getElementById(`mbefore-${e}`)?.value?.trim()??"",s=document.getElementById(`mafter-${e}`)?.value?.trim()??"",r=document.getElementById(`mnote-${e}`)?.value?.trim()??"";if(!n||!s){i("Before and after photo URLs are required.","error");return}const d=await c(`/property-manager/tasks/${o}/complete`,{method:"POST",body:JSON.stringify({beforeEvidenceUrl:n,afterEvidenceUrl:s,completionNote:r||void 0})});if(d.status!==200){i(`Task completion failed: ${p(d.data,`status ${d.status}`)}`,"error");return}i("Maintenance task completed"),await R()},S=async(e,a)=>{const o=document.getElementById(`vnote-${e}`)?.value??"",n=await c(`/review/verification-submissions/${e}/decision`,{method:"POST",body:JSON.stringify({decision:a,reviewNotes:o||void 0})});if(n.status!==200){i(`Verification ${a} failed: ${p(n.data,`status ${n.status}`)}`,"error");return}i(`Verification updated: ${a.replaceAll("_"," ")}`),await A(),await y("verification_submission",e)},U=async(e,a)=>{const o=document.getElementById(`lnote-${e}`)?.value??"",n=await c(`/review/listings/${e}/decision`,{method:"POST",body:JSON.stringify({decision:a,reviewNotes:o||void 0})});if(n.status!==200){i(`Listing ${a} failed: ${p(n.data,`status ${n.status}`)}`,"error");return}i(`Listing updated: ${a.replaceAll("_"," ")}`),await T(),await y("listing",e)},X=async e=>{const o=document.getElementById(`hfile-${e}`)?.files?.[0];if(!o){i("Please choose a file before uploading.","error");return}const n=["application/pdf","image/jpeg","image/png","image/webp"];if(o.type&&!n.includes(o.type)){i("Unsupported file type. Use PDF, JPG, PNG, or WEBP.","error");return}if(o.size>10*1024*1024){i("File too large. Maximum size is 10MB.","error");return}const s=r=>new Promise((d,l)=>{const m=new FileReader;m.onload=()=>{const v=String(m.result??""),g=v.indexOf(",");d(g>=0?v.slice(g+1):v)},m.onerror=()=>l(new Error("file_read_failed")),m.readAsDataURL(r)});try{const r=await c("/uploads/presign",{method:"POST",body:JSON.stringify({fileName:o.name,mimeType:o.type||"application/octet-stream"})});if(r.status!==200){i(`Upload init failed: ${p(r.data,`status ${r.status}`)}`,"error");return}let d="";if(r.data.mode==="s3"){const m=r.data.uploadUrl,v=r.data.fileUrl;if(!m||!v){i("Upload init failed: missing signed URL","error");return}const g=await fetch(m,{method:"PUT",headers:{"content-type":o.type||"application/octet-stream"},body:o});if(!g.ok){i(`Upload failed: storage rejected file (${g.status})`,"error");return}d=v}else{const m=await s(o),v=await c("/uploads/documents",{method:"POST",body:JSON.stringify({fileName:o.name,mimeType:o.type||"application/octet-stream",base64:m})});if(v.status!==201||!v.data.url){i(`Upload failed: ${p(v.data,`status ${v.status}`)}`,"error");return}const g=String(v.data.url??"");d=g.startsWith("http")?g:`${t.baseUrl}${g}`}const l=document.getElementById(`hfileUrl-${e}`);l&&(l.value=d),i("Document uploaded")}catch{i("Upload failed","error")}},Z=async e=>{const a=document.getElementById(`hdocType-${e}`)?.value??"utility_bill",o=document.getElementById(`hownerName-${e}`)?.value?.trim()??"",n=document.getElementById(`hissueDate-${e}`)?.value??"",s=document.getElementById(`hfileUrl-${e}`)?.value?.trim()??"",r=document.getElementById(`hshortNote-${e}`)?.value?.trim()??"",d=!!document.getElementById(`hconsent-${e}`)?.checked;if(!o||!n||!s||!r){i("Please complete all required fields before resubmitting.","error");return}if(!d){i("Please confirm the document is accurate before resubmitting.","error");return}const l=JSON.stringify({documentType:a,ownerNameOnDocument:o,issueDate:n,fileUrl:s,shortNote:r,consentConfirmed:d}),m=await c(`/verification-submissions/${e}/resubmit`,{method:"POST",body:JSON.stringify({docsJson:l})});if(m.status!==200){i(`Resubmit failed: ${p(m.data,`status ${m.status}`)}`,"error");return}i("Verification resubmitted"),await k(),await y("verification_submission",e)},ee=async e=>{const a=document.getElementById(`ltitle-${e}`)?.value?.trim()??"",o=document.getElementById(`ldesc-${e}`)?.value?.trim()??"",n=document.getElementById(`lprice-${e}`)?.value?.trim()??"",s=document.getElementById(`lphoto-${e}`)?.value?.trim()??"";if(!a||!o){i("Please add both title and description before resubmitting listing.","error");return}const r=n?Number(n):void 0;if(n&&(!Number.isFinite(r)||Number(r)<=0)){i("Price must be a positive number.","error");return}const d=s?JSON.stringify([s]):void 0,l=await c(`/listings/${e}/resubmit`,{method:"POST",body:JSON.stringify({title:a,description:o,price:r,photosJson:d})});if(l.status!==200){i(`Listing resubmit failed: ${p(l.data,`status ${l.status}`)}`,"error");return}i("Listing resubmitted"),await k(),await y("listing",e)},te=()=>{const e=document.getElementById("baseUrl"),a=document.getElementById("email"),o=document.getElementById("password");document.getElementById("loginBtn").onclick=async()=>{t.baseUrl=e.value.trim();const n=await c("/auth/login",{method:"POST",body:JSON.stringify({email:a.value.trim(),password:o.value})});if(n.status!==200||!n.data.token){i(`Login failed: ${p(n.data,`status ${n.status}`)}`,"error");return}t.token=n.data.token;const s=await c("/auth/me");s.status===200&&s.data.user&&(t.currentUser=s.data.user),i("Login successful"),u()},document.getElementById("logoutBtn")?.addEventListener("click",async()=>{t.token&&await c("/auth/logout",{method:"POST",body:JSON.stringify({allDevices:!0})}),t.token="",t.currentUser=null,t.verificationRows=[],t.listingRows=[],t.homeownerRows=[],t.homeownerListingRows=[],t.maintenancePlans=[],t.upgradeIntents=[],t.upgradeIntentSummary=null,t.upgradeIntentStatusFilter="all",t.upgradeIntentSourceFilter="all",t.upgradeIntentSort="requested_desc",t.upgradeIntentOverdueOnly=!1,t.selectedUpgradeIntentIds.clear(),t.verificationTimelineById={},t.listingTimelineById={},t.upgradeTraceByIntentId={},i("Logged out"),u()}),document.getElementById("tabVerification").onclick=()=>{t.activeTab="verification",u()},document.getElementById("tabListing").onclick=()=>{t.activeTab="listing",u()},document.getElementById("tabHomeowner").onclick=()=>{t.activeTab="homeowner",u()},document.getElementById("verificationStatus")?.addEventListener("change",n=>{t.verificationStatus=n.target.value}),document.getElementById("listingStatus")?.addEventListener("change",n=>{t.listingStatus=n.target.value}),document.getElementById("loadVerification")?.addEventListener("click",A),document.getElementById("loadListings")?.addEventListener("click",T),document.getElementById("loadMine")?.addEventListener("click",k),document.getElementById("loadMaintenancePlans")?.addEventListener("click",R),document.getElementById("loadUpgradeIntents")?.addEventListener("click",b),document.getElementById("upgradeIntentStatusFilter")?.addEventListener("change",n=>{t.upgradeIntentStatusFilter=n.target.value,f(),u()}),document.getElementById("upgradeIntentSourceFilter")?.addEventListener("change",n=>{const s=n.target.value.trim();t.upgradeIntentSourceFilter=s?$(s):"all",f(),u()}),document.getElementById("upgradeIntentSort")?.addEventListener("change",n=>{t.upgradeIntentSort=n.target.value,f(),u()}),document.getElementById("upgradeIntentOverdueOnly")?.addEventListener("change",n=>{t.upgradeIntentOverdueOnly=!!n.target.checked,f(),u()}),document.getElementById("exportUpgradeIntentsCsv")?.addEventListener("click",M),document.querySelectorAll("[data-vapprove]").forEach(n=>{n.onclick=()=>S(n.dataset.vapprove,"approve")}),document.querySelectorAll("[data-vreject]").forEach(n=>{n.onclick=()=>S(n.dataset.vreject,"reject")}),document.querySelectorAll("[data-vmore]").forEach(n=>{n.onclick=()=>S(n.dataset.vmore,"needs_more_info")}),document.querySelectorAll("[data-lapprove]").forEach(n=>{n.onclick=()=>U(n.dataset.lapprove,"approve")}),document.querySelectorAll("[data-lreject]").forEach(n=>{n.onclick=()=>U(n.dataset.lreject,"reject")}),document.querySelectorAll("[data-lmore]").forEach(n=>{n.onclick=()=>U(n.dataset.lmore,"needs_more_info")}),document.querySelectorAll("[data-vhistory]").forEach(n=>{n.onclick=()=>y("verification_submission",n.dataset.vhistory)}),document.querySelectorAll("[data-lhistory]").forEach(n=>{n.onclick=()=>y("listing",n.dataset.lhistory)}),document.querySelectorAll("[data-hupload]").forEach(n=>{n.onclick=()=>X(n.dataset.hupload)}),document.querySelectorAll("[data-hresubmit]").forEach(n=>{n.onclick=()=>Z(n.dataset.hresubmit)}),document.querySelectorAll("[data-lresubmit]").forEach(n=>{n.onclick=()=>ee(n.dataset.lresubmit)}),document.querySelectorAll("[data-mcomplete]").forEach(n=>{n.onclick=()=>Y(n.dataset.mcomplete)}),document.querySelector("[data-ubulk-contacted]")?.addEventListener("click",()=>{x("contacted")}),document.querySelector("[data-ubulk-converted]")?.addEventListener("click",()=>{x("converted")}),document.querySelector("[data-upreset-all]")?.addEventListener("click",()=>{I("all")}),document.querySelector("[data-upreset-stale]")?.addEventListener("click",()=>{I("stale_new")}),document.querySelector("[data-upreset-stale-contacted]")?.addEventListener("click",()=>{I("stale_contacted")}),document.querySelectorAll("[data-uselect]").forEach(n=>{n.onchange=()=>{const s=n.dataset.uselect;W(s,n.checked),u()}}),document.querySelectorAll("[data-ucontact]").forEach(n=>{n.onclick=()=>E(n.dataset.ucontact,"contacted")}),document.querySelectorAll("[data-uconvert]").forEach(n=>{n.onclick=()=>E(n.dataset.uconvert,"converted")}),document.querySelectorAll("[data-ustatus-save]").forEach(n=>{n.onclick=()=>G(n.dataset.ustatusSave)}),document.querySelectorAll("[data-utrace]").forEach(n=>{n.onclick=()=>Q(n.dataset.utrace)}),document.querySelectorAll("[data-uentitle]").forEach(n=>{n.onclick=()=>K(n.dataset.uentitle)})};P();u();
