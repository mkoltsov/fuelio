const STORAGE_KEY = "fuel-ledger-pages-v2";
const SETTINGS_KEY = "fuel-ledger-settings-v1";
const ENTRY_DRAFT_KEY = "fuel-ledger-entry-drafts-v1";
const ISSUE_URL = "https://github.com/mkoltsov/fuelio/issues/new";
const CHART_METRICS = ["spend", "price", "liters", "consumption", "odometer"];
const GALLON_TO_LITER = 3.785411784;
const MILE_TO_KM = 1.609344;
const CURRENCY_SYMBOL = "$";

const state = {
  fuel: [],
  maintenance: [],
  reminders: [],
  chartMetric: "consumption",
};

const el = (id) => document.getElementById(id);

function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function toCSV(rows, headers) {
  const escape = (value) => {
    const s = String(value ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

function number(value) {
  const n = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `${CURRENCY_SYMBOL}${number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function litersFromGallons(value) {
  return number(value) * GALLON_TO_LITER;
}

function kmFromMiles(value) {
  return number(value) * MILE_TO_KM;
}

function formatLiters(value) {
  return `${number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
}

function formatFuelVolume(gallonsValue) {
  return formatLiters(litersFromGallons(gallonsValue));
}

function formatOdometer(value) {
  const n = number(value);
  return n ? `${Math.round(n).toLocaleString()} mi` : "";
}

function formatKm(value) {
  return `${number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
}

function formatConsumption(value) {
  const n = number(value);
  return n ? `${n.toFixed(1)} L/100 km` : "";
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function pricePerLiterFor(record) {
  const litersValue = litersFromGallons(record.gallons);
  return litersValue ? number(record.cost) / litersValue : 0;
}

function fuelWithEconomy() {
  const rows = state.fuel
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((record) => ({ record, odometer: number(record.odometer), gallons: number(record.gallons), liters: litersFromGallons(record.gallons), consumption: 0, km: 0 }));
  let previous = null;
  for (const row of rows) {
    const full = row.record.partial_fuelup !== "1" && row.record.missed_fuelup !== "1";
    const valid = row.odometer > 0 && row.gallons > 0 && full;
    if (valid && previous && row.odometer > previous.odometer) {
      row.km = kmFromMiles(row.odometer - previous.odometer);
      row.consumption = row.km ? (row.liters / row.km) * 100 : 0;
    }
    if (valid) previous = row;
  }
  return rows;
}

function consumptionForRecord(record, economyRows = fuelWithEconomy()) {
  const row = economyRows.find((entry) => entry.record === record);
  return row && row.consumption ? row.consumption : 0;
}

function normalizeFuel(record) {
  return {
    date: record.date || record.fuelup_date || "",
    odometer: record.odometer || "",
    gallons: record.gallons || "",
    cost: record.cost || (number(record.gallons) * number(record.price)).toFixed(2),
    notes: record.notes || "",
    tags: record.tags || "",
    partial_fuelup: record.partial_fuelup || "0",
    missed_fuelup: record.missed_fuelup || "0",
    source: record.source || "",
    fuelio_unique_id: record.fuelio_unique_id || "",
  };
}

function updateStorageStatus(message) {
  document.querySelectorAll(".entryStatus").forEach((node) => {
    node.textContent = message;
  });
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    updateStorageStatus("Browser storage is blocked");
    return false;
  }
}

function readJSONStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applySettings(data) {
  if (!data || typeof data !== "object") return;
  if (CHART_METRICS.includes(data.chartMetric)) state.chartMetric = data.chartMetric;
}

function saveSettings() {
  const saved = writeLocalStorage(SETTINGS_KEY, JSON.stringify({ chartMetric: state.chartMetric }));
  return saved;
}

function loadSavedSettings() {
  const data = readJSONStorage(SETTINGS_KEY);
  applySettings(data);
  return Boolean(data);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function save() {
  return true;
}

function loadSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Published data should still load even when browser storage is unavailable.
  }
  return false;
}

async function loadSeedData() {
  const fetchFirst = async (paths) => {
    for (const path of paths) {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) return response.text();
    }
    throw new Error(`Missing data file: ${paths.join(" or ")}`);
  };
  const [fuelText, maintenanceText, remindersText] = await Promise.all([
    fetchFirst(["data/fuel.csv"]),
    fetch(`data/maintenance.csv?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "date,odometer,service,category,cost,vendor,notes\n"),
    fetch(`data/reminders.csv?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "title,category,due_date,due_odometer,interval_days,interval_miles,notes\n"),
  ]);
  state.fuel = parseCSV(fuelText).map(normalizeFuel);
  state.maintenance = parseCSV(maintenanceText);
  state.reminders = parseCSV(remindersText);
}

function metrics() {
  const fuel = state.fuel.filter((r) => number(r.gallons) || number(r.cost));
  const totalCost = fuel.reduce((sum, r) => sum + number(r.cost), 0);
  const totalGallons = fuel.reduce((sum, r) => sum + number(r.gallons), 0);
  const totalLiters = litersFromGallons(totalGallons);
  const prices = fuel.map(pricePerLiterFor).filter(Boolean);
  const economy = fuelWithEconomy().filter((r) => r.consumption > 0);
  const economyKm = economy.reduce((sum, r) => sum + r.km, 0);
  const economyLiters = economy.reduce((sum, r) => sum + r.liters, 0);
  const sortedDates = fuel.map((r) => dateOnly(r.date)).filter(Boolean).sort();
  const latest = fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const latestOdometer = fuel
    .filter((r) => number(r.odometer) > 0)
    .sort((a, b) => number(b.odometer) - number(a.odometer))[0];
  const missingOdometer = fuel.filter((r) => !number(r.odometer)).length;
  return {
    count: fuel.length,
    totalCost,
    totalGallons,
    totalLiters,
    averagePrice: totalLiters ? totalCost / totalLiters : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    avgConsumption: economyKm ? (economyLiters / economyKm) * 100 : 0,
    economyCount: economy.length,
    economyKm,
    missingOdometer,
    start: sortedDates[0] || "",
    end: sortedDates.at(-1) || "",
    latest,
    latestOdometer,
  };
}

function maintenanceMetrics() {
  const rows = state.maintenance.filter((r) => number(r.cost));
  const totalCost = rows.reduce((sum, r) => sum + number(r.cost), 0);
  const latest = rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return {
    count: rows.length,
    totalCost,
    latest,
  };
}

function monthlyData() {
  const buckets = new Map();
  const economyByRecord = new Map(fuelWithEconomy().map((row) => [row.record, row]));
  for (const record of state.fuel) {
    const month = dateOnly(record.date).slice(0, 7);
    if (!month) continue;
    if (!buckets.has(month)) buckets.set(month, { month, spend: 0, liters: 0, count: 0, economyKm: 0, economyLiters: 0, odometer: 0 });
    const bucket = buckets.get(month);
    bucket.spend += number(record.cost);
    bucket.liters += litersFromGallons(record.gallons);
    bucket.count += 1;
    bucket.odometer = Math.max(bucket.odometer, number(record.odometer));
    const economy = economyByRecord.get(record);
    if (economy && economy.consumption) {
      bucket.economyKm += economy.km;
      bucket.economyLiters += economy.liters;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({
      ...b,
      price: b.liters ? b.spend / b.liters : 0,
      consumption: b.economyKm ? (b.economyLiters / b.economyKm) * 100 : 0,
    }));
}

function renderMetrics() {
  const m = metrics();
  const maintenance = maintenanceMetrics();
  el("datasetStatus").textContent = `${m.count} fill-ups in public CSV`;
  el("dateRange").textContent = m.start && m.end ? `${m.start} to ${m.end}` : "No records loaded";
  const defs = [
    ["Latest odometer", formatOdometer(m.latestOdometer?.odometer) || "n/a", dateOnly(m.latestOdometer?.date) || "No reading"],
    ["Avg consumption", formatConsumption(m.avgConsumption) || "n/a", `${m.economyCount} odometer intervals`],
    ["Fuel spend", money(m.totalCost), "Receipt totals"],
    ["Maintenance", money(maintenance.totalCost), `${maintenance.count} records`],
    ["Total cost", money(m.totalCost + maintenance.totalCost), "Fuel plus maintenance"],
    ["Fuel bought", formatLiters(m.totalLiters), "Converted from gallons"],
  ];
  el("metricsGrid").innerHTML = defs
    .map(([label, value, hint]) => `<article class="metric"><div class="metricLabel">${label}</div><div class="metricValue">${value}</div><div class="metricHint">${hint}</div></article>`)
    .join("");
}

function drawChart() {
  const canvas = el("trendChart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = rect.height;
  const data = monthlyData();
  ctx.clearRect(0, 0, width, height);
  const metric = state.chartMetric;
  const titleMap = { spend: "Monthly Fuel Spend", price: "Monthly Fuel Price", liters: "Monthly Fuel Volume", consumption: "Monthly Consumption", odometer: "Monthly Odometer" };
  const subtitleMap = { spend: "receipt totals", price: "weighted average per liter", liters: "liters purchased", consumption: "liters per 100 km", odometer: "latest reading each month" };
  el("chartTitle").textContent = titleMap[metric];
  el("chartSubtitle").textContent = subtitleMap[metric];
  if (!data.length) return;
  const values = data.map((d) => d[metric]);
  const plottedValues = metric === "odometer" ? values.filter(Boolean) : values;
  const max = Math.max(...plottedValues, 1);
  const min = metric === "odometer" && plottedValues.length ? Math.min(...plottedValues) : 0;
  const span = Math.max(max - min, 1);
  const pad = { left: 46, right: 12, top: 18, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.strokeStyle = "#2d3742";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();
  const barGap = 4;
  const barW = Math.max(8, plotW / data.length - barGap);
  data.forEach((d, index) => {
    const value = d[metric];
    if (metric === "odometer" && !value) return;
    const x = pad.left + (plotW * index) / data.length + barGap / 2;
    const h = ((value - min) / span) * plotH;
    const y = pad.top + plotH - h;
    ctx.fillStyle = metric === "price" ? "#e3a04f" : metric === "liters" || metric === "consumption" ? "#36b37e" : metric === "odometer" ? "#8f7cf4" : "#4aa3ff";
    ctx.fillRect(x, y, barW, h);
    if (index % Math.ceil(data.length / 8) === 0) {
      ctx.fillStyle = "#cbd4df";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.month.slice(2), x + barW / 2, height - 12);
    }
  });
  ctx.fillStyle = "#cbd4df";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = max - (span * i) / 4;
    const label = metric === "spend" || metric === "price" ? money(value) : metric === "consumption" ? value.toFixed(1) : Math.round(value).toLocaleString();
    ctx.fillText(label, pad.left - 8, pad.top + (plotH * i) / 4 + 4);
  }
}

function renderRecent() {
  const recent = state.fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  const economyRows = fuelWithEconomy();
  el("recentCount").textContent = `${recent.length} shown`;
  el("recentFuelRows").innerHTML = recent
    .map((r) => `<tr><td>${dateOnly(r.date)}</td><td class="numeric">${formatOdometer(r.odometer) || "—"}</td><td class="numeric">${formatFuelVolume(r.gallons)}</td><td class="numeric">${money(pricePerLiterFor(r))}/L</td><td class="numeric">${formatConsumption(consumptionForRecord(r, economyRows)) || "—"}</td><td class="numeric">${money(r.cost)}</td></tr>`)
    .join("");
}

function renderQuality() {
  const m = metrics();
  const maintenance = maintenanceMetrics();
  const economyRows = fuelWithEconomy().filter((r) => r.consumption > 0);
  const latestInterval = economyRows.at(-1);
  const missingRecent = state.fuel
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((r) => !number(r.odometer))
    .slice(0, 4)
    .map((r) => dateOnly(r.date));
  el("qualityList").innerHTML = [
    ["Last interval", latestInterval ? formatConsumption(latestInterval.consumption) : "n/a", latestInterval ? `${formatKm(latestInterval.km)} since previous fill-up` : "Need odometer readings"],
    ["Latest maintenance", maintenance.latest?.service || "n/a", maintenance.latest ? `${dateOnly(maintenance.latest.date)} · ${money(maintenance.latest.cost)}` : "No maintenance costs in Fuelio backup"],
    ["Missing odometer", String(m.missingOdometer), missingRecent.length ? missingRecent.join(", ") : "Recent rows are complete"],
    ["Fresh data", dateOnly(m.latest?.date) || "n/a", "Loaded from data/fuel.csv on each visit"],
  ].map(([label, value, hint]) => `<div class="insightRow"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`).join("");
}

function renderFuelTable() {
  const query = el("fuelSearch").value.trim().toLowerCase();
  const rows = state.fuel
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((r) => !query || `${r.date} ${r.notes} ${r.tags} ${r.source}`.toLowerCase().includes(query));
  const tbody = el("fuelRows");
  tbody.innerHTML = "";
  const economyRows = fuelWithEconomy();
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = [
      [dateOnly(r.date), ""],
      [formatOdometer(r.odometer) || "—", "numeric"],
      [formatFuelVolume(r.gallons), "numeric"],
      [money(r.cost), "numeric"],
      [`${money(pricePerLiterFor(r))}/L`, "numeric"],
      [formatConsumption(consumptionForRecord(r, economyRows)) || "—", "numeric"],
      [r.source || "", ""],
      [r.notes || "", ""],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      if (className) td.className = className;
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderMaintenance() {
  const tbody = el("maintenanceRows");
  tbody.innerHTML = "";
  if (!state.maintenance.length) {
    tbody.innerHTML = `<tr><td class="empty" colspan="7">No maintenance records</td></tr>`;
    return;
  }
  const rows = state.maintenance.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = [
      [dateOnly(r.date), ""],
      [formatOdometer(r.odometer) || "—", "numeric"],
      [r.service || "", ""],
      [r.category || "", ""],
      [money(r.cost), "numeric"],
      [r.vendor || "", ""],
      [r.notes || "", ""],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      if (className) td.className = className;
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderReminders() {
  const list = el("reminderList");
  if (!state.reminders.length) {
    list.innerHTML = `<div class="empty">No reminders</div>`;
    return;
  }
  list.innerHTML = state.reminders.map((r) => `
    <article class="reminder">
      <div><strong>${r.title || "Untitled"}</strong><p>${r.category || "General"} · ${r.notes || ""}</p></div>
      <span>${r.due_date || r.due_odometer || "No due target"}</span>
    </article>
  `).join("");
}

function syncChartControls() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.chart === state.chartMetric);
  });
}

function renderAll() {
  syncChartControls();
  renderMetrics();
  drawChart();
  renderRecent();
  renderQuality();
  renderFuelTable();
  renderMaintenance();
  renderReminders();
}

function download(name, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formValue(id) {
  return el(id).value.trim();
}

function setFormValue(id, value) {
  const node = el(id);
  if (node) node.value = value || "";
}

function draftState() {
  return readJSONStorage(ENTRY_DRAFT_KEY) || {};
}

function fillupPayload() {
  return {
    kind: "fillup",
    entry: {
      date: formValue("fillupDate"),
      odometer: Math.round(number(formValue("fillupOdometer"))),
      liters: number(formValue("fillupLiters")),
      cost: number(formValue("fillupCost")),
      notes: formValue("fillupNotes"),
    },
    source: "github-pages",
    updated_at: new Date().toISOString(),
  };
}

function maintenancePayload() {
  return {
    kind: "maintenance",
    entry: {
      date: formValue("maintenanceDate"),
      odometer: Math.round(number(formValue("maintenanceOdometer"))),
      service: formValue("maintenanceService"),
      category: formValue("maintenanceCategory"),
      cost: number(formValue("maintenanceCost")),
      vendor: formValue("maintenanceVendor"),
      notes: formValue("maintenanceNotes"),
    },
    source: "github-pages",
    updated_at: new Date().toISOString(),
  };
}

function isValidFillup(payload) {
  return Boolean(payload.entry.date && payload.entry.odometer > 0 && payload.entry.liters > 0 && payload.entry.cost >= 0);
}

function isValidMaintenance(payload) {
  return Boolean(payload.entry.date && payload.entry.service && payload.entry.cost > 0);
}

function issueHref(payload) {
  const body = [
    "Update the fuel ledger from the GitHub Pages entry form.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
  const params = new URLSearchParams({
    title: `[fuel-ledger-entry] ${payload.kind} ${payload.entry.date || todayISO()}`,
    body,
  });
  return `${ISSUE_URL}?${params.toString()}`;
}

function setIssueLink(linkId, statusId, payload, valid, validMessage, invalidMessage) {
  const link = el(linkId);
  const status = el(statusId);
  link.href = valid ? issueHref(payload) : "#";
  link.setAttribute("aria-disabled", valid ? "false" : "true");
  link.classList.toggle("disabled", !valid);
  status.textContent = valid ? validMessage : invalidMessage;
}

function updateEntryLinks() {
  const fillup = fillupPayload();
  const maintenance = maintenancePayload();
  setIssueLink("saveFillup", "fillupStatus", fillup, isValidFillup(fillup), "Draft saved here; open GitHub to commit this fill-up.", "Date, odometer, liters, and total cost are required.");
  setIssueLink("saveMaintenance", "maintenanceStatus", maintenance, isValidMaintenance(maintenance), "Draft saved here; open GitHub to commit this cost.", "Date, service, and cost are required.");
}

function saveEntryDrafts() {
  writeLocalStorage(ENTRY_DRAFT_KEY, JSON.stringify({
    fillup: fillupPayload().entry,
    maintenance: maintenancePayload().entry,
    updated_at: new Date().toISOString(),
  }));
  updateEntryLinks();
}

function loadEntryDrafts() {
  const drafts = draftState();
  const fillup = drafts.fillup || {};
  const maintenance = drafts.maintenance || {};
  setFormValue("fillupDate", fillup.date || todayISO());
  setFormValue("fillupOdometer", fillup.odometer);
  setFormValue("fillupLiters", fillup.liters);
  setFormValue("fillupCost", fillup.cost);
  setFormValue("fillupNotes", fillup.notes);
  setFormValue("maintenanceDate", maintenance.date || todayISO());
  setFormValue("maintenanceOdometer", maintenance.odometer);
  setFormValue("maintenanceService", maintenance.service);
  setFormValue("maintenanceCategory", maintenance.category || "Service");
  setFormValue("maintenanceCost", maintenance.cost);
  setFormValue("maintenanceVendor", maintenance.vendor);
  setFormValue("maintenanceNotes", maintenance.notes);
  updateEntryLinks();
}

function bindEntryForms() {
  document.querySelectorAll("[data-entry-field]").forEach((node) => {
    node.addEventListener("input", saveEntryDrafts);
    node.addEventListener("change", saveEntryDrafts);
  });
  ["saveFillup", "saveMaintenance"].forEach((id) => {
    el(id).addEventListener("click", (event) => {
      if (el(id).getAttribute("aria-disabled") === "true") event.preventDefault();
    });
  });
  loadEntryDrafts();
}

function bindEvents() {
  document.querySelectorAll(".navItem").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".navItem,.view").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      el(button.dataset.view).classList.add("active");
      drawChart();
    });
  });
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.chartMetric = button.dataset.chart;
      saveSettings();
      drawChart();
    });
  });
  el("fuelSearch").addEventListener("input", renderFuelTable);
  el("exportFuel").addEventListener("click", () => {
    download("fuel.csv", toCSV(state.fuel, ["date", "odometer", "gallons", "cost", "notes", "tags", "partial_fuelup", "missed_fuelup", "source", "fuelio_unique_id"]));
  });
  el("exportBackup").addEventListener("click", () => {
    download("fuel-ledger-backup.json", JSON.stringify(state, null, 2), "application/json");
  });
  el("resetData").addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    await loadSeedData();
    renderAll();
  });
  el("importFuel").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.fuel = parseCSV(await file.text()).map(normalizeFuel);
    save();
    renderAll();
    event.target.value = "";
  });
  bindEntryForms();
  window.addEventListener("resize", drawChart);
}

async function init() {
  const loaded = loadSaved();
  loadSavedSettings();
  if (!loaded) await loadSeedData();
  bindEvents();
  renderAll();
}

init().catch((error) => {
  el("datasetStatus").textContent = `Failed to load data: ${error.message}`;
});
