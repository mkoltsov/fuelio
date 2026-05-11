#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const ORDERS_URL = "https://www.costco.com/myaccount/#/app/4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf/ordersandpurchases";
const BRAVE_EXE = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const BRAVE_PROFILE = "C:\\temp\\brave_profile";

function parseArgs() {
  const out = { port: 9222, months: 6, output: "", startDate: "", endDate: "", openBrowser: true };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--port") out.port = Number(process.argv[++i]);
    else if (arg === "--months") out.months = Number(process.argv[++i]);
    else if (arg === "--output") out.output = process.argv[++i];
    else if (arg === "--start-date") out.startDate = process.argv[++i];
    else if (arg === "--end-date") out.endDate = process.argv[++i];
    else if (arg === "--no-open-browser") out.openBrowser = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function costcoDate(date) {
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function dateRange(months) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1);
  return { startDate: costcoDate(start), endDate: costcoDate(end) };
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function waitForCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await json(`http://127.0.0.1:${port}/json/version`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

function startBrave(port) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${BRAVE_PROFILE}`,
    ORDERS_URL,
  ];
  spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${BRAVE_EXE}' -ArgumentList ${args.map((a) => `'${a.replaceAll("'", "''")}'`).join(",")}`,
  ], { stdio: "ignore" });
}

async function getCostcoTarget(port) {
  const pages = await json(`http://127.0.0.1:${port}/json/list`);
  return pages.find((page) => page.type === "page" && /costco\.com/i.test(page.url))
    || pages.find((page) => page.type === "page");
}

async function openCostcoTarget(port) {
  try {
    return await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(ORDERS_URL)}`);
  } catch {
    const target = await getCostcoTarget(port);
    if (!target) throw new Error("No browser page is available through CDP.");
    return target;
  }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      listeners.forEach((listener) => listener(message));
      return;
    }
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = async (method, params = {}, timeoutMs = 30000) => {
    await ready;
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  };

  return {
    send,
    on: (listener) => listeners.push(listener),
    close: () => ws.close(),
  };
}

async function evaluate(page, expression, timeoutMs = 60000) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || "Runtime evaluation failed",
    );
  }
  return result.result.value;
}

async function waitForAccountPage(page) {
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  let status = await evaluate(page, `({ host: location.hostname, title: document.title })`);
  if (!/costco\.com$/i.test(status.host) || /signin/i.test(status.host)) {
    await page.send("Page.navigate", { url: ORDERS_URL });
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    status = await evaluate(page, `({ host: location.hostname, href: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 4000) })`);
    if (status.host === "www.costco.com" && (/ordersandpurchases/i.test(status.href) || /Orders|Purchases|Account/i.test(status.title + status.text))) return;
    if (/signin/i.test(status.host) || /Sign In/i.test(status.title + status.text)) {
      throw new Error("Costco sign-in is required in the managed Brave browser before the monitor can fetch receipts.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for the Costco Orders & Purchases page.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detailRowsFromPayload(payload) {
  return payload?.data?.receiptsWithCounts?.receipts || payload?.data?.receipts || [];
}

function rowFromReceipt(receipt) {
  const fuelItem = (receipt.itemArray || []).find((item) => Number(item.fuelUnitQuantity) > 0)
    || (receipt.itemArray || [])[0];
  if (!fuelItem || !Number(fuelItem.fuelUnitQuantity)) return null;
  const gallons = Number(fuelItem.fuelUnitQuantity);
  const total = Number(receipt.total || fuelItem.amount);
  const unitPrice = Number(fuelItem.itemUnitPriceAmount || (gallons ? total / gallons : 0));
  const grade = fuelItem.fuelGradeDescription || fuelItem.itemDescription01 || fuelItem.itemDescription02 || "Gas";
  const warehouse = receipt.warehouseName || "Costco";
  return {
    date: String(receipt.transactionDate || receipt.transactionDateTime || "").slice(0, 10),
    odometer: "",
    gallons: gallons.toFixed(3),
    cost: total.toFixed(2),
    notes: `Costco ${warehouse}; ${unitPrice.toFixed(3)}/gal; Costco receipt ${receipt.transactionBarcode}`,
    tags: `Costco ${grade.replace(/\s+/g, "")}`,
    partial_fuelup: "0",
    missed_fuelup: "0",
  };
}

async function clickWarehouseTab(page) {
  await evaluate(page, `(() => {
    const close = [...document.querySelectorAll('button,[role="button"]')]
      .find((node) => /close/i.test(node.getAttribute('aria-label') || node.innerText || ''));
    if (close) close.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const nodes = [...document.querySelectorAll('button,[role="tab"],[role="button"],a')];
    const warehouse = nodes.find((node) => /^Warehouse$/i.test((node.innerText || '').trim()));
    if (warehouse) warehouse.click();
    return Boolean(warehouse);
  })()`);
}

async function extractGasCards(page) {
  return evaluate(page, `(() => {
    const cards = [...document.querySelectorAll('div[id^="viewRecieptBtn_"]')];
    return cards.map((card) => {
      const lines = (card.innerText || '').split(/\\n+/).map((line) => line.trim()).filter(Boolean);
      const dateLine = lines.find((line) => /\\d{2}\\/\\d{2}\\/\\d{4}/.test(line)) || '';
      const totalIndex = lines.findIndex((line) => /^Total$/i.test(line));
      return {
        barcode: card.id.replace('viewRecieptBtn_', ''),
        text: card.innerText || '',
        type: lines[0] || '',
        dateLine,
        warehouseName: lines[lines.indexOf(dateLine) + 1] || '',
        totalText: totalIndex >= 0 ? lines[totalIndex + 1] || '' : '',
      };
    }).filter((card) => /Gas Station/i.test(card.type) && /^\\d+$/.test(card.barcode));
  })()`);
}

function installDetailCapture(page) {
  const requestPostById = new Map();
  const detailByBarcode = new Map();
  page.on(async (message) => {
    if (message.method === "Network.requestWillBeSent" && /orders\/graphql/i.test(message.params.request.url)) {
      requestPostById.set(message.params.requestId, message.params.request.postData || "");
    }
    if (message.method !== "Network.loadingFinished" || !requestPostById.has(message.params.requestId)) return;
    try {
      const body = await page.send("Network.getResponseBody", { requestId: message.params.requestId });
      const payload = JSON.parse(body.body);
      detailRowsFromPayload(payload).forEach((receipt) => {
        if (receipt?.transactionBarcode && receipt?.itemArray?.some((item) => Number(item.fuelUnitQuantity) > 0)) {
          detailByBarcode.set(String(receipt.transactionBarcode), receipt);
        }
      });
    } catch {
      // Costco occasionally emits non-JSON/blocked responses; ignore and keep waiting.
    } finally {
      requestPostById.delete(message.params.requestId);
    }
  });
  return detailByBarcode;
}

async function clickReceipt(page, barcode) {
  return evaluate(page, `(() => {
    const close = [...document.querySelectorAll('button,[role="button"]')]
      .find((node) => /close/i.test(node.getAttribute('aria-label') || node.innerText || ''));
    if (close) close.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const root = document.querySelector(${JSON.stringify(`#viewRecieptBtn_${barcode}`)});
    const button = root?.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function fetchRowsViaUi(page, startDate, endDate) {
  const detailByBarcode = installDetailCapture(page);
  await page.send("Network.enable", { maxPostDataSize: 200000 });
  await clickWarehouseTab(page);
  await sleep(8000);
  const cards = await extractGasCards(page);
  const rows = [];
  for (const card of cards) {
    if (!detailByBarcode.has(card.barcode)) {
      const clicked = await clickReceipt(page, card.barcode);
      if (!clicked) continue;
      const deadline = Date.now() + 15000;
      while (!detailByBarcode.has(card.barcode) && Date.now() < deadline) {
        await sleep(500);
      }
    }
    const row = rowFromReceipt(detailByBarcode.get(card.barcode));
    if (row) rows.push(row);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.notes.localeCompare(b.notes));
  return { ok: true, startDate, endDate, count: rows.length, rows };
}

async function main() {
  const args = parseArgs();
  const range = dateRange(args.months);
  const startDate = args.startDate || range.startDate;
  const endDate = args.endDate || range.endDate;

  if (!(await waitForCdp(args.port, 1000))) {
    if (!args.openBrowser) throw new Error(`No CDP browser is listening on port ${args.port}.`);
    startBrave(args.port);
    if (!(await waitForCdp(args.port))) throw new Error(`Brave did not start CDP on port ${args.port}.`);
  }

  let target = await getCostcoTarget(args.port);
  if (!target || !target.webSocketDebuggerUrl) target = await openCostcoTarget(args.port);
  const page = connect(target.webSocketDebuggerUrl);
  try {
    await waitForAccountPage(page);
    const result = await fetchRowsViaUi(page, startDate, endDate);
    if (!result.ok) throw new Error(`${result.error || "Costco fetch failed"} (HTTP ${result.status || "unknown"})`);
    const output = JSON.stringify(result, null, 2);
    if (args.output) fs.writeFileSync(args.output, `${output}\n`, "utf8");
    else console.log(output);
  } finally {
    page.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
