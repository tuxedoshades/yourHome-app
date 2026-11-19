type VerificationStatus = "pending" | "approved" | "rejected" | "needs_more_info";
type ListingStatus = "pending_review" | "approved" | "rejected" | "needs_more_info";
type Tab = "verification" | "listing" | "homeowner";

type VerificationRow = {
  id: string;
  status: string;
  reviewNotes?: string | null;
  user?: { email?: string };
  property?: { addressLine1?: string; city?: string; state?: string };
};

type ListingRow = {
  id: string;
  title?: string;
  status: string;
  trustBadge?: string;
  createdBy?: { email?: string };
  valuePreservation?: { maintenanceTracked?: boolean; completedWithEvidence?: number; lastCompletedAt?: string | null };
};

type HomeownerSubmissionRow = {
  id: string;
  status: string;
  reviewNotes?: string | null;
  docsJson?: string | null;
  property?: { addressLine1?: string; city?: string; state?: string };
};

type HomeownerDocsForm = {
  documentType: string;
  ownerNameOnDocument: string;
  issueDate: string;
  fileUrl: string;
  shortNote: string;
  consentConfirmed: boolean;
};

type HomeownerListingRow = {
  id: string;
  status: string;
  title: string;
  description: string;
  price?: number | null;
  photosJson?: string | null;
  reviewNotes?: string | null;
  property?: { addressLine1?: string; city?: string; state?: string };
  valuePreservation?: { maintenanceTracked?: boolean; completedWithEvidence?: number; lastCompletedAt?: string | null };
};

type CurrentUser = {
  id: string;
  email: string;
  role: string;
  verificationStatus: string;
};

type TimelineEvent = {
  id: string;
  at: string;
  action: string;
  status?: string | null;
  reviewNotes?: string | null;
  actor?: { email?: string; role?: string } | null;
};

type MaintenancePlanRow = {
  id: string;
  title: string;
  description?: string | null;
  cadenceMonths: number;
  nextDueAt: string;
  tasks?: { id: string; dueAt: string; status: string }[];
  property?: { addressLine1?: string; city?: string; state?: string };
};

type UpgradeIntentRow = {
  id: string;
  at: string;
  source?: string | null;
  note?: string | null;
  user?: { id?: string; email?: string; role?: string } | null;
  status?: "new" | "contacted" | "converted";
  statusUpdatedAt?: string | null;
  statusNote?: string | null;
  followUpDueAt?: string | null;
  followUpOwner?: string | null;
};

type UpgradeIntentSummary = {
  new: number;
  contacted: number;
  converted: number;
  conversionRate: number;
  lastConvertedAt?: string | null;
  followUp?: { dueToday: number; overdue: number; noDueDate: number };
};

type UpgradeTraceEvent = TimelineEvent & {
  entityType?: string;
  entityId?: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

const state = {
  baseUrl: "http://localhost:3000",
  token: "",
  activeTab: "verification" as Tab,
  verificationStatus: "pending" as VerificationStatus,
  listingStatus: "pending_review" as ListingStatus,
  verificationRows: [] as VerificationRow[],
  listingRows: [] as ListingRow[],
  homeownerRows: [] as HomeownerSubmissionRow[],
  homeownerListingRows: [] as HomeownerListingRow[],
  maintenancePlans: [] as MaintenancePlanRow[],
  upgradeIntents: [] as UpgradeIntentRow[],
  upgradeIntentSummary: null as UpgradeIntentSummary | null,
  upgradeIntentStatusFilter: "all" as "all" | "new" | "contacted" | "converted",
  upgradeIntentSourceFilter: "all" as string,
  upgradeIntentSort: "requested_desc" as "requested_desc" | "requested_asc" | "status_desc" | "status_asc",
  upgradeIntentOverdueOnly: false,
  selectedUpgradeIntentIds: new Set<string>(),
  currentUser: null as CurrentUser | null,
  verificationTimelineById: {} as Record<string, TimelineEvent[]>,
  listingTimelineById: {} as Record<string, TimelineEvent[]>,
  upgradeTraceByIntentId: {} as Record<string, UpgradeTraceEvent[]>,
};

const UPGRADE_INTENT_PRESET_KEY = "yourhome.reviewer.upgradeIntentPreset.v1";

const normalizeUpgradeIntentSource = (source: string | null | undefined) => {
  const raw = String(source ?? "unknown")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  const normalizedMap: Record<string, string> = {
    "mobile-cta": "mobile-upgrade-cta",
    "mobile-upgrade-cta": "mobile-upgrade-cta",
    "web-upgrade-cta": "web-upgrade-cta",
    checkout: "checkout",
    billing: "checkout",
    "billing-stub": "checkout",
  };
  return normalizedMap[raw] ?? raw;
};

const saveUpgradeIntentPresetState = () => {
  const payload = {
    status: state.upgradeIntentStatusFilter,
    source: state.upgradeIntentSourceFilter,
    sort: state.upgradeIntentSort,
    overdueOnly: state.upgradeIntentOverdueOnly,
  };
  localStorage.setItem(UPGRADE_INTENT_PRESET_KEY, JSON.stringify(payload));
};

const loadUpgradeIntentPresetState = () => {
  try {
    const raw = localStorage.getItem(UPGRADE_INTENT_PRESET_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { status?: string; source?: string; sort?: string; overdueOnly?: boolean };
    if (parsed.status && ["all", "new", "contacted", "converted"].includes(parsed.status)) {
      state.upgradeIntentStatusFilter = parsed.status as "all" | "new" | "contacted" | "converted";
    }
    if (parsed.source) state.upgradeIntentSourceFilter = parsed.source;
    if (parsed.sort && ["requested_desc", "requested_asc", "status_desc", "status_asc"].includes(parsed.sort)) {
      state.upgradeIntentSort = parsed.sort as "requested_desc" | "requested_asc" | "status_desc" | "status_asc";
    }
    state.upgradeIntentOverdueOnly = Boolean(parsed.overdueOnly);
  } catch {
    // ignore localStorage parse issues
  }
};

const showToast = (text: string, kind: "ok" | "error" = "ok") => {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.position = "fixed";
  el.style.right = "16px";
  el.style.bottom = "16px";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "10px";
  el.style.color = "white";
  el.style.zIndex = "9999";
  el.style.background = kind === "ok" ? "#16a34a" : "#dc2626";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
};

const request = async (path: string, init?: RequestInit) => {
  try {
    const res = await fetch(`${state.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: "network_error" } };
  }
};

const prettyError = (data: unknown, fallback: string) => {
  const maybe = (data as { error?: string } | undefined)?.error;
  if (!maybe) return fallback;
  return String(maybe).replaceAll("_", " ");
};

const defaultHomeownerDocsForm = (): HomeownerDocsForm => ({
  documentType: "utility_bill",
  ownerNameOnDocument: "",
  issueDate: "",
  fileUrl: "",
  shortNote: "",
  consentConfirmed: false,
});

const parseDocsForm = (docsJson?: string | null): HomeownerDocsForm => {
  if (!docsJson) return defaultHomeownerDocsForm();

  try {
    const parsed = JSON.parse(docsJson) as Partial<HomeownerDocsForm>;
    return {
      documentType: parsed.documentType ?? "utility_bill",
      ownerNameOnDocument: parsed.ownerNameOnDocument ?? "",
      issueDate: parsed.issueDate ?? "",
      fileUrl: parsed.fileUrl ?? "",
      shortNote: parsed.shortNote ?? "",
      consentConfirmed: Boolean(parsed.consentConfirmed),
    };
  } catch {
    return defaultHomeownerDocsForm();
  }
};

const parseListingPhotoUrl = (photosJson?: string | null): string => {
  if (!photosJson) return "";
  try {
    const parsed = JSON.parse(photosJson) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
    if (parsed && typeof parsed === "object" && typeof (parsed as { coverUrl?: unknown }).coverUrl === "string") {
      return (parsed as { coverUrl: string }).coverUrl;
    }
    return "";
  } catch {
    return "";
  }
};

const statusBadge = (status: string) => `<span class="status status-${status}">${status.replaceAll("_", " ")}</span>`;
const roleBadge = (role: string) => `<span class="status" style="background:#ede9fe;color:#5b21b6">${role}</span>`;

const renderTimeline = (items: TimelineEvent[] | undefined) => {
  if (!items || items.length === 0) return `<div class="small">No history loaded yet.</div>`;

  return `<div class="timeline">${items
    .map((event) => {
      const when = new Date(event.at).toLocaleString();
      const statusText = event.status ? event.status.replaceAll("_", " ") : event.action.replaceAll("_", " ");
      const actor = event.actor?.email ? `by ${event.actor.email}` : "system";
      return `<div class="timeline-item">
        <div><strong>${statusText}</strong> <span class="small">${when} • ${actor}</span></div>
        ${event.reviewNotes ? `<div class="small">Note: ${event.reviewNotes}</div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
};

const renderUpgradeTrace = (items: UpgradeTraceEvent[] | undefined) => {
  if (!items || items.length === 0) return `<div class="small">No trace loaded yet.</div>`;

  return `<div class="timeline">${items
    .map((event) => {
      const when = new Date(event.at).toLocaleString();
      const label = event.status ? event.status.replaceAll("_", " ") : event.action.replaceAll("_", " ");
      const actor = event.actor?.email ? `by ${event.actor.email}` : "system";
      return `<div class="timeline-item">
        <div><strong>${label}</strong> <span class="small">${when} • ${actor}</span></div>
        <div class="small">Event: ${event.id} • ${event.entityType ?? "n/a"}/${event.entityId ?? "n/a"}</div>
        ${event.reviewNotes ? `<div class="small">Note: ${event.reviewNotes}</div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
};

const renderVerificationRows = () => {
  if (!state.verificationRows.length) return `<p class="small">No submissions for this status.</p>`;

  return state.verificationRows
    .map(
      (r) => `
      <div class="item">
        <div>${statusBadge(r.status)} • ${r.user?.email ?? "unknown"}</div>
        <div class="small">${r.property?.addressLine1 ?? ""}, ${r.property?.city ?? ""} ${r.property?.state ?? ""}</div>
        <div class="small">ID: ${r.id}</div>
        ${r.reviewNotes ? `<div class="small"><strong>Last review note:</strong> ${r.reviewNotes}</div>` : ""}
        <textarea id="vnote-${r.id}" placeholder="review notes (optional)"></textarea>
        <div class="row">
          <button data-vapprove="${r.id}">Approve</button>
          <button class="reject" data-vreject="${r.id}">Reject</button>
          <button class="tab" data-vmore="${r.id}">Needs more info</button>
          <button class="tab" data-vhistory="${r.id}">Load history</button>
        </div>
        ${renderTimeline(state.verificationTimelineById[r.id])}
      </div>`,
    )
    .join("");
};

const renderListingRows = () => {
  if (!state.listingRows.length) return `<p class="small">No listings for this status.</p>`;

  return state.listingRows
    .map(
      (r) => `
      <div class="item">
        <div>${statusBadge(r.status)} • ${r.title ?? "Untitled"}</div>
        <div class="small">By: ${r.createdBy?.email ?? "unknown"}</div>
        <div class="small">ID: ${r.id} • trustBadge: ${r.trustBadge ?? "none"}</div>
        <div class="small">Value-preservation: ${r.valuePreservation?.maintenanceTracked ? "tracked" : "none"} • completed evidence items: ${r.valuePreservation?.completedWithEvidence ?? 0}</div>
        ${r.valuePreservation?.lastCompletedAt ? `<div class="small">Last maintenance evidence: ${new Date(r.valuePreservation.lastCompletedAt).toLocaleDateString()}</div>` : ""}
        <textarea id="lnote-${r.id}" placeholder="review notes (optional)"></textarea>
        <div class="row">
          <button data-lapprove="${r.id}">Approve</button>
          <button class="reject" data-lreject="${r.id}">Reject</button>
          <button class="tab" data-lmore="${r.id}">Needs more info</button>
          <button class="tab" data-lhistory="${r.id}">Load history</button>
        </div>
        ${renderTimeline(state.listingTimelineById[r.id])}
      </div>`,
    )
    .join("");
};

const getVisibleUpgradeIntents = () => {
  const statusFilter = state.upgradeIntentStatusFilter;
  const sourceFilter = normalizeUpgradeIntentSource(state.upgradeIntentSourceFilter);

  const filtered = state.upgradeIntents.filter((intent) => {
    const status = (intent.status ?? "new") as "new" | "contacted" | "converted";
    const normalizedSource = normalizeUpgradeIntentSource(intent.source);
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (sourceFilter !== "all" && normalizedSource !== sourceFilter) return false;
    if (state.upgradeIntentOverdueOnly) {
      if (status !== "contacted" || !intent.followUpDueAt) return false;
      if (new Date(intent.followUpDueAt).getTime() >= Date.now()) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const requestedA = new Date(a.at).getTime();
    const requestedB = new Date(b.at).getTime();
    const statusAtA = a.statusUpdatedAt ? new Date(a.statusUpdatedAt).getTime() : 0;
    const statusAtB = b.statusUpdatedAt ? new Date(b.statusUpdatedAt).getTime() : 0;

    switch (state.upgradeIntentSort) {
      case "requested_asc":
        return requestedA - requestedB;
      case "status_desc":
        return statusAtB - statusAtA;
      case "status_asc":
        return statusAtA - statusAtB;
      case "requested_desc":
      default:
        return requestedB - requestedA;
    }
  });

  return sorted;
};

const exportUpgradeIntentsCsv = () => {
  const rows = getVisibleUpgradeIntents();
  if (!rows.length) {
    showToast("No upgrade intents to export.", "error");
    return;
  }

  const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = [
    "intentId",
    "requestedAt",
    "userEmail",
    "userRole",
    "source",
    "status",
    "statusUpdatedAt",
    "intentNote",
    "statusNote",
  ];

  const lines = [header.join(",")];
  for (const intent of rows) {
    lines.push(
      [
        escapeCsv(intent.id),
        escapeCsv(intent.at),
        escapeCsv(intent.user?.email ?? ""),
        escapeCsv(intent.user?.role ?? ""),
        escapeCsv(intent.source ?? ""),
        escapeCsv(intent.status ?? "new"),
        escapeCsv(intent.statusUpdatedAt ?? ""),
        escapeCsv(intent.note ?? ""),
        escapeCsv(intent.statusNote ?? ""),
      ].join(","),
    );
  }

  if (state.upgradeIntentSummary) {
    lines.push("");
    lines.push('"summary"');
    lines.push(`\"new\",${state.upgradeIntentSummary.new}`);
    lines.push(`\"contacted\",${state.upgradeIntentSummary.contacted}`);
    lines.push(`\"converted\",${state.upgradeIntentSummary.converted}`);
    lines.push(`\"conversionRate\",${state.upgradeIntentSummary.conversionRate}`);
    lines.push(`\"lastConvertedAt\",${escapeCsv(state.upgradeIntentSummary.lastConvertedAt ?? "")}`);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yourhome-upgrade-intents-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Upgrade intents CSV exported");
};

const renderUpgradeIntents = () => {
  if (!state.upgradeIntents.length) return `<p class="small">No upgrade intents yet.</p>`;

  const summary = state.upgradeIntentSummary
    ? `<div class="item" style="background:#f8fafc;">
        <div><strong>Conversion summary</strong></div>
        <div class="small">New: ${state.upgradeIntentSummary.new} • Contacted: ${state.upgradeIntentSummary.contacted} • Converted: ${state.upgradeIntentSummary.converted}</div>
        <div class="small">Conversion rate: ${state.upgradeIntentSummary.conversionRate}%</div>
        ${state.upgradeIntentSummary.lastConvertedAt ? `<div class="small">Last converted at: ${new Date(state.upgradeIntentSummary.lastConvertedAt).toLocaleString()}</div>` : ""}
        ${state.upgradeIntentSummary.followUp ? `<div class="small">Follow-up: due today ${state.upgradeIntentSummary.followUp.dueToday} • overdue ${state.upgradeIntentSummary.followUp.overdue} • no due date ${state.upgradeIntentSummary.followUp.noDueDate}</div>` : ""}
      </div>`
    : "";

  const rows = getVisibleUpgradeIntents();
  const emptyFiltered = rows.length === 0 ? `<div class="small">No intents match current filters.</div>` : "";
  const selectedCount = state.selectedUpgradeIntentIds.size;

  return `${summary}
    <div class="item" style="background:#f8fafc;">
      <div class="row">
        <strong>Bulk actions</strong>
        <span class="small">Selected: ${selectedCount}</span>
        <button class="tab" data-ubulk-contacted>Mark selected contacted</button>
        <button data-ubulk-converted>Mark selected converted</button>
        <button class="tab" data-upreset-all>Preset: all intents</button>
        <button class="tab" data-upreset-stale>Preset: stale new (oldest first)</button>
        <button class="tab" data-upreset-stale-contacted>Preset: stale contacted (oldest status update)</button>
      </div>
    </div>
    ${emptyFiltered}${rows
      .map(
        (r) => `
      <div class="item">
        <div class="row" style="justify-content:space-between;align-items:flex-start;">
          <div>
            <div><strong>${r.user?.email ?? "unknown user"}</strong> ${r.user?.role ? roleBadge(r.user.role) : ""}</div>
            <div class="small">Intent ID: ${r.id}</div>
          </div>
          <label class="small"><input type="checkbox" data-uselect="${r.id}" ${state.selectedUpgradeIntentIds.has(r.id) ? "checked" : ""} /> Select</label>
        </div>
        <div class="small">Requested: ${new Date(r.at).toLocaleString()}</div>
        <div class="small">Source: ${r.source ?? "unknown"} • tag: ${normalizeUpgradeIntentSource(r.source)}</div>
        <div class="small">Status: ${r.status ?? "new"}${r.statusUpdatedAt ? ` • updated ${new Date(r.statusUpdatedAt).toLocaleString()}` : ""}</div>
        ${(r.status ?? "new") === "converted" && r.statusUpdatedAt ? `<div class="small"><strong>Converted at:</strong> ${new Date(r.statusUpdatedAt).toLocaleString()}</div>` : ""}
        ${r.note ? `<div class="small">Intent note: ${r.note}</div>` : ""}
        ${r.statusNote ? `<div class="small">Status note: ${r.statusNote}</div>` : ""}
        ${r.followUpDueAt ? `<div class="small">Follow-up due: ${new Date(r.followUpDueAt).toLocaleString()}</div>` : `<div class="small">Follow-up due: none</div>`}
        ${r.followUpOwner ? `<div class="small">Follow-up owner: ${r.followUpOwner}</div>` : ""}
        <div class="row" style="margin-top:8px;">
          <button class="tab" data-ucontact="${r.id}">Mark contacted</button>
          <button data-uconvert="${r.id}">Mark converted</button>
          <select id="ustatus-${r.id}">
            <option value="new" ${(r.status ?? "new") === "new" ? "selected" : ""}>new</option>
            <option value="contacted" ${(r.status ?? "new") === "contacted" ? "selected" : ""}>contacted</option>
            <option value="converted" ${(r.status ?? "new") === "converted" ? "selected" : ""}>converted</option>
          </select>
          <input id="unote-${r.id}" placeholder="status note (optional)" value="${(r.statusNote ?? "").replaceAll('"', "&quot;")}" />
          <input id="ufollowdue-${r.id}" type="datetime-local" value="${r.followUpDueAt ? new Date(r.followUpDueAt).toISOString().slice(0, 16) : ""}" />
          <input id="ufollowowner-${r.id}" placeholder="follow-up owner" value="${(r.followUpOwner ?? "").replaceAll('"', "&quot;")}" />
          <button data-ustatus-save="${r.id}">Save status</button>
          <button class="tab" data-utrace="${r.id}">Load trace</button>
          ${r.user?.id ? `<button class="tab" data-uentitle="${r.id}">Grant premium</button>` : ""}
        </div>
        ${renderUpgradeTrace(state.upgradeTraceByIntentId[r.id])}
      </div>`,
      )
      .join("")}`;
};

const renderHomeownerRows = () => {
  if (!state.homeownerRows.length) return `<p class="small">No homeowner submissions found.</p>`;

  return state.homeownerRows
    .map((r) => {
      const docs = parseDocsForm(r.docsJson);
      const canResubmit = r.status === "needs_more_info";

      return `
      <div class="item">
        <div>${statusBadge(r.status)} • ${r.property?.addressLine1 ?? "unknown property"}</div>
        <div class="small">${r.property?.city ?? ""} ${r.property?.state ?? ""}</div>
        <div class="small">ID: ${r.id}</div>
        ${r.reviewNotes ? `<div class="small"><strong>Reviewer note:</strong> ${r.reviewNotes}</div>` : ""}

        <div class="row">
          <label>Document type
            <select id="hdocType-${r.id}">
              <option value="utility_bill" ${docs.documentType === "utility_bill" ? "selected" : ""}>Utility bill</option>
              <option value="property_tax_bill" ${docs.documentType === "property_tax_bill" ? "selected" : ""}>Property tax bill</option>
              <option value="mortgage_statement" ${docs.documentType === "mortgage_statement" ? "selected" : ""}>Mortgage statement</option>
              <option value="hoa_statement" ${docs.documentType === "hoa_statement" ? "selected" : ""}>HOA statement</option>
              <option value="other" ${docs.documentType === "other" ? "selected" : ""}>Other</option>
            </select>
          </label>
          <label>Name on document <input id="hownerName-${r.id}" value="${docs.ownerNameOnDocument}" placeholder="Full legal name" /></label>
          <label>Issue date <input id="hissueDate-${r.id}" type="date" value="${docs.issueDate}" /></label>
        </div>

        <label>Document upload
          <input id="hfile-${r.id}" type="file" />
        </label>
        <div class="row">
          <button class="tab" data-hupload="${r.id}">Upload document</button>
          <input id="hfileUrl-${r.id}" value="${docs.fileUrl}" placeholder="Uploaded document URL" readonly />
        </div>

        <label>Short note for reviewer
          <textarea id="hshortNote-${r.id}" placeholder="Tell us what changed and what to review first">${docs.shortNote}</textarea>
        </label>

        <label class="small"><input id="hconsent-${r.id}" type="checkbox" ${docs.consentConfirmed ? "checked" : ""} /> I confirm this document is accurate and belongs to this property.</label>

        <div class="row">
          <button data-hresubmit="${r.id}" ${canResubmit ? "" : "disabled"}>Resubmit</button>
          <button class="tab" data-vhistory="${r.id}">Load history</button>
          ${canResubmit ? "" : `<span class="small">Resubmission is available only when status is needs_more_info.</span>`}
        </div>
        ${renderTimeline(state.verificationTimelineById[r.id])}
      </div>`;
    })
    .join("");
};

const renderHomeownerListingRows = () => {
  if (!state.homeownerListingRows.length) return `<p class="small">No homeowner listings found.</p>`;

  return state.homeownerListingRows
    .map((r) => {
      const canResubmit = r.status === "needs_more_info";
      const photoUrl = parseListingPhotoUrl(r.photosJson);
      return `
      <div class="item">
        <div>${statusBadge(r.status)} • ${r.title || "Untitled listing"}</div>
        <div class="small">${r.property?.addressLine1 ?? ""}, ${r.property?.city ?? ""} ${r.property?.state ?? ""}</div>
        <div class="small">ID: ${r.id}</div>
        <div class="small">Home value-preservation: ${r.valuePreservation?.maintenanceTracked ? "active" : "not active"} • evidence completions: ${r.valuePreservation?.completedWithEvidence ?? 0}</div>
        ${r.valuePreservation?.lastCompletedAt ? `<div class="small">Last completed maintenance: ${new Date(r.valuePreservation.lastCompletedAt).toLocaleDateString()}</div>` : ""}
        ${r.reviewNotes ? `<div class="small"><strong>Reviewer note:</strong> ${r.reviewNotes}</div>` : ""}

        <label>Listing title
          <input id="ltitle-${r.id}" value="${r.title ?? ""}" placeholder="Bright 3-bed home near downtown" />
        </label>
        <label>Description
          <textarea id="ldesc-${r.id}" placeholder="Describe updates, condition, and key highlights">${r.description ?? ""}</textarea>
        </label>
        <div class="row">
          <label>Price (optional)
            <input id="lprice-${r.id}" type="number" min="1" step="1" value="${r.price ?? ""}" placeholder="450000" />
          </label>
          <label>Photo URL (optional)
            <input id="lphoto-${r.id}" value="${photoUrl}" placeholder="https://..." />
          </label>
        </div>

        <div class="row">
          <button data-lresubmit="${r.id}" ${canResubmit ? "" : "disabled"}>Resubmit Listing</button>
          <button class="tab" data-lhistory="${r.id}">Load history</button>
          ${canResubmit ? "" : `<span class="small">Listing resubmission is available only when status is needs_more_info.</span>`}
        </div>
        ${renderTimeline(state.listingTimelineById[r.id])}
      </div>`;
    })
    .join("");
};

const renderMaintenancePlans = () => {
  if (!state.maintenancePlans.length) return `<p class="small">No maintenance plans yet.</p>`;

  return state.maintenancePlans
    .map((p) => {
      const upcoming = p.tasks?.[0];
      const due = upcoming?.dueAt
        ? new Date(upcoming.dueAt).toLocaleDateString()
        : new Date(p.nextDueAt).toLocaleDateString();
      const taskId = upcoming?.id;
      return `
      <div class="item">
        <div><strong>${p.title}</strong> <span class="small">every ${p.cadenceMonths} month(s)</span></div>
        <div class="small">${p.property?.addressLine1 ?? ""}, ${p.property?.city ?? ""} ${p.property?.state ?? ""}</div>
        <div class="small">Next due: ${due}</div>
        ${p.description ? `<div class="small">${p.description}</div>` : ""}
        <div class="row">
          <label>Before photo URL (required)
            <input id="mbefore-${p.id}" placeholder="https://..." />
          </label>
          <label>After photo URL (required)
            <input id="mafter-${p.id}" placeholder="https://..." />
          </label>
        </div>
        <label>Completion note (optional)
          <textarea id="mnote-${p.id}" placeholder="What was done?"></textarea>
        </label>
        <div class="row">
          <button data-mcomplete="${p.id}" ${taskId ? "" : "disabled"}>Mark Completed</button>
          ${taskId ? "" : `<span class="small">No upcoming task available.</span>`}
        </div>
      </div>`;
    })
    .join("");
};

const render = () => {
  app.innerHTML = `
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
        <label>API URL <input id="baseUrl" value="${state.baseUrl}" /></label>
        <label>Email <input id="email" placeholder="admin@example.com" /></label>
        <label>Password <input id="password" type="password" placeholder="••••••••" /></label>
        <button id="loginBtn">Login</button>
      </div>
      <p class="small">Reviewer/admin accounts can moderate queues. Homeowner accounts can respond to "needs more info" requests.</p>
      <p class="small">${!state.currentUser ? "Tip: login first, then use queue tabs for reviewer/admin or homeowner tab for resubmission." : ["admin", "reviewer"].includes(state.currentUser.role) ? "Mode: Reviewer/Admin — use Verification Queue + Listing Queue." : "Mode: Homeowner — use Homeowner Resubmission."}</p>
      <div class="row" style="margin-top:8px;">
        <div class="small" id="sessionIdentity">${
          state.currentUser
            ? `Logged in as <strong>${state.currentUser.email}</strong> ${roleBadge(state.currentUser.role)} • verification: ${state.currentUser.verificationStatus}`
            : "Not logged in"
        }</div>
        <button id="logoutBtn" ${state.token ? "" : "disabled"}>Logout</button>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <button id="tabVerification" class="tab ${state.activeTab === "verification" ? "active" : ""}">Verification Queue</button>
        <button id="tabListing" class="tab ${state.activeTab === "listing" ? "active" : ""}">Listing Queue</button>
        <button id="tabHomeowner" class="tab ${state.activeTab === "homeowner" ? "active" : ""}">Homeowner Resubmission</button>
      </div>
    </div>

    <div class="card ${state.activeTab === "verification" ? "" : "hidden"}">
      <h2>Verification Submissions</h2>
      <div class="row">
        <select id="verificationStatus">
          <option value="pending" ${state.verificationStatus === "pending" ? "selected" : ""}>pending</option>
          <option value="approved" ${state.verificationStatus === "approved" ? "selected" : ""}>approved</option>
          <option value="rejected" ${state.verificationStatus === "rejected" ? "selected" : ""}>rejected</option>
          <option value="needs_more_info" ${state.verificationStatus === "needs_more_info" ? "selected" : ""}>needs_more_info</option>
        </select>
        <button id="loadVerification">Refresh Verification Queue</button>
      </div>
      <div id="verificationList">${renderVerificationRows()}</div>
    </div>

    <div class="card ${state.activeTab === "listing" ? "" : "hidden"}">
      <h2>Listings</h2>
      <div class="row">
        <select id="listingStatus">
          <option value="pending_review" ${state.listingStatus === "pending_review" ? "selected" : ""}>pending_review</option>
          <option value="approved" ${state.listingStatus === "approved" ? "selected" : ""}>approved</option>
          <option value="rejected" ${state.listingStatus === "rejected" ? "selected" : ""}>rejected</option>
          <option value="needs_more_info" ${state.listingStatus === "needs_more_info" ? "selected" : ""}>needs_more_info</option>
        </select>
        <button id="loadListings">Refresh Listing Queue</button>
      </div>
      <div id="listingList">${renderListingRows()}</div>

      <h3 style="margin-top:14px;">Property Manager Upgrade Intents</h3>
      <div class="row">
        <button id="loadUpgradeIntents">Load Upgrade Intents</button>
        <select id="upgradeIntentStatusFilter">
          <option value="all" ${state.upgradeIntentStatusFilter === "all" ? "selected" : ""}>all statuses</option>
          <option value="new" ${state.upgradeIntentStatusFilter === "new" ? "selected" : ""}>new</option>
          <option value="contacted" ${state.upgradeIntentStatusFilter === "contacted" ? "selected" : ""}>contacted</option>
          <option value="converted" ${state.upgradeIntentStatusFilter === "converted" ? "selected" : ""}>converted</option>
        </select>
        <input id="upgradeIntentSourceFilter" placeholder="source tag filter (e.g. mobile-upgrade-cta or all)" value="${state.upgradeIntentSourceFilter}" />
        <select id="upgradeIntentSort">
          <option value="requested_desc" ${state.upgradeIntentSort === "requested_desc" ? "selected" : ""}>requested newest</option>
          <option value="requested_asc" ${state.upgradeIntentSort === "requested_asc" ? "selected" : ""}>requested oldest</option>
          <option value="status_desc" ${state.upgradeIntentSort === "status_desc" ? "selected" : ""}>status updated newest</option>
          <option value="status_asc" ${state.upgradeIntentSort === "status_asc" ? "selected" : ""}>status updated oldest</option>
        </select>
        <button class="tab" id="exportUpgradeIntentsCsv">Export CSV</button>
        <label class="small"><input id="upgradeIntentOverdueOnly" type="checkbox" ${state.upgradeIntentOverdueOnly ? "checked" : ""} /> overdue follow-ups only</label>
      </div>
      <div id="upgradeIntentList">${renderUpgradeIntents()}</div>
    </div>

    <div class="card ${state.activeTab === "homeowner" ? "" : "hidden"}">
      <h2>Homeowner Resubmission Center</h2>
      <div class="row">
        <button id="loadMine">Load My Requests</button>
      </div>

      <h3>Verification Requests</h3>
      <div id="homeownerList">${renderHomeownerRows()}</div>

      <h3 style="margin-top:14px;">Listing Requests</h3>
      <div id="homeownerListingList">${renderHomeownerListingRows()}</div>

      <h3 style="margin-top:14px;">Property Manager (Premium)</h3>
      <div class="row">
        <button id="loadMaintenancePlans">Load Maintenance Plans</button>
      </div>
      <div id="maintenancePlanList">${renderMaintenancePlans()}</div>
    </div>
  </div>`;

  bind();
};

const loadVerificationQueue = async () => {
  const res = await request(`/review/verification-submissions?status=${state.verificationStatus}`);
  if (res.status !== 200) {
    showToast(`Verification queue load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }
  state.verificationRows = (res.data.submissions ?? []) as VerificationRow[];
  render();
};

const loadListingQueue = async () => {
  const res = await request(`/review/listings?status=${state.listingStatus}`);
  if (res.status !== 200) {
    showToast(`Listing queue load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }
  state.listingRows = (res.data.listings ?? []) as ListingRow[];
  render();
};

const loadMySubmissions = async () => {
  const [verificationRes, listingsRes] = await Promise.all([
    request("/verification-submissions/me"),
    request("/listings/me"),
  ]);

  if (verificationRes.status !== 200) {
    showToast(
      `My verification requests load failed: ${prettyError(verificationRes.data, `status ${verificationRes.status}`)}`,
      "error",
    );
    return;
  }

  if (listingsRes.status !== 200) {
    showToast(`My listings load failed: ${prettyError(listingsRes.data, `status ${listingsRes.status}`)}`, "error");
    return;
  }

  state.homeownerRows = (verificationRes.data.submissions ?? []) as HomeownerSubmissionRow[];
  state.homeownerListingRows = (listingsRes.data.listings ?? []) as HomeownerListingRow[];
  render();
};

const loadHistory = async (entityType: "verification_submission" | "listing", entityId: string) => {
  const res = await request(`/history/${entityType}/${entityId}`);
  if (res.status !== 200) {
    showToast(`History load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  const timeline = (res.data.timeline ?? []) as TimelineEvent[];
  if (entityType === "verification_submission") {
    state.verificationTimelineById[entityId] = timeline;
  } else {
    state.listingTimelineById[entityId] = timeline;
  }
  render();
};

const loadMaintenancePlans = async () => {
  const res = await request("/property-manager/plans");
  if (res.status !== 200) {
    showToast(`Maintenance plans load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  state.maintenancePlans = (res.data.plans ?? []) as MaintenancePlanRow[];
  render();
};

const loadUpgradeIntents = async () => {
  const res = await request("/review/property-manager/upgrade-intents");
  if (res.status !== 200) {
    showToast(`Upgrade intents load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  state.upgradeIntents = (res.data.intents ?? []) as UpgradeIntentRow[];
  state.upgradeIntentSummary = (res.data.summary ?? null) as UpgradeIntentSummary | null;
  state.selectedUpgradeIntentIds.forEach((id) => {
    if (!state.upgradeIntents.some((intent) => intent.id === id)) state.selectedUpgradeIntentIds.delete(id);
  });
  render();
};

const loadUpgradeIntentTrace = async (id: string) => {
  const res = await request(`/review/property-manager/upgrade-intents/${id}/trace`);
  if (res.status !== 200) {
    showToast(`Upgrade trace load failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  state.upgradeTraceByIntentId[id] = (res.data.events ?? []) as UpgradeTraceEvent[];
  render();
};

const saveUpgradeIntentStatus = async (id: string) => {
  const status = ((document.getElementById(`ustatus-${id}`) as HTMLSelectElement | null)?.value ?? "new") as
    "new" | "contacted" | "converted";
  const note = (document.getElementById(`unote-${id}`) as HTMLInputElement | null)?.value?.trim() ?? "";
  const followUpDueRaw = (document.getElementById(`ufollowdue-${id}`) as HTMLInputElement | null)?.value?.trim() ?? "";
  const followUpOwner = (document.getElementById(`ufollowowner-${id}`) as HTMLInputElement | null)?.value?.trim() ?? "";

  const res = await request(`/review/property-manager/upgrade-intents/${id}/status`, {
    method: "POST",
    body: JSON.stringify({
      status,
      note: note || undefined,
      followUpDueAt: followUpDueRaw ? new Date(followUpDueRaw).toISOString() : undefined,
      followUpOwner: followUpOwner || undefined,
    }),
  });

  if (res.status !== 200) {
    showToast(`Upgrade intent status save failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast(`Intent marked ${status}`);
  await loadUpgradeIntents();
};

const quickUpgradeIntentStatus = async (id: string, status: "contacted" | "converted") => {
  const note = status === "contacted" ? "Quick action: contacted" : "Quick action: converted";
  const res = await request(`/review/property-manager/upgrade-intents/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, note }),
  });

  if (res.status !== 200) {
    showToast(`Quick status update failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast(`Intent marked ${status}`);
  await loadUpgradeIntents();
};

const toggleUpgradeIntentSelection = (id: string, checked: boolean) => {
  if (checked) state.selectedUpgradeIntentIds.add(id);
  else state.selectedUpgradeIntentIds.delete(id);
};

const bulkUpgradeIntentStatus = async (status: "contacted" | "converted") => {
  const ids = Array.from(state.selectedUpgradeIntentIds);
  if (!ids.length) {
    showToast("Select one or more intents first.", "error");
    return;
  }

  let failed = 0;
  for (const id of ids) {
    const res = await request(`/review/property-manager/upgrade-intents/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status, note: `Bulk action: ${status}` }),
    });
    if (res.status !== 200) failed += 1;
  }

  if (failed) {
    showToast(`Bulk update finished with ${failed} failures.`, "error");
  } else {
    showToast(`Bulk updated ${ids.length} intents to ${status}`);
  }

  state.selectedUpgradeIntentIds.clear();
  await loadUpgradeIntents();
};

const applyUpgradeIntentPreset = (preset: "all" | "stale_new" | "stale_contacted") => {
  if (preset === "all") {
    state.upgradeIntentStatusFilter = "all";
    state.upgradeIntentSourceFilter = "all";
    state.upgradeIntentSort = "requested_desc";
    state.upgradeIntentOverdueOnly = false;
    saveUpgradeIntentPresetState();
    render();
    return;
  }

  if (preset === "stale_new") {
    state.upgradeIntentStatusFilter = "new";
    state.upgradeIntentSourceFilter = "all";
    state.upgradeIntentSort = "requested_asc";
    state.upgradeIntentOverdueOnly = false;
    saveUpgradeIntentPresetState();
    render();
    return;
  }

  if (preset === "stale_contacted") {
    state.upgradeIntentStatusFilter = "contacted";
    state.upgradeIntentSourceFilter = "all";
    state.upgradeIntentSort = "status_asc";
    state.upgradeIntentOverdueOnly = true;
    saveUpgradeIntentPresetState();
    render();
  }
};

const grantUpgradeEntitlement = async (id: string) => {
  const intent = state.upgradeIntents.find((r) => r.id === id);
  const userId = intent?.user?.id;
  if (!userId) {
    showToast("Missing user id for this intent.", "error");
    return;
  }

  const res = await request(`/review/property-manager/entitlements/${userId}`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, note: "granted from reviewer-web intent panel" }),
  });

  if (res.status !== 200) {
    showToast(`Grant premium failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast("Premium entitlement granted");
  await loadUpgradeIntents();
};

const completeMaintenanceTask = async (planId: string) => {
  const plan = state.maintenancePlans.find((p) => p.id === planId);
  const taskId = plan?.tasks?.[0]?.id;
  if (!taskId) {
    showToast("No upcoming maintenance task found.", "error");
    return;
  }

  const beforeEvidenceUrl =
    (document.getElementById(`mbefore-${planId}`) as HTMLInputElement | null)?.value?.trim() ?? "";
  const afterEvidenceUrl =
    (document.getElementById(`mafter-${planId}`) as HTMLInputElement | null)?.value?.trim() ?? "";
  const completionNote =
    (document.getElementById(`mnote-${planId}`) as HTMLTextAreaElement | null)?.value?.trim() ?? "";

  if (!beforeEvidenceUrl || !afterEvidenceUrl) {
    showToast("Before and after photo URLs are required.", "error");
    return;
  }

  const res = await request(`/property-manager/tasks/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify({ beforeEvidenceUrl, afterEvidenceUrl, completionNote: completionNote || undefined }),
  });

  if (res.status !== 200) {
    showToast(`Task completion failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast("Maintenance task completed");
  await loadMaintenancePlans();
};

const decideVerification = async (id: string, decision: "approve" | "reject" | "needs_more_info") => {
  const notes = (document.getElementById(`vnote-${id}`) as HTMLTextAreaElement)?.value ?? "";
  const res = await request(`/review/verification-submissions/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reviewNotes: notes || undefined }),
  });
  if (res.status !== 200) {
    showToast(`Verification ${decision} failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }
  showToast(`Verification updated: ${decision.replaceAll("_", " ")}`);
  await loadVerificationQueue();
  await loadHistory("verification_submission", id);
};

const decideListing = async (id: string, decision: "approve" | "reject" | "needs_more_info") => {
  const notes = (document.getElementById(`lnote-${id}`) as HTMLTextAreaElement)?.value ?? "";
  const res = await request(`/review/listings/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, reviewNotes: notes || undefined }),
  });
  if (res.status !== 200) {
    showToast(`Listing ${decision} failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }
  showToast(`Listing updated: ${decision.replaceAll("_", " ")}`);
  await loadListingQueue();
  await loadHistory("listing", id);
};

const uploadHomeownerDocument = async (id: string) => {
  const fileInput = document.getElementById(`hfile-${id}`) as HTMLInputElement | null;
  const file = fileInput?.files?.[0];
  if (!file) {
    showToast("Please choose a file before uploading.", "error");
    return;
  }

  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (file.type && !allowedTypes.includes(file.type)) {
    showToast("Unsupported file type. Use PDF, JPG, PNG, or WEBP.", "error");
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast("File too large. Maximum size is 10MB.", "error");
    return;
  }

  const toBase64 = (blob: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result ?? "");
        const commaIndex = raw.indexOf(",");
        resolve(commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw);
      };
      reader.onerror = () => reject(new Error("file_read_failed"));
      reader.readAsDataURL(blob);
    });

  try {
    const presign = await request("/uploads/presign", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream" }),
    });

    if (presign.status !== 200) {
      showToast(`Upload init failed: ${prettyError(presign.data, `status ${presign.status}`)}`, "error");
      return;
    }

    let finalUrl = "";

    if ((presign.data as { mode?: string }).mode === "s3") {
      const uploadUrl = (presign.data as { uploadUrl?: string }).uploadUrl;
      const fileUrl = (presign.data as { fileUrl?: string }).fileUrl;
      if (!uploadUrl || !fileUrl) {
        showToast("Upload init failed: missing signed URL", "error");
        return;
      }

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!uploadRes.ok) {
        showToast(`Upload failed: storage rejected file (${uploadRes.status})`, "error");
        return;
      }

      finalUrl = fileUrl;
    } else {
      const base64 = await toBase64(file);
      const res = await request("/uploads/documents", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream", base64 }),
      });

      if (res.status !== 201 || !res.data.url) {
        showToast(`Upload failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
        return;
      }

      const maybeUrl = String(res.data.url ?? "");
      finalUrl = maybeUrl.startsWith("http") ? maybeUrl : `${state.baseUrl}${maybeUrl}`;
    }

    const urlInput = document.getElementById(`hfileUrl-${id}`) as HTMLInputElement | null;
    if (urlInput) urlInput.value = finalUrl;
    showToast("Document uploaded");
  } catch {
    showToast("Upload failed", "error");
  }
};

const resubmitVerification = async (id: string) => {
  const documentType = (document.getElementById(`hdocType-${id}`) as HTMLSelectElement)?.value ?? "utility_bill";
  const ownerNameOnDocument = (document.getElementById(`hownerName-${id}`) as HTMLInputElement)?.value?.trim() ?? "";
  const issueDate = (document.getElementById(`hissueDate-${id}`) as HTMLInputElement)?.value ?? "";
  const fileUrl = (document.getElementById(`hfileUrl-${id}`) as HTMLInputElement)?.value?.trim() ?? "";
  const shortNote = (document.getElementById(`hshortNote-${id}`) as HTMLTextAreaElement)?.value?.trim() ?? "";
  const consentConfirmed = Boolean((document.getElementById(`hconsent-${id}`) as HTMLInputElement)?.checked);

  if (!ownerNameOnDocument || !issueDate || !fileUrl || !shortNote) {
    showToast("Please complete all required fields before resubmitting.", "error");
    return;
  }
  if (!consentConfirmed) {
    showToast("Please confirm the document is accurate before resubmitting.", "error");
    return;
  }

  const docsJson = JSON.stringify({
    documentType,
    ownerNameOnDocument,
    issueDate,
    fileUrl,
    shortNote,
    consentConfirmed,
  });

  const res = await request(`/verification-submissions/${id}/resubmit`, {
    method: "POST",
    body: JSON.stringify({ docsJson }),
  });

  if (res.status !== 200) {
    showToast(`Resubmit failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast("Verification resubmitted");
  await loadMySubmissions();
  await loadHistory("verification_submission", id);
};

const resubmitListing = async (id: string) => {
  const title = (document.getElementById(`ltitle-${id}`) as HTMLInputElement)?.value?.trim() ?? "";
  const description = (document.getElementById(`ldesc-${id}`) as HTMLTextAreaElement)?.value?.trim() ?? "";
  const priceRaw = (document.getElementById(`lprice-${id}`) as HTMLInputElement)?.value?.trim() ?? "";
  const photoUrl = (document.getElementById(`lphoto-${id}`) as HTMLInputElement)?.value?.trim() ?? "";

  if (!title || !description) {
    showToast("Please add both title and description before resubmitting listing.", "error");
    return;
  }

  const price = priceRaw ? Number(priceRaw) : undefined;
  if (priceRaw && (!Number.isFinite(price) || Number(price) <= 0)) {
    showToast("Price must be a positive number.", "error");
    return;
  }

  const photosJson = photoUrl ? JSON.stringify([photoUrl]) : undefined;

  const res = await request(`/listings/${id}/resubmit`, {
    method: "POST",
    body: JSON.stringify({ title, description, price, photosJson }),
  });

  if (res.status !== 200) {
    showToast(`Listing resubmit failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
    return;
  }

  showToast("Listing resubmitted");
  await loadMySubmissions();
  await loadHistory("listing", id);
};

const bind = () => {
  const baseUrl = document.getElementById("baseUrl") as HTMLInputElement;
  const email = document.getElementById("email") as HTMLInputElement;
  const password = document.getElementById("password") as HTMLInputElement;

  (document.getElementById("loginBtn") as HTMLButtonElement).onclick = async () => {
    state.baseUrl = baseUrl.value.trim();
    const res = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.value.trim(), password: password.value }),
    });

    if (res.status !== 200 || !res.data.token) {
      showToast(`Login failed: ${prettyError(res.data, `status ${res.status}`)}`, "error");
      return;
    }

    state.token = res.data.token as string;

    const me = await request("/auth/me");
    if (me.status === 200 && me.data.user) {
      state.currentUser = me.data.user as CurrentUser;
    }

    showToast("Login successful");
    render();
  };

  (document.getElementById("logoutBtn") as HTMLButtonElement | null)?.addEventListener("click", async () => {
    if (state.token) {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ allDevices: true }),
      });
    }
    state.token = "";
    state.currentUser = null;
    state.verificationRows = [];
    state.listingRows = [];
    state.homeownerRows = [];
    state.homeownerListingRows = [];
    state.maintenancePlans = [];
    state.upgradeIntents = [];
    state.upgradeIntentSummary = null;
    state.upgradeIntentStatusFilter = "all";
    state.upgradeIntentSourceFilter = "all";
    state.upgradeIntentSort = "requested_desc";
    state.upgradeIntentOverdueOnly = false;
    state.selectedUpgradeIntentIds.clear();
    state.verificationTimelineById = {};
    state.listingTimelineById = {};
    state.upgradeTraceByIntentId = {};
    showToast("Logged out");
    render();
  });

  (document.getElementById("tabVerification") as HTMLButtonElement).onclick = () => {
    state.activeTab = "verification";
    render();
  };
  (document.getElementById("tabListing") as HTMLButtonElement).onclick = () => {
    state.activeTab = "listing";
    render();
  };
  (document.getElementById("tabHomeowner") as HTMLButtonElement).onclick = () => {
    state.activeTab = "homeowner";
    render();
  };

  (document.getElementById("verificationStatus") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    state.verificationStatus = (e.target as HTMLSelectElement).value as VerificationStatus;
  });
  (document.getElementById("listingStatus") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    state.listingStatus = (e.target as HTMLSelectElement).value as ListingStatus;
  });

  (document.getElementById("loadVerification") as HTMLButtonElement | null)?.addEventListener(
    "click",
    loadVerificationQueue,
  );
  (document.getElementById("loadListings") as HTMLButtonElement | null)?.addEventListener("click", loadListingQueue);
  (document.getElementById("loadMine") as HTMLButtonElement | null)?.addEventListener("click", loadMySubmissions);
  (document.getElementById("loadMaintenancePlans") as HTMLButtonElement | null)?.addEventListener(
    "click",
    loadMaintenancePlans,
  );
  (document.getElementById("loadUpgradeIntents") as HTMLButtonElement | null)?.addEventListener(
    "click",
    loadUpgradeIntents,
  );
  (document.getElementById("upgradeIntentStatusFilter") as HTMLSelectElement | null)?.addEventListener(
    "change",
    (e) => {
      state.upgradeIntentStatusFilter = (e.target as HTMLSelectElement).value as
        "all" | "new" | "contacted" | "converted";
      saveUpgradeIntentPresetState();
      render();
    },
  );
  (document.getElementById("upgradeIntentSourceFilter") as HTMLInputElement | null)?.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).value.trim();
    state.upgradeIntentSourceFilter = value ? normalizeUpgradeIntentSource(value) : "all";
    saveUpgradeIntentPresetState();
    render();
  });
  (document.getElementById("upgradeIntentSort") as HTMLSelectElement | null)?.addEventListener("change", (e) => {
    state.upgradeIntentSort = (e.target as HTMLSelectElement).value as
      "requested_desc" | "requested_asc" | "status_desc" | "status_asc";
    saveUpgradeIntentPresetState();
    render();
  });
  (document.getElementById("upgradeIntentOverdueOnly") as HTMLInputElement | null)?.addEventListener("change", (e) => {
    state.upgradeIntentOverdueOnly = Boolean((e.target as HTMLInputElement).checked);
    saveUpgradeIntentPresetState();
    render();
  });
  (document.getElementById("exportUpgradeIntentsCsv") as HTMLButtonElement | null)?.addEventListener(
    "click",
    exportUpgradeIntentsCsv,
  );

  document.querySelectorAll("[data-vapprove]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideVerification((el as HTMLElement).dataset.vapprove!, "approve");
  });
  document.querySelectorAll("[data-vreject]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideVerification((el as HTMLElement).dataset.vreject!, "reject");
  });
  document.querySelectorAll("[data-vmore]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideVerification((el as HTMLElement).dataset.vmore!, "needs_more_info");
  });

  document.querySelectorAll("[data-lapprove]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideListing((el as HTMLElement).dataset.lapprove!, "approve");
  });
  document.querySelectorAll("[data-lreject]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideListing((el as HTMLElement).dataset.lreject!, "reject");
  });
  document.querySelectorAll("[data-lmore]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => decideListing((el as HTMLElement).dataset.lmore!, "needs_more_info");
  });

  document.querySelectorAll("[data-vhistory]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () =>
      loadHistory("verification_submission", (el as HTMLElement).dataset.vhistory!);
  });
  document.querySelectorAll("[data-lhistory]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => loadHistory("listing", (el as HTMLElement).dataset.lhistory!);
  });

  document.querySelectorAll("[data-hupload]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => uploadHomeownerDocument((el as HTMLElement).dataset.hupload!);
  });
  document.querySelectorAll("[data-hresubmit]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => resubmitVerification((el as HTMLElement).dataset.hresubmit!);
  });
  document.querySelectorAll("[data-lresubmit]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => resubmitListing((el as HTMLElement).dataset.lresubmit!);
  });
  document.querySelectorAll("[data-mcomplete]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => completeMaintenanceTask((el as HTMLElement).dataset.mcomplete!);
  });
  (document.querySelector("[data-ubulk-contacted]") as HTMLButtonElement | null)?.addEventListener("click", () => {
    void bulkUpgradeIntentStatus("contacted");
  });
  (document.querySelector("[data-ubulk-converted]") as HTMLButtonElement | null)?.addEventListener("click", () => {
    void bulkUpgradeIntentStatus("converted");
  });
  (document.querySelector("[data-upreset-all]") as HTMLButtonElement | null)?.addEventListener("click", () => {
    applyUpgradeIntentPreset("all");
  });
  (document.querySelector("[data-upreset-stale]") as HTMLButtonElement | null)?.addEventListener("click", () => {
    applyUpgradeIntentPreset("stale_new");
  });
  (document.querySelector("[data-upreset-stale-contacted]") as HTMLButtonElement | null)?.addEventListener(
    "click",
    () => {
      applyUpgradeIntentPreset("stale_contacted");
    },
  );

  document.querySelectorAll("[data-uselect]").forEach((el) => {
    (el as HTMLInputElement).onchange = () => {
      const id = (el as HTMLElement).dataset.uselect!;
      toggleUpgradeIntentSelection(id, (el as HTMLInputElement).checked);
      render();
    };
  });

  document.querySelectorAll("[data-ucontact]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () =>
      quickUpgradeIntentStatus((el as HTMLElement).dataset.ucontact!, "contacted");
  });
  document.querySelectorAll("[data-uconvert]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () =>
      quickUpgradeIntentStatus((el as HTMLElement).dataset.uconvert!, "converted");
  });
  document.querySelectorAll("[data-ustatus-save]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => saveUpgradeIntentStatus((el as HTMLElement).dataset.ustatusSave!);
  });
  document.querySelectorAll("[data-utrace]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => loadUpgradeIntentTrace((el as HTMLElement).dataset.utrace!);
  });
  document.querySelectorAll("[data-uentitle]").forEach((el) => {
    (el as HTMLButtonElement).onclick = () => grantUpgradeEntitlement((el as HTMLElement).dataset.uentitle!);
  });
};

loadUpgradeIntentPresetState();
render();
