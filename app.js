const STORAGE_KEY = "fuel-ledger-pages-v2";
const SETTINGS_KEY = "fuel-ledger-settings-v1";
const CHART_METRICS = ["spend", "price", "gallons", "mpg", "odometer"];

const state = {
  fuel: [],
  maintenance: [],
  reminders: [],
  settings: {
    vehicleName: "The Matrix",
    distanceUnit: "mi",
    fuelUnit: "gal",
    currencySymbol: "$",
  },
  chartMetric: "spend",
};

const el = (id) => document.getElementById(id);
const SETTING_FIELDS = ["vehicleName", "distanceUnit", "fuelUnit", "currencySymbol"];

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
  return `${state.settings.currencySymbol}${number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFuelVolume(value) {
  return `${number(value).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${state.settings.fuelUnit}`;
}

function formatOdometer(value) {
  const n = number(value);
  return n ? `${Math.round(n).toLocaleString()} ${state.settings.distanceUnit}` : "";
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function priceFor(record) {
  const gallonsValue = number(record.gallons);
  return gallonsValue ? number(record.cost) / gallonsValue : 0;
}

function fuelWithEconomy() {
  const rows = state.fuel
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((record) => ({ record, odometer: number(record.odometer), gallons: number(record.gallons), mpg: 0, miles: 0 }));
  let previous = null;
  for (const row of rows) {
    const full = row.record.partial_fuelup !== "1" && row.record.missed_fuelup !== "1";
    const valid = row.odometer > 0 && row.gallons > 0 && full;
    if (valid && previous && row.odometer > previous.odometer) {
      row.miles = row.odometer - previous.odometer;
      row.mpg = row.miles / row.gallons;
    }
    if (valid) previous = row;
  }
  return rows;
}

function mpgForRecord(record, economyRows = fuelWithEconomy()) {
  const row = economyRows.find((entry) => entry.record === record);
  return row && row.mpg ? row.mpg : 0;
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

function updateSettingsStatus(message) {
  const node = el("settingsStatus");
  if (node) node.textContent = message;
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    updateSettingsStatus("Browser storage is blocked");
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
  state.settings = { ...state.settings, ...(data.settings || {}) };
  if (CHART_METRICS.includes(data.chartMetric)) state.chartMetric = data.chartMetric;
}

function saveSettings() {
  const saved = writeLocalStorage(SETTINGS_KEY, JSON.stringify({
    settings: state.settings,
    chartMetric: state.chartMetric,
  }));
  updateSettingsStatus(saved ? "Saved in this browser" : "Browser storage is blocked");
  return saved;
}

function loadSavedSettings() {
  const data = readJSONStorage(SETTINGS_KEY);
  applySettings(data);
  return Boolean(data);
}

function save() {
  const saved = writeLocalStorage(STORAGE_KEY, JSON.stringify(state));
  const settingsSaved = saveSettings();
  return saved && settingsSaved;
}

function loadSaved() {
  const data = readJSONStorage(STORAGE_KEY);
  if (!data) return false;
  state.fuel = Array.isArray(data.fuel) ? data.fuel : [];
  state.maintenance = Array.isArray(data.maintenance) ? data.maintenance : [];
  state.reminders = Array.isArray(data.reminders) ? data.reminders : [];
  applySettings(data);
  return true;
}

async function loadSeedData() {
  const fetchFirst = async (paths) => {
    for (const path of paths) {
      const response = await fetch(path);
      if (response.ok) return response.text();
    }
    throw new Error(`Missing data file: ${paths.join(" or ")}`);
  };
  const [fuelText, maintenanceText, remindersText] = await Promise.all([
    fetchFirst(["data/fuel.csv"]),
    fetch("data/maintenance.csv").then((r) => r.text()).catch(() => "date,odometer,service,category,cost,vendor,notes\n"),
    fetch("data/reminders.csv").then((r) => r.text()).catch(() => "title,category,due_date,due_odometer,interval_days,interval_miles,notes\n"),
  ]);
  state.fuel = parseCSV(fuelText).map(normalizeFuel);
  state.maintenance = parseCSV(maintenanceText);
  state.reminders = parseCSV(remindersText);
  save();
}

function metrics() {
  const fuel = state.fuel.filter((r) => number(r.gallons) || number(r.cost));
  const totalCost = fuel.reduce((sum, r) => sum + number(r.cost), 0);
  const totalGallons = fuel.reduce((sum, r) => sum + number(r.gallons), 0);
  const prices = fuel.map(priceFor).filter(Boolean);
  const economy = fuelWithEconomy().filter((r) => r.mpg > 0);
  const economyMiles = economy.reduce((sum, r) => sum + r.miles, 0);
  const economyGallons = economy.reduce((sum, r) => sum + r.gallons, 0);
  const sortedDates = fuel.map((r) => dateOnly(r.date)).filter(Boolean).sort();
  const latest = fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const latestOdometer = fuel
    .filter((r) => number(r.odometer) > 0)
    .sort((a, b) => number(b.odometer) - number(a.odometer))[0];
  return {
    count: fuel.length,
    totalCost,
    totalGallons,
    averagePrice: totalGallons ? totalCost / totalGallons : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    avgMpg: economyGallons ? economyMiles / economyGallons : 0,
    economyCount: economy.length,
    start: sortedDates[0] || "",
    end: sortedDates.at(-1) || "",
    latest,
    latestOdometer,
  };
}

function monthlyData() {
  const buckets = new Map();
  const economyByRecord = new Map(fuelWithEconomy().map((row) => [row.record, row]));
  for (const record of state.fuel) {
    const month = dateOnly(record.date).slice(0, 7);
    if (!month) continue;
    if (!buckets.has(month)) buckets.set(month, { month, spend: 0, gallons: 0, count: 0, economyMiles: 0, economyGallons: 0, odometer: 0 });
    const bucket = buckets.get(month);
    bucket.spend += number(record.cost);
    bucket.gallons += number(record.gallons);
    bucket.count += 1;
    bucket.odometer = Math.max(bucket.odometer, number(record.odometer));
    const economy = economyByRecord.get(record);
    if (economy && economy.mpg) {
      bucket.economyMiles += economy.miles;
      bucket.economyGallons += economy.gallons;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({
      ...b,
      price: b.gallons ? b.spend / b.gallons : 0,
      mpg: b.economyGallons ? b.economyMiles / b.economyGallons : 0,
    }));
}

function renderMetrics() {
  const m = metrics();
  el("datasetStatus").textContent = `${m.count} fill-ups stored locally`;
  el("dateRange").textContent = m.start && m.end ? `${m.start} to ${m.end}` : "No records loaded";
  const defs = [
    ["Fill-ups", m.count, "Fuelio plus Costco"],
    ["Latest odometer", formatOdometer(m.latestOdometer?.odometer) || "n/a", dateOnly(m.latestOdometer?.date) || "No reading"],
    ["Fuel spend", money(m.totalCost), "Receipt totals"],
    ["Fuel bought", `${m.totalGallons.toFixed(1)} ${state.settings.fuelUnit}`, "Total volume"],
    ["Avg price", `${money(m.averagePrice)}/${state.settings.fuelUnit}`, `Range ${money(m.minPrice)} to ${money(m.maxPrice)}`],
    ["Avg MPG", m.avgMpg ? m.avgMpg.toFixed(1) : "n/a", `${m.economyCount} odometer intervals`],
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
  const titleMap = { spend: "Monthly Fuel Spend", price: "Monthly Fuel Price", gallons: "Monthly Fuel Volume", mpg: "Monthly MPG", odometer: "Monthly Odometer" };
  const subtitleMap = { spend: "receipt totals", price: `weighted average per ${state.settings.fuelUnit}`, gallons: "volume purchased", mpg: "odometer-derived economy", odometer: "latest reading each month" };
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
  ctx.strokeStyle = "#d9e0e8";
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
    ctx.fillStyle = metric === "price" ? "#a46424" : metric === "gallons" || metric === "mpg" ? "#2f7d62" : metric === "odometer" ? "#6d5f98" : "#1f6f9f";
    ctx.fillRect(x, y, barW, h);
    if (index % Math.ceil(data.length / 8) === 0) {
      ctx.fillStyle = "#5d6877";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.month.slice(2), x + barW / 2, height - 12);
    }
  });
  ctx.fillStyle = "#5d6877";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = max - (span * i) / 4;
    const label = metric === "spend" || metric === "price" ? money(value) : Math.round(value).toLocaleString();
    ctx.fillText(label, pad.left - 8, pad.top + (plotH * i) / 4 + 4);
  }
}

function renderRecent() {
  const recent = state.fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  el("recentCount").textContent = `${recent.length} shown`;
  el("recentFuelRows").innerHTML = recent
    .map((r) => `<tr><td>${dateOnly(r.date)}</td><td class="numeric">${formatOdometer(r.odometer) || ""}</td><td class="numeric">${formatFuelVolume(r.gallons)}</td><td class="numeric">${money(priceFor(r))}</td><td class="numeric">${money(r.cost)}</td></tr>`)
    .join("");
}

function editableCell(record, field, onChange) {
  const input = document.createElement("input");
  input.className = "cellInput";
  input.value = record[field] ?? "";
  input.addEventListener("change", () => {
    record[field] = input.value;
    onChange();
  });
  return input;
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
    for (const field of ["date", "odometer", "gallons", "cost"]) {
      const td = document.createElement("td");
      if (["gallons", "cost"].includes(field)) td.className = "numeric";
      td.append(editableCell(r, field, () => { save(); renderAll(); }));
      tr.append(td);
    }
    const price = document.createElement("td");
    price.className = "numeric";
    price.textContent = money(priceFor(r));
    tr.append(price);
    const mpg = document.createElement("td");
    mpg.className = "numeric";
    const mpgValue = mpgForRecord(r, economyRows);
    mpg.textContent = mpgValue ? mpgValue.toFixed(1) : "";
    tr.append(mpg);
    const source = document.createElement("td");
    source.textContent = r.source || "";
    tr.append(source);
    const notes = document.createElement("td");
    notes.append(editableCell(r, "notes", () => { save(); renderAll(); }));
    tr.append(notes);
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
  for (const r of state.maintenance) {
    const tr = document.createElement("tr");
    for (const field of ["date", "odometer", "service", "category", "cost", "vendor", "notes"]) {
      const td = document.createElement("td");
      td.append(editableCell(r, field, () => { save(); renderAll(); }));
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

function syncSettingsControls() {
  for (const field of SETTING_FIELDS) {
    el(field).value = state.settings[field];
  }
}

function renderAll() {
  syncChartControls();
  renderMetrics();
  drawChart();
  renderRecent();
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
      save();
      drawChart();
    });
  });
  el("fuelSearch").addEventListener("input", renderFuelTable);
  el("addFuelRow").addEventListener("click", () => {
    state.fuel.unshift({ date: new Date().toISOString().slice(0, 10), odometer: "", gallons: "", cost: "", notes: "", tags: "", partial_fuelup: "0", missed_fuelup: "0", source: "Manual", fuelio_unique_id: "" });
    save();
    renderAll();
  });
  el("addMaintenanceRow").addEventListener("click", () => {
    state.maintenance.unshift({ date: new Date().toISOString().slice(0, 10), odometer: "", service: "", category: "", cost: "", vendor: "", notes: "" });
    save();
    renderAll();
  });
  el("addReminderRow").addEventListener("click", () => {
    state.reminders.unshift({ title: "New reminder", category: "Maintenance", due_date: "", due_odometer: "", interval_days: "", interval_miles: "", notes: "" });
    save();
    renderAll();
  });
  el("exportFuel").addEventListener("click", () => {
    download("fuel.csv", toCSV(state.fuel, ["date", "odometer", "gallons", "cost", "notes", "tags", "partial_fuelup", "missed_fuelup", "source", "fuelio_unique_id"]));
  });
  el("exportBackup").addEventListener("click", () => {
    download("fuel-ledger-backup.json", JSON.stringify(state, null, 2), "application/json");
  });
  el("resetData").addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    saveSettings();
    await loadSeedData();
    renderAll();
    updateSettingsStatus("Data reset; settings kept");
  });
  el("importFuel").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.fuel = parseCSV(await file.text()).map(normalizeFuel);
    save();
    renderAll();
    event.target.value = "";
  });
  syncSettingsControls();
  SETTING_FIELDS.forEach((field) => {
    const node = el(field);
    const updateSetting = () => {
      state.settings[field] = node.value;
      save();
      renderAll();
    };
    node.addEventListener("input", updateSetting);
    node.addEventListener("change", updateSetting);
  });
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
