const STORAGE_KEY = "fatLossDashboard.v1";
const SETTINGS_KEY = "fatLossDashboard.settings.v1";
const BACKUP_KEY = "fatLossDashboard.backups.v1";
const MAX_BACKUPS = 1;
const todayISO = () => new Date().toISOString().slice(0, 10);

const defaultState = {
  settings: {
    maintenance: 2600,
    targetCalories: 2100,
    proteinGoal: 180,
    carbsGoal: 210,
    fatGoal: 65,
    weekStartsOn: 0,
    goalWeight: 78,
    goalWaist: 84,
    minProtein: 170,
    maxFat: 75,
    weeklyCardioGoal: 1800,
  },
  foods: [
    { id: crypto.randomUUID(), name: "صدر دجاج", category: "بروتين", calories: 165, protein: 31, carbs: 0, fat: 3.6, notes: "مطبوخ" },
    { id: crypto.randomUUID(), name: "رز أبيض", category: "كارب", calories: 130, protein: 2.7, carbs: 28, fat: 0.3, notes: "مطبوخ" },
    { id: crypto.randomUUID(), name: "بيض كامل", category: "بروتين", calories: 143, protein: 13, carbs: 1.1, fat: 10, notes: "" },
    { id: crypto.randomUUID(), name: "زبادي يوناني", category: "سناك", calories: 95, protein: 10, carbs: 4, fat: 4, notes: "" },
    { id: crypto.randomUUID(), name: "لوز", category: "دهون", calories: 579, protein: 21, carbs: 22, fat: 50, notes: "" },
  ],
  sauces: [
    { id: crypto.randomUUID(), name: "صوص البرياني", calories: 120, protein: 2, carbs: 9, fat: 8, ingredients: "لبن، بهارات، زيت", notes: "" },
    { id: crypto.randomUUID(), name: "صوص ثوم خفيف", calories: 160, protein: 1, carbs: 6, fat: 14, ingredients: "زبادي، ثوم، زيت زيتون", notes: "" },
  ],
  meals: [],
  foodLogs: [],
  cardioLogs: [],
  resistanceLogs: [],
  progressLogs: [],
  savedDays: [],
};

const stateCollections = ["foods", "sauces", "meals", "foodLogs", "cardioLogs", "resistanceLogs", "progressLogs", "savedDays"];

let state = loadState();
let activeDate = todayISO();
let editing = {};
let usdaSearchTimer = null;
let usdaResults = [];
let aiLastResponse = "";
let storageWarningShown = false;
let recoveryCandidates = [];
let activeDashboardInsight = "";

const views = [...document.querySelectorAll(".view")];
const activeDateInput = document.querySelector("#activeDate");
activeDateInput.value = activeDate;

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const savedSettings = loadSettingsOnly();
  if (!raw) return loadBundledRestore(savedSettings) || { ...structuredClone(defaultState), settings: savedSettings || normalizeSettings() };
  try {
    const parsed = JSON.parse(raw);
    const restored = maybeUseBundledRestore(parsed, savedSettings);
    if (restored) return restored;
    const base = structuredClone(defaultState);
    const mergedSettings = normalizeSettings(savedSettings ? { ...(parsed.settings || {}), ...savedSettings } : parsed.settings);
    const merged = { ...base, ...parsed, settings: mergedSettings };
    stateCollections.forEach((key) => {
      if (!Array.isArray(merged[key])) merged[key] = base[key];
    });
    if (!savedSettings) saveSettingsOnly(mergedSettings);
    return stripStoredPhotos(merged);
  } catch {
    return loadBundledRestore(savedSettings) || { ...structuredClone(defaultState), settings: savedSettings || normalizeSettings() };
  }
}

function loadBundledRestore(savedSettings = null) {
  const snapshot = window.HEALTHTRACKKER_BUNDLED_RESTORE?.state;
  if (!snapshot || meaningfulDataCount(snapshot) === 0) return null;
  const restored = normalizeImportedState(snapshot);
  restored.settings = normalizeSettings(savedSettings ? { ...restored.settings, ...savedSettings } : restored.settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    if (!savedSettings) saveSettingsOnly(restored.settings);
    sessionStorage.setItem("bundled-restore-applied", "1");
  } catch (error) {
    console.warn("Unable to persist bundled restore", error);
  }
  return restored;
}

function maybeUseBundledRestore(parsed, savedSettings = null) {
  const hasUserData = meaningfulDataCount(parsed) > 0;
  if (hasUserData) return null;
  return loadBundledRestore(savedSettings);
}

function saveState() {
  try {
    state = stripStoredPhotos(state);
    writeStateBackup(localStorage.getItem(STORAGE_KEY));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageWarningShown = false;
    return true;
  } catch (error) {
    console.warn("Unable to save local app data", error);
    try {
      state = stripStoredPhotos(state);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageWarningShown = false;
      return true;
    } catch (retryError) {
      console.warn("Unable to save compact local app data", retryError);
    }
    if (!storageWarningShown) {
      storageWarningShown = true;
      alert("تعذر حفظ البيانات محلياً. سأحاول إبقاء الإعدادات محفوظة بشكل مستقل.");
    }
    return false;
  }
}

function parseStoredState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const hasKnownCollection = stateCollections.some((key) => Array.isArray(parsed[key]));
    return hasKnownCollection ? parsed : null;
  } catch {
    return null;
  }
}

function meaningfulDataCount(snapshot) {
  if (!snapshot) return 0;
  return ["foodLogs", "cardioLogs", "resistanceLogs", "progressLogs", "savedDays", "meals"].reduce((sum, key) => sum + (Array.isArray(snapshot[key]) ? snapshot[key].length : 0), 0)
    + Math.max(0, (snapshot.foods?.length || 0) - defaultState.foods.length)
    + Math.max(0, (snapshot.sauces?.length || 0) - defaultState.sauces.length);
}

function snapshotSummary(snapshot) {
  return {
    foods: snapshot.foods?.length || 0,
    sauces: snapshot.sauces?.length || 0,
    meals: snapshot.meals?.length || 0,
    foodLogs: snapshot.foodLogs?.length || 0,
    cardioLogs: snapshot.cardioLogs?.length || 0,
    resistanceLogs: snapshot.resistanceLogs?.length || 0,
    progressLogs: snapshot.progressLogs?.length || 0,
    savedDays: snapshot.savedDays?.length || 0,
  };
}

function summaryText(summary) {
  return `${summary.foodLogs} وجبة · ${summary.cardioLogs} كارديو · ${summary.resistanceLogs || 0} مقاومة · ${summary.progressLogs} قياس · ${summary.meals} وجبات جاهزة · ${summary.foods} أطعمة`;
}

function writeStateBackup(raw) {
  const snapshot = parseStoredState(raw);
  if (!snapshot || meaningfulDataCount(snapshot) === 0) return;
  try {
    const backups = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]").filter((item) => item?.raw);
    if (backups[0]?.raw === raw) return;
    backups.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), raw, summary: snapshotSummary(snapshot) });
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(0, MAX_BACKUPS)));
  } catch (error) {
    console.warn("Unable to write local backup", error);
  }
}

function discoverRecoveryCandidates() {
  const candidates = [];
  const seen = new Set();
  function addCandidate(source, raw, createdAt = "") {
    const snapshot = parseStoredState(raw);
    if (!snapshot || meaningfulDataCount(snapshot) === 0 || seen.has(raw)) return;
    seen.add(raw);
    candidates.push({ source, raw, createdAt, snapshot, summary: snapshotSummary(snapshot) });
  }
  try {
    JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]").forEach((item) => addCandidate("نسخة احتياطية", item.raw, item.createdAt));
  } catch {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || key === BACKUP_KEY) continue;
    addCandidate(key, localStorage.getItem(key), "");
  }
  return candidates.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function mergeRecoveryCandidate(index) {
  const candidate = recoveryCandidates[Number(index)];
  if (!candidate) return;
  const next = structuredClone(state);
  next.settings = normalizeSettings({ ...candidate.snapshot.settings, ...next.settings });
  stateCollections.forEach((key) => {
    const existing = new Set((next[key] || []).map((item) => item.id));
    const incoming = Array.isArray(candidate.snapshot[key]) ? candidate.snapshot[key] : [];
    next[key] = [...(next[key] || []), ...incoming.filter((item) => {
      if (!item?.id) item.id = crypto.randomUUID();
      if (existing.has(item.id)) return false;
      existing.add(item.id);
      return true;
    })];
  });
  state = next;
  alert("تم دمج النسخة التي وجدتها داخل المتصفح. راجع صفحة اليوم والتقدم.");
}

function normalizeImportedState(snapshot) {
  const next = { ...snapshot, settings: normalizeSettings(snapshot?.settings) };
  stateCollections.forEach((key) => {
    const incoming = Array.isArray(snapshot?.[key]) ? snapshot[key] : [];
    next[key] = incoming.map((item) => {
      const entry = { ...item };
      if (!entry.id) entry.id = crypto.randomUUID();
      return entry;
    });
  });
  return stripStoredPhotos(next);
}

function replaceStateFromSnapshot(snapshot, source = "الملف") {
  const next = normalizeImportedState(snapshot);
  if (meaningfulDataCount(next) === 0) {
    alert("الملف لا يحتوي على بيانات كافية للاستبدال.");
    return;
  }
  const ok = confirm(`سيتم استبدال بيانات هذا المتصفح ببيانات ${source}. سيتم حفظ الوضع الحالي كنسخة أمان أولاً.`);
  if (!ok) return;
  writeStateBackup(localStorage.getItem(STORAGE_KEY));
  state = next;
  saveSettingsOnly(state.settings);
  saveState();
  recoveryCandidates = discoverRecoveryCandidates();
  alert("تم استبدال البيانات بنجاح. افتح الرئيسية أو اليوم للتأكد من الأرقام.");
  render();
}

function stripStoredPhotos(nextState) {
  return {
    ...nextState,
    bodyPhotos: [],
    progressLogs: Array.isArray(nextState.progressLogs)
      ? nextState.progressLogs.map(({ photo, ...entry }) => entry)
      : [],
  };
}

function loadSettingsOnly() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveSettingsOnly(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch (error) {
    console.warn("Unable to save settings separately", error);
    try {
      compactLocalStorage();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
      return true;
    } catch (retryError) {
      console.warn("Unable to save settings after compaction", retryError);
      return false;
    }
  }
}

function compactLocalStorage() {
  const compactState = stripStoredPhotos(state || structuredClone(defaultState));
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
  state = compactState;
}

function normalizeSettings(settings = {}) {
  return Object.fromEntries(
    Object.entries(defaultState.settings).map(([key, defaultValue]) => [key, finiteSetting(settings[key], defaultValue)])
  );
}

function finiteSetting(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function byDate(a, b) {
  return a.date.localeCompare(b.date);
}

function getWeekStart(dateISO = activeDate) {
  const date = new Date(`${dateISO}T12:00:00`);
  const day = date.getDay();
  const target = Number(state.settings.weekStartsOn);
  const diff = (day - target + 7) % 7;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

function getWeekDates(dateISO = activeDate) {
  const start = new Date(`${getWeekStart(dateISO)}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

function macroFromItem(item, grams) {
  const factor = Number(grams || 0) / 100;
  return {
    calories: (Number(item?.calories) || 0) * factor,
    protein: (Number(item?.protein) || 0) * factor,
    carbs: (Number(item?.carbs) || 0) * factor,
    fat: (Number(item?.fat) || 0) * factor,
  };
}

function addMacros(items) {
  return items.reduce((sum, item) => ({
    calories: sum.calories + (Number(item.calories) || 0),
    protein: sum.protein + (Number(item.protein) || 0),
    carbs: sum.carbs + (Number(item.carbs) || 0),
    fat: sum.fat + (Number(item.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function mealMacros(meal, grams = 100) {
  const base = addMacros((meal.components || []).map((component) => {
    const source = component.type === "sauce"
      ? state.sauces.find((item) => item.id === component.itemId)
      : state.foods.find((item) => item.id === component.itemId);
    return macroFromItem(source, component.grams);
  }));
  const totalGrams = (meal.components || []).reduce((sum, item) => sum + Number(item.grams || 0), 0) || 100;
  const factor = Number(grams || 0) / totalGrams;
  return {
    calories: base.calories * factor,
    protein: base.protein * factor,
    carbs: base.carbs * factor,
    fat: base.fat * factor,
  };
}

function entryMacros(entry) {
  const source = entry.sourceType === "meal"
    ? state.meals.find((item) => item.id === entry.itemId)
    : state.foods.find((item) => item.id === entry.itemId);
  const main = entry.sourceType === "meal" ? mealMacros(source, entry.grams) : macroFromItem(source, entry.grams);
  const sauce = state.sauces.find((item) => item.id === entry.sauceId);
  return addMacros([main, macroFromItem(sauce, entry.sauceGrams)]);
}

function dayFood(dateISO = activeDate) {
  const entries = state.foodLogs.filter((entry) => entry.date === dateISO);
  return addMacros(entries.map(entryMacros));
}

function dayCardio(dateISO = activeDate) {
  return state.cardioLogs
    .filter((entry) => entry.date === dateISO)
    .reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
}

function dayResistance(dateISO = activeDate) {
  return state.resistanceLogs?.find((entry) => entry.date === dateISO && entry.done) || null;
}

function resistanceSessionsThisWeek() {
  const dates = getWeekDates();
  return (state.resistanceLogs || []).filter((entry) => entry.done && dates.includes(entry.date)).length;
}

function dayDeficit(dateISO = activeDate) {
  return state.settings.maintenance - dayFood(dateISO).calories + dayCardio(dateISO);
}

function weekStats(dateISO = activeDate) {
  const dates = getWeekDates(dateISO);
  const actualCalories = dates.reduce((sum, date) => sum + dayFood(date).calories, 0);
  const cardio = dates.reduce((sum, date) => sum + dayCardio(date), 0);
  const deficit = dates.reduce((sum, date) => sum + dayDeficit(date), 0);
  return { dates, actualCalories, cardio, deficit };
}

function weekCardioProgress(dateISO = activeDate) {
  const week = weekStats(dateISO);
  const goal = Math.max(0, Number(state.settings.weeklyCardioGoal) || 0);
  const remaining = Math.max(0, goal - week.cardio);
  const extra = Math.max(0, week.cardio - goal);
  return {
    ...week,
    goal,
    remaining,
    extra,
    start: week.dates[0],
    end: week.dates[6],
  };
}

function compliance(actual, target, inverse = false) {
  if (!target) return 0;
  const ratio = inverse ? target / Math.max(actual, 1) : actual / target;
  return Math.max(0, Math.min(120, ratio * 100));
}

function statusClass({ calories, protein, fat }) {
  const over = calories > state.settings.targetCalories;
  const lowProtein = protein < state.settings.minProtein;
  const highFat = fat > state.settings.maxFat;
  if (over || lowProtein || highFat) return "bad";
  if (state.settings.targetCalories - calories < 180 || protein < state.settings.proteinGoal) return "warn";
  return "good";
}

function render() {
  renderDashboard();
  renderFoodLog();
  renderAdd();
  renderProgress();
  renderSettings();
  renderAICoach();
  hydrateIcons();
  hydrateQuickAdd();
  saveState();
}

function setView(id) {
  views.forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
  render();
}

function openQuickAdd() {
  hydrateQuickAdd();
  document.body.classList.add("sheet-open");
}

function closeQuickAdd() {
  document.body.classList.remove("sheet-open");
}

function hydrateQuickAdd() {
  const form = document.querySelector("#quickFoodForm");
  if (!form) return;
  const source = form.querySelector("#quickSource");
  const sauce = form.querySelector("#quickSauce");
  if (source && !source.dataset.ready) {
    source.innerHTML = sourceOptions();
    source.dataset.ready = "true";
  }
  if (sauce && !sauce.dataset.ready) {
    sauce.innerHTML = sauceOptions();
    sauce.dataset.ready = "true";
  }
  form.removeEventListener("input", updateQuickPreview);
  form.removeEventListener("submit", saveQuickFood);
  form.addEventListener("input", updateQuickPreview);
  form.addEventListener("submit", saveQuickFood);
  updateQuickPreview();
}

function updateQuickPreview() {
  const form = document.querySelector("#quickFoodForm");
  const preview = document.querySelector("#quickPreview");
  if (!form || !preview) return;
  const data = Object.fromEntries(new FormData(form));
  if (!data.source) {
    preview.innerHTML = `<strong>اختر وجبة</strong><span>السعرات تظهر هنا فوراً</span>`;
    return;
  }
  const [sourceType, itemId] = data.source.split(":");
  const macros = entryMacros({ sourceType, itemId, grams: data.grams, sauceId: data.sauceId, sauceGrams: data.sauceGrams });
  preview.innerHTML = `<strong>${formatNumber(macros.calories)} سعرة</strong><span>${formatNumber(macros.protein)}g بروتين · ${formatNumber(macros.carbs)}g كارب · ${formatNumber(macros.fat)}g دهون</span>`;
}

function saveQuickFood(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.source) return;
  const [sourceType, itemId] = data.source.split(":");
  state.foodLogs.push({
    id: crypto.randomUUID(),
    date: activeDate,
    slot: "وجبة إضافية",
    sourceType,
    itemId,
    grams: Number(data.grams),
    sauceId: data.sauceId,
    sauceGrams: Number(data.sauceGrams),
    notes: "إضافة سريعة",
  });
  closeQuickAdd();
  render();
}

function metric(label, value, note = "") {
  return `<article class="metric-card"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><small class="metric-note">${note}</small></article>`;
}

function icon(name) {
  const paths = {
    home: `<path d="m3 10 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>`,
    utensils: `<path d="M4 3v8"/><path d="M8 3v8"/><path d="M4 7h4"/><path d="M6 11v10"/><path d="M17 3c2 2 3 5 3 8 0 3-1 5-3 6v4"/>`,
    plus: `<path d="M12 5v14"/><path d="M5 12h14"/>`,
    trending: `<path d="m3 17 6-6 4 4 7-8"/><path d="M14 7h6v6"/>`,
    more: `<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>`,
    protein: `<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10l-1 9a4 4 0 0 1-8 0Z"/>`,
    carbs: `<path d="M12 2v20"/><path d="M5 8c5 0 7-3 7-6"/><path d="M19 8c-5 0-7-3-7-6"/><path d="M5 16c5 0 7 3 7 6"/><path d="M19 16c-5 0-7 3-7 6"/>`,
    fat: `<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12Z"/>`,
    cardio: `<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/><path d="M3 12h4l2-3 3 6 2-3h7"/>`,
    scale: `<path d="M7 20h10"/><path d="M6 20 12 4l6 16"/><path d="M8 9h8"/>`,
    waist: `<path d="M8 3c1 4 1 7-1 10"/><path d="M16 3c-1 4-1 7 1 10"/><path d="M7 13c2 2 8 2 10 0"/><path d="M7 17c3 2 7 2 10 0"/>`,
    database: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>`,
    chef: `<path d="M6 13h12v7H6z"/><path d="M6 13c-2-1-2-5 1-6 1-4 7-4 8 0 3 1 3 5 1 6"/><path d="M9 17h6"/>`,
    coach: `<path d="M12 3a7 7 0 0 0-7 7v3a4 4 0 0 0 4 4h1"/><path d="M19 13v-3a7 7 0 0 0-7-7"/><path d="M15 17h1a4 4 0 0 0 4-4"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M10 14c1.2 1 2.8 1 4 0"/><path d="M12 17v4"/><path d="M9 21h6"/>`,
    flame: `<path d="M12 22c4 0 7-2.8 7-6.8 0-3.3-2-5.1-4-7.2-.8 2.2-2.1 3.4-3.8 4.3.3-3.2-1.2-5.8-3.8-8.3.2 4.5-3.4 6.7-3.4 11.2C4 19.2 8 22 12 22Z"/>`,
    target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/><path d="M22 12h-3"/><path d="M5 12H2"/><path d="M12 2v3"/><path d="M12 19v3"/>`,
    spark: `<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>`,
    camera: `<path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3Z"/><circle cx="12" cy="13" r="3"/>`,
    settings: `<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .4 1.8 1.8 0 0 0-.5 1.2H9a1.8 1.8 0 0 0-.5-1.2 1.8 1.8 0 0 0-2-.4l-.2.1-2-3.4.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.5-1V10a1.8 1.8 0 0 0 1.5-1 1.8 1.8 0 0 0-.4-2l-.1-.1 2-3.4.2.1a1.8 1.8 0 0 0 2-.4A1.8 1.8 0 0 0 9 2h6a1.8 1.8 0 0 0 .5 1.2 1.8 1.8 0 0 0 2 .4l.2-.1 2 3.4-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.5 1v4a1.8 1.8 0 0 0-1.3 1Z"/>`,
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.more}</svg>`;
}

function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}

function percent(actual, goal) {
  return Math.max(0, Math.min(100, goal ? (Number(actual || 0) / Number(goal)) * 100 : 0));
}

function signed(value, digits = 1) {
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${formatNumber(value, digits)}`;
}

function dashboardStatus(food) {
  if (food.calories === 0) return { type: "info", label: "ابدأ اليوم", text: "سجل أول وجبة بروتين عالي، بعدها يتضح مسار اليوم.", headline: "جاهز للبداية" };
  if (food.calories > state.settings.targetCalories) return { type: "bad", label: "تحتاج ضبط", text: "خفف الوجبة القادمة أو أضف كارديو حتى ترجع ضمن الخطة.", headline: "راجع السعرات" };
  if (food.protein < state.settings.minProtein && food.calories > state.settings.targetCalories * 0.55) return { type: "warn", label: "ادعم البروتين", text: "السعرات جيدة، لكن البروتين يحتاج دفعة قبل نهاية اليوم.", headline: "بروتين ناقص" };
  if (state.settings.targetCalories - food.calories < 180) return { type: "warn", label: "قريب من الهدف", text: "أنت قريب جداً. اجعل آخر اختيار صغير وواضح.", headline: "امش بحذر" };
  return { type: "good", label: "ممتاز", text: "السعرات تحت السيطرة والبروتين قريب من الخطة.", headline: "يوم متوازن" };
}

function dailyDecision(food, cardioWeek) {
  const remainingCalories = state.settings.targetCalories - food.calories;
  const proteinLeft = Math.max(0, state.settings.proteinGoal - food.protein);
  const minProteinLeft = Math.max(0, state.settings.minProtein - food.protein);
  const cardioLeft = cardioWeek.remaining;
  if (food.calories === 0) {
    return {
      tone: "info",
      title: "ابدأ بوجبة بروتين واضحة",
      text: `هدف اليوم ${formatNumber(state.settings.targetCalories)} سعرة. الأفضل تبدأ بـ ${formatNumber(Math.min(60, state.settings.proteinGoal / 3))}g بروتين حتى لا تتراكم عليك آخر اليوم.`,
      primary: "سجل أول وجبة",
      secondary: "أضف كارديو",
    };
  }
  if (remainingCalories < 0) {
    return {
      tone: "bad",
      title: `زائد ${formatNumber(Math.abs(remainingCalories))} سعرة`,
      text: `عالجها بكارديو أو خفف الوجبة القادمة. البروتين المتبقي ${formatNumber(proteinLeft)}g.`,
      primary: "افتح تفاصيل السعرات",
      secondary: "سجل كارديو",
    };
  }
  if (minProteinLeft > 0) {
    return {
      tone: "warn",
      title: `ناقصك ${formatNumber(minProteinLeft)}g بروتين`,
      text: `عندك ${formatNumber(remainingCalories)} سعرة متاحة. اختر بروتين عالي قبل إضافة كارب أو دهون.`,
      primary: "أضف وجبة بروتين",
      secondary: "تفاصيل البروتين",
    };
  }
  if (cardioLeft > 0 && food.calories > state.settings.targetCalories * 0.75) {
    return {
      tone: "info",
      title: `باقي ${formatNumber(cardioLeft)} سعرة كارديو هذا الأسبوع`,
      text: `خلصت ${formatNumber(cardioWeek.cardio)} من هدف ${formatNumber(cardioWeek.goal)}. جلسة قصيرة تثبت العجز الأسبوعي.`,
      primary: "سجل كارديو",
      secondary: "راجع الأسبوع",
    };
  }
  return {
    tone: "good",
    title: "اليوم تحت السيطرة",
    text: `متبقي ${formatNumber(remainingCalories)} سعرة. حافظ على الاختيارات النظيفة لباقي اليوم.`,
    primary: "أضف وجبة",
    secondary: "راجع الالتزام",
  };
}

function progressBar(value, className = "") {
  return `<div class="progress-track"><div class="progress-fill ${className}" style="--value:${Math.round(value)}%"></div></div>`;
}

function ring(value) {
  return `
    <svg class="ring" style="--ring:${Math.round(value)}" viewBox="0 0 82 82" aria-hidden="true">
      <circle class="ring-bg" cx="41" cy="41" r="35"></circle>
      <circle class="ring-value" cx="41" cy="41" r="35"></circle>
    </svg>
  `;
}

function renderDashboard() {
  const food = dayFood();
  const cardioWeek = weekCardioProgress();
  const dailyDeficit = dayDeficit();
  const remaining = state.settings.targetCalories - food.calories;
  const status = dashboardStatus(food);
  const decision = dailyDecision(food, cardioWeek);
  const calorieProgress = percent(food.calories, state.settings.targetCalories);
  const latest = latestProgressDelta();
  const scores = dailyScores();
  const coach = coachMessage();
  const streak = adherenceStreak();
  const proteinLeft = Math.max(0, state.settings.proteinGoal - food.protein);
  const fatRoom = Math.max(0, state.settings.maxFat - food.fat);
  const cardioGoal = Math.max(cardioWeek.goal, 1);
  const cardioFoot = cardioWeek.remaining > 0
    ? `باقي ${formatNumber(cardioWeek.remaining)} هذا الأسبوع`
    : `مكتمل${cardioWeek.extra ? ` +${formatNumber(cardioWeek.extra)}` : ""}`;
  const resistance = dayResistance();

  document.querySelector("#dashboard").innerHTML = `
    <section class="daily-command ${decision.tone}">
      <div class="command-copy">
        <span class="hero-label">قرار اليوم</span>
        <h2>${decision.title}</h2>
        <p>${decision.text}</p>
      </div>
      <div class="command-actions">
        <button class="command-button" type="button" data-view="food-log">${decision.primary}</button>
        <button class="command-button secondary" type="button" data-action="${decision.secondary.includes("كارديو") ? "focus-cardio" : "show-insight"}" data-insight="${decision.secondary.includes("البروتين") ? "protein" : "consistency"}">${decision.secondary}</button>
      </div>
      <div class="command-stats">
        <span><strong>${formatNumber(Math.max(0, remaining))}</strong> سعرة متاحة</span>
        <span><strong>${formatNumber(proteinLeft)}</strong>g بروتين باقي</span>
        <span><strong>${resistance ? "نعم" : "لا"}</strong> مقاومة اليوم</span>
      </div>
    </section>

    <div class="dashboard-layout">
      <button class="hero-card insight-trigger" type="button" data-action="show-insight" data-insight="calories">
        <div class="energy-glow"></div>
        <div class="hero-top">
          <div>
            <span class="hero-label">استهلاك اليوم</span>
            <span class="status-badge ${status.type}">${status.label}</span>
          </div>
          <div class="hero-ring-wrap">
            ${ring(calorieProgress)}
            <strong>${formatNumber(calorieProgress)}%</strong>
          </div>
        </div>
        <h2 class="hero-motivation">${status.headline}</h2>
        <div class="hero-value">
          <strong>${formatNumber(food.calories)}</strong>
          <span>/ ${formatNumber(state.settings.targetCalories)}</span>
        </div>
        <div class="hero-bar"><div class="hero-fill" style="--value:${Math.round(calorieProgress)}%"></div></div>
        <p class="compact-note">${status.text}</p>
        <div class="hero-meta">
          <div><small>تبقى</small><strong>${formatNumber(remaining)} سعرة</strong></div>
          <div><small>العجز اليوم</small><strong>${formatNumber(dailyDeficit)}</strong></div>
        </div>
        <span class="tap-hint">اضغط للتفاصيل</span>
      </button>

      <section class="macro-grid" aria-label="الماكروز">
        ${macroCard("protein", "البروتين", food.protein, state.settings.proteinGoal, "g", "protein", `باقي ${formatNumber(proteinLeft)}g`)}
        ${macroCard("carbs", "الكارب", food.carbs, state.settings.carbsGoal, "g", "carbs", `هدف ${formatNumber(state.settings.carbsGoal)}g`)}
        ${macroCard("fat", "الدهون", food.fat, state.settings.fatGoal, "g", "fat", `متاح ${formatNumber(fatRoom)}g`)}
        ${macroCard("cardio", "كارديو الأسبوع", cardioWeek.cardio, cardioGoal, "سعرة", "cardio", cardioFoot)}
      </section>
    </div>
    ${activeDashboardInsight ? renderComplianceInsight(activeDashboardInsight) : ""}

    <section class="coach-card">
      <div class="coach-avatar">${icon("coach")}</div>
      <div>
        <span class="hero-label">Coach</span>
        <h3>${coach.title}</h3>
        <p>${coach.text}</p>
      </div>
    </section>

    <section class="score-strip">
      ${scoreCard("السلسلة", `${streak} يوم`, "flame", "orange", "consistency")}
      ${scoreCard("التغذية", `${scores.nutrition}%`, "target", "blue", "nutrition")}
      ${scoreCard("الالتزام", `${scores.consistency}%`, "spark", "purple", "consistency")}
    </section>

    <div class="section-title"><h2>التقدم</h2><span class="pill info">آخر قياس</span></div>
    <section class="progress-section">
      ${progressMini("scale", "الوزن الحالي", latest.weight, "كجم", latest.weightDelta, true)}
      ${progressMini("waist", "الخصر الحالي", latest.waist, "سم", latest.waistDelta, true)}
    </section>

    ${renderWeeklySummary()}

    <div class="section-title"><h2>الرسوم السريعة</h2><span class="pill">آخر 7 أيام</span></div>
    <section class="chart-row">
      <article class="chart-card"><h3>العجز</h3><canvas class="chart" id="deficitChart"></canvas></article>
      <article class="chart-card"><h3>الكارديو</h3><canvas class="chart" id="cardioChart"></canvas></article>
    </section>
  `;
  drawDashboardCharts();
}

function macroCard(iconName, label, actual, goal, unit, className, footNote = "") {
  const value = percent(actual, goal);
  return `
    <button class="macro-card insight-trigger" type="button" data-action="show-insight" data-insight="${className}">
      <div class="macro-head">
        <span class="icon-bubble" style="--icon-color:${className === "protein" ? "#34d399" : className === "carbs" ? "#60a5fa" : className === "fat" ? "#a78bfa" : "#f59e0b"}">${icon(iconName)}</span>
        <span class="pill">${formatNumber(value)}%</span>
      </div>
      <span class="metric-label">${label}</span>
      <p class="macro-value">${formatNumber(actual)} <span>/ ${formatNumber(goal)} ${unit}</span></p>
      ${progressBar(value, className)}
      <div class="macro-foot"><span>${footNote || "الهدف"}</span><span>اضغط</span></div>
    </button>
  `;
}

function latestProgressDelta() {
  const logs = [...state.progressLogs].sort(byDate);
  const latest = logs.at(-1);
  const previous = logs.length > 1 ? logs.at(-2) : null;
  return {
    weight: latest?.weight || 0,
    waist: latest?.waist || 0,
    weightDelta: latest && previous ? latest.weight - previous.weight : 0,
    waistDelta: latest && previous ? latest.waist - previous.waist : 0,
  };
}

function progressMini(iconName, label, value, unit, delta, lowerIsGood = false) {
  const isGood = lowerIsGood ? delta <= 0 : delta >= 0;
  const direction = delta <= 0 ? "down" : "up";
  return `
    <article class="mini-card">
      <span class="icon-bubble" style="--icon-color:${iconName === "scale" ? "#60a5fa" : "#34d399"}">${icon(iconName)}</span>
      <small>${label}</small>
      <strong>${value ? formatNumber(value, 1) : "--"} ${unit}</strong>
      <span class="trend ${direction} ${isGood ? "good" : "bad"}">${delta <= 0 ? "↓" : "↑"} ${signed(delta, 1)}</span>
    </article>
  `;
}

function scoreCard(label, value, iconName, tone, insight = "consistency") {
  return `
    <button class="score-card ${tone} insight-trigger" type="button" data-action="show-insight" data-insight="${insight}">
      <span class="icon-bubble">${icon(iconName)}</span>
      <small>${label}</small>
      <strong>${value}</strong>
    </button>
  `;
}

function dailyScores(dateISO = activeDate) {
  const food = dayFood(dateISO);
  const calorieScore = food.calories
    ? Math.max(0, 100 - Math.abs(food.calories - state.settings.targetCalories) / state.settings.targetCalories * 100)
    : 0;
  const proteinScore = percent(food.protein, state.settings.proteinGoal);
  const fatPenalty = food.fat > state.settings.maxFat ? Math.min(30, (food.fat - state.settings.maxFat) * 1.2) : 0;
  const nutrition = Math.round(Math.max(0, Math.min(100, (calorieScore * 0.45) + (proteinScore * 0.45) + 10 - fatPenalty)));
  const weekDates = getWeekDates(dateISO);
  const loggedDays = weekDates.filter((date) => dayFood(date).calories > 0).length;
  const consistency = Math.round((loggedDays / 7) * 100);
  return { nutrition, consistency };
}

function adherenceStreak() {
  let streak = 0;
  const cursor = new Date(`${activeDate}T12:00:00`);
  for (let index = 0; index < 90; index += 1) {
    const date = cursor.toISOString().slice(0, 10);
    const food = dayFood(date);
    if (food.calories > 0 && food.calories <= state.settings.targetCalories && food.protein >= state.settings.minProtein) streak += 1;
    else if (index === 0 && food.calories === 0) {}
    else break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function coachMessage() {
  const food = dayFood();
  const logs = [...state.progressLogs].sort(byDate);
  const latest = logs.at(-1);
  const previous = logs.at(-2);
  if (food.calories === 0) {
    return { title: "ابدأ بقوة", text: "سجل أول وجبة. الأفضل اليوم: بروتين عالي وسعرات واضحة من البداية." };
  }
  if (food.protein < state.settings.minProtein) {
    return { title: "ارفع البروتين", text: `أضف تقريباً ${formatNumber(state.settings.minProtein - food.protein)}g بروتين قبل نهاية اليوم.` };
  }
  if (food.fat > state.settings.maxFat) {
    return { title: "الدهون مرتفعة", text: "اختياراتك القادمة تكون بروتين وكارب نظيف، بدون صوصات دسمة." };
  }
  if (latest && previous && latest.weight > previous.weight && latest.waist < previous.waist) {
    return { title: "تقدم ذكي", text: "الوزن ارتفع قليلاً لكن الخصر ينخفض. هذا غالباً احتباس ماء وليس تراجعاً." };
  }
  return { title: "على المسار", text: "البروتين جيد، السعرات تحت السيطرة، والعجز اليومي يدعم هدف خسارة الدهون." };
}

function drawDashboardCharts() {
  const dates = getWeekDates();
  drawChart("deficitChart", dates.map((date) => ({ label: date.slice(5), value: dayDeficit(date) })), "#34d399");
  drawChart("cardioChart", dates.map((date) => ({ label: date.slice(5), value: dayCardio(date) })), "#f59e0b");
}

function adherenceDays() {
  return getWeekDates().filter((date) => {
    const food = dayFood(date);
    return food.calories > 0 && food.calories <= state.settings.targetCalories && food.protein >= state.settings.minProtein;
  }).length;
}

function cardioSessionsThisWeek() {
  const dates = getWeekDates();
  return state.cardioLogs.filter((entry) => dates.includes(entry.date)).length;
}

function weekProteinAverage() {
  const dates = getWeekDates();
  return dates.reduce((sum, date) => sum + dayFood(date).protein, 0) / 7;
}

function weeklyMini(label, value, note = "", insight = "") {
  const attrs = insight ? `type="button" data-action="show-insight" data-insight="${insight}"` : "";
  const tag = insight ? "button" : "article";
  return `<${tag} class="mini-card ${insight ? "insight-trigger" : ""}" ${attrs}><small>${label}</small><strong>${value}</strong><span class="compact-note">${note}</span></${tag}>`;
}

function renderWeeklySummary() {
  const week = weekStats();
  const cardioWeek = weekCardioProgress();
  const averageCalories = week.actualCalories / 7;
  const cardioNote = cardioWeek.remaining > 0
    ? `${cardioSessionsThisWeek()} جلسات · باقي ${formatNumber(cardioWeek.remaining)}`
    : `${cardioSessionsThisWeek()} جلسات · مكتمل`;
  return `
    <div class="section-title"><h2>ملخص الأسبوع</h2><span class="pill good">${formatNumber(week.deficit)} عجز</span></div>
    <section class="weekly-strip">
      ${weeklyMini("العجز الأسبوعي", formatNumber(week.deficit), "سعرة", "calories")}
      ${weeklyMini("متوسط السعرات", formatNumber(averageCalories), "يومياً", "calories")}
      ${weeklyMini("أيام الالتزام", `${adherenceDays()} / 7`, "اضغط للتفاصيل", "consistency")}
      ${weeklyMini("كارديو الأسبوع", `${formatNumber(cardioWeek.cardio)} / ${formatNumber(cardioWeek.goal)}`, cardioNote, "cardio")}
      ${weeklyMini("تمارين المقاومة", resistanceSessionsThisWeek(), "هذا الأسبوع", "consistency")}
      ${weeklyMini("متوسط البروتين", `${formatNumber(weekProteinAverage())} g`, "يومياً", "protein")}
    </section>
  `;
}

function dayLabel(dateISO) {
  return new Date(`${dateISO}T12:00:00`).toLocaleDateString("ar-SA", { weekday: "long", month: "short", day: "numeric" });
}

function dayInsight(dateISO) {
  const food = dayFood(dateISO);
  const cardio = dayCardio(dateISO);
  const logged = food.calories > 0 || cardio > 0;
  const calorieDelta = state.settings.targetCalories - food.calories;
  const proteinDelta = food.protein - state.settings.minProtein;
  const fatDelta = state.settings.maxFat - food.fat;
  const ok = logged && calorieDelta >= 0 && proteinDelta >= 0 && fatDelta >= 0;
  const issues = [];
  if (!logged) issues.push("غير مسجل");
  if (logged && calorieDelta < 0) issues.push(`زيادة سعرات ${formatNumber(Math.abs(calorieDelta))}`);
  if (logged && proteinDelta < 0) issues.push(`نقص بروتين ${formatNumber(Math.abs(proteinDelta))}g`);
  if (logged && fatDelta < 0) issues.push(`دهون زائدة ${formatNumber(Math.abs(fatDelta))}g`);
  if (logged && ok) issues.push("ملتزم");
  return { dateISO, food, cardio, logged, ok, calorieDelta, proteinDelta, fatDelta, issues };
}

function insightVerdict(type, balances, rows) {
  const missedDays = rows.filter((row) => !row.logged).length;
  const badDays = rows.filter((row) => row.logged && !row.ok).length;
  const cardioWeek = weekCardioProgress();
  const maps = {
    calories: {
      title: balances.calorieBalance >= 0 ? "السعرات تحت السيطرة" : `تحتاج تعويض ${formatNumber(Math.abs(balances.calorieBalance))} سعرة`,
      text: balances.calorieBalance >= 0
        ? "عندك مساحة أسبوعية. استخدمها بذكاء ولا تحولها لوجبة مفتوحة."
        : `قسم التعويض على الأيام المتبقية: ${formatNumber(Math.abs(balances.calorieBalance) / balances.remainingDays)} سعرة يومياً أو كارديو.`,
      action: "افتح اليوم وعدل الوجبة الأقرب.",
    },
    protein: {
      title: balances.proteinBalance >= 0 ? "البروتين جيد أسبوعياً" : `ناقصك ${formatNumber(Math.abs(balances.proteinBalance))}g بروتين`,
      text: balances.proteinBalance >= 0
        ? "استمر بنفس توزيع البروتين، ولا تتركه يتجمع في آخر اليوم."
        : `عوضه بمتوسط ${formatNumber(Math.abs(balances.proteinBalance) / balances.remainingDays)}g بروتين في الأيام المتبقية.`,
      action: "اختر وجبة بروتين عالية قبل الكارب.",
    },
    fat: {
      title: balances.fatBalance >= 0 ? "الدهون ضمن الحد" : `الدهون زائدة ${formatNumber(Math.abs(balances.fatBalance))}g`,
      text: balances.fatBalance >= 0
        ? "عندك مساحة للدهون، لكن الأفضل تتركها للطعام الأساسي لا للصوص."
        : "خفف الصوص والزيوت والمكسرات حتى يرجع الأسبوع للحد.",
      action: "اجعل الوجبة القادمة بروتين وكارب خفيف.",
    },
    cardio: {
      title: cardioWeek.remaining > 0 ? `باقي ${formatNumber(cardioWeek.remaining)} سعرة كارديو` : "هدف الكارديو الأسبوعي مكتمل",
      text: `الأسبوع الحالي من ${dayLabel(cardioWeek.start)} إلى ${dayLabel(cardioWeek.end)}. أنجزت ${formatNumber(cardioWeek.cardio)} من ${formatNumber(cardioWeek.goal)} سعرة.`,
      action: cardioWeek.remaining > 0 ? "سجل جلسة كارديو قبل نهاية الأسبوع." : "حافظ على نفس الإيقاع للأسبوع القادم.",
    },
    nutrition: {
      title: badDays ? `${badDays} أيام تحتاج مراجعة` : "تغذيتك مرتبة",
      text: badDays ? "الأيام غير الملتزمة غالباً بسبب بروتين ناقص أو دهون/سعرات أعلى من الخطة." : "استمر، ركز فقط على تكرار نفس السلوك.",
      action: "افتح الأيام الملونة وعدلها من نفس اللوحة.",
    },
    consistency: {
      title: missedDays ? `${missedDays} أيام غير مسجلة` : "كل أيام الأسبوع واضحة",
      text: missedDays ? "المشكلة ليست دائماً في الأكل؛ أحياناً عدم التسجيل يخفي السبب." : "عندك صورة أسبوعية كافية لاتخاذ قرار تعويض ذكي.",
      action: "افتح الأيام الناقصة وسجل الحد الأدنى.",
    },
  };
  return maps[type] || maps.consistency;
}

function renderComplianceInsight(type = "consistency") {
  const dates = getWeekDates();
  const cardioWeek = weekCardioProgress();
  const rows = dates.map(dayInsight);
  const loggedRows = rows.filter((row) => row.logged);
  const calorieBalance = loggedRows.reduce((sum, row) => sum + row.calorieDelta, 0);
  const proteinBalance = loggedRows.reduce((sum, row) => sum + row.proteinDelta, 0);
  const fatBalance = loggedRows.reduce((sum, row) => sum + row.fatDelta, 0);
  const remainingDays = Math.max(1, rows.filter((row) => row.dateISO >= activeDate).length);
  const verdict = insightVerdict(type, { calorieBalance, proteinBalance, fatBalance, remainingDays }, rows);
  const titleMap = {
    calories: "تفاصيل السعرات والالتزام",
    protein: "تفاصيل البروتين والتعويض",
    carbs: "تفاصيل الكارب",
    fat: "تفاصيل الدهون",
    cardio: "تفاصيل الكارديو",
    nutrition: "تفاصيل التغذية",
    consistency: "تفاصيل أيام الالتزام",
  };
  const proteinAdvice = proteinBalance >= 0
    ? `بروتين الأسبوع المسجل زائد ${formatNumber(proteinBalance)}g عن الحد الأدنى.`
    : `نقص البروتين المسجل ${formatNumber(Math.abs(proteinBalance))}g، عوضه بمتوسط ${formatNumber(Math.abs(proteinBalance) / remainingDays)}g في الأيام المتبقية.`;
  const calorieAdvice = calorieBalance >= 0
    ? `عندك مساحة ${formatNumber(calorieBalance)} سعرة ضمن الأيام المسجلة.`
    : `عندك زيادة ${formatNumber(Math.abs(calorieBalance))} سعرة؛ عوضها بتقليل ${formatNumber(Math.abs(calorieBalance) / remainingDays)} سعرة يومياً أو كارديو.`;
  const fatAdvice = fatBalance >= 0
    ? `الدهون ضمن الحد في الأيام المسجلة.`
    : `الدهون زادت ${formatNumber(Math.abs(fatBalance))}g؛ خل وجباتك القادمة أخف صوص وزيوت.`;
  const cardioAdvice = cardioWeek.remaining > 0
    ? `باقي ${formatNumber(cardioWeek.remaining)} سعرة حتى هدف ${formatNumber(cardioWeek.goal)}.`
    : `مكتمل${cardioWeek.extra ? ` وزيادة ${formatNumber(cardioWeek.extra)}` : ""}.`;
  return `
    <section class="panel insight-panel" id="dashboardInsight">
      <div class="split-title">
        <h2>${titleMap[type] || "تفاصيل الالتزام"}</h2>
        <button class="btn icon secondary" type="button" data-action="close-insight" title="إغلاق">×</button>
      </div>
      <div class="insight-command ${type}">
        <span class="hero-label">الخلاصة</span>
        <h3>${verdict.title}</h3>
        <p>${verdict.text}</p>
        <strong>${verdict.action}</strong>
      </div>
      <div class="insight-summary">
        ${metric("ميزان السعرات", `${calorieBalance >= 0 ? "+" : ""}${formatNumber(calorieBalance)}`, calorieAdvice)}
        ${metric("ميزان البروتين", `${proteinBalance >= 0 ? "+" : ""}${formatNumber(proteinBalance)}g`, proteinAdvice)}
        ${metric("ميزان الدهون", `${fatBalance >= 0 ? "+" : ""}${formatNumber(fatBalance)}g`, fatAdvice)}
        ${metric("كارديو الأسبوع", `${formatNumber(cardioWeek.cardio)} / ${formatNumber(cardioWeek.goal)}`, cardioAdvice)}
      </div>
      <div class="list insight-days">
        ${rows.map((row) => `
          <article class="list-item insight-day ${row.ok ? "good" : row.logged ? "warn" : ""}">
            <div class="item-head">
              <div>
                <p class="item-title">${dayLabel(row.dateISO)}</p>
                <p class="item-meta">${row.issues.join(" · ")}</p>
                <div class="meal-macros">
                  <span class="pill ${row.calorieDelta >= 0 ? "good" : "bad"}">${row.calorieDelta >= 0 ? "متبقي" : "زائد"} ${formatNumber(Math.abs(row.calorieDelta))} سعرة</span>
                  <span class="pill ${row.proteinDelta >= 0 ? "good" : "warn"}">${row.proteinDelta >= 0 ? "بروتين +" : "بروتين -"}${formatNumber(Math.abs(row.proteinDelta))}g</span>
                  <span class="pill ${row.fatDelta >= 0 ? "good" : "bad"}">${row.fatDelta >= 0 ? "دهون متاحة" : "دهون زائدة"} ${formatNumber(Math.abs(row.fatDelta))}g</span>
                  <span class="pill info">كارديو ${formatNumber(row.cardio)} سعرة</span>
                  ${dayResistance(row.dateISO) ? `<span class="pill good">مقاومة</span>` : ""}
                </div>
              </div>
              <button class="btn secondary" type="button" data-set-date="${row.dateISO}">فتح اليوم</button>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMonthlySummary() {
  const month = activeDate.slice(0, 7);
  const monthDates = [...new Set(state.foodLogs.filter((entry) => entry.date.startsWith(month)).map((entry) => entry.date))];
  const calories = monthDates.reduce((sum, date) => sum + dayFood(date).calories, 0);
  const deficit = monthDates.reduce((sum, date) => sum + dayDeficit(date), 0);
  return `
    <div class="panel">
      <div class="split-title"><h2>ملخص شهري</h2><span class="pill">${month}</span></div>
      <div class="metrics-grid">
        ${metric("أيام مسجلة", formatNumber(monthDates.length), "في هذا الشهر")}
        ${metric("سعرات الشهر", formatNumber(calories), "إجمالي مأكول")}
        ${metric("عجز الشهر", formatNumber(deficit), "تقريبي")}
        ${metric("متوسط العجز", formatNumber(monthDates.length ? deficit / monthDates.length : 0), "لليوم المسجل")}
      </div>
    </div>
  `;
}

function sourceOptions() {
  const mealOptions = state.meals.map((item) => `<option value="meal:${item.id}">${item.name}</option>`).join("");
  const categories = [...new Set(state.foods.map((item) => item.category || "أطعمة"))];
  const foodGroups = categories.map((category) => {
    const options = state.foods
      .filter((item) => (item.category || "أطعمة") === category)
      .map((item) => `<option value="food:${item.id}">${item.name}</option>`)
      .join("");
    return `<optgroup label="${category}">${options}</optgroup>`;
  }).join("");
  return `<option value="">اختر صنفاً</option>${mealOptions ? `<optgroup label="وجبات جاهزة">${mealOptions}</optgroup>` : ""}${foodGroups}`;
}

function sauceOptions(selected = "") {
  return `<option value="">بدون صوص</option>${state.sauces.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${item.name}</option>`).join("")}`;
}

function renderFoodLog() {
  const editingEntry = state.foodLogs.find((entry) => entry.id === editing.foodLog);
  const entries = state.foodLogs.filter((entry) => entry.date === activeDate);
  const cardioEntries = state.cardioLogs.filter((entry) => entry.date === activeDate);
  const food = dayFood();
  const remainingCalories = state.settings.targetCalories - food.calories;
  const proteinLeft = Math.max(0, state.settings.proteinGoal - food.protein);
  const cardioTotal = dayCardio();
  const resistance = dayResistance();
  document.querySelector("#food-log").innerHTML = `
    <div class="split-title"><h2>اليوم</h2><span class="pill good">${formatNumber(food.calories)} سعرة</span></div>
    <section class="today-command">
      <div>
        <span class="hero-label">وضع اليوم</span>
        <h3>${remainingCalories >= 0 ? `باقي ${formatNumber(remainingCalories)} سعرة` : `زائد ${formatNumber(Math.abs(remainingCalories))} سعرة`}</h3>
        <p>${proteinLeft ? `ركز الآن على ${formatNumber(proteinLeft)}g بروتين.` : "البروتين ممتاز، حافظ على هدوء السعرات."}</p>
      </div>
      <div class="today-command-grid">
        <span><strong>${formatNumber(food.protein)}</strong>g بروتين</span>
        <span><strong>${formatNumber(food.fat)}</strong>g دهون</span>
        <span><strong>${formatNumber(cardioTotal)}</strong> كارديو</span>
      </div>
    </section>

    <section class="panel resistance-panel ${resistance ? "active" : ""}">
      <div>
        <span class="hero-label">تمرين المقاومة</span>
        <h3>${resistance ? "مسجل كتمرين مقاومة" : "هل تمرنت مقاومة اليوم؟"}</h3>
        <p>${resistance ? "سيُحسب هذا اليوم كيوم تمرين في التحليل والتقرير." : "ضع علامة إذا تمرنت حديد/مقاومة حتى نفرق أيام التمرين عن الراحة."}</p>
      </div>
      <button class="resistance-toggle ${resistance ? "active" : ""}" type="button" data-action="toggle-resistance" aria-pressed="${resistance ? "true" : "false"}">
        <span>${resistance ? "✓" : "+"}</span>
        ${resistance ? "تمرين مقاومة" : "تسجيل مقاومة"}
      </button>
    </section>

    <form class="panel meal-entry-panel" id="foodForm">
      <div class="entry-head">
        <div>
          <span class="hero-label">${editingEntry ? "تعديل وجبة" : "إضافة وجبة"}</span>
          <h3>اختر الصنف والكمية</h3>
        </div>
        <span class="pill info">يعرض الماكروز قبل الحفظ</span>
      </div>
      <div class="meal-main-grid">
        <div class="field"><label>نوع الوجبة</label><select class="select" name="slot">
          ${["الفطور", "الغداء", "السناك", "العشاء", "وجبة إضافية"].map((slot) => `<option ${editingEntry?.slot === slot ? "selected" : ""}>${slot}</option>`).join("")}
        </select></div>
        <div class="field"><label>الصنف أو الوجبة الجاهزة</label><select class="select" name="source">${sourceOptions()}</select></div>
        <div class="field"><label>كمية الصنف بالجرام</label><input class="input" name="grams" type="number" min="0" step="1" value="${editingEntry?.grams || 100}" /></div>
      </div>
      <details class="optional-entry">
        <summary>صوص وملاحظات</summary>
        <div class="field-grid">
          <div class="field"><label>الصوص</label><select class="select" name="sauceId">${sauceOptions(editingEntry?.sauceId)}</select></div>
          <div class="field"><label>كمية الصوص بالجرام</label><input class="input" name="sauceGrams" type="number" min="0" step="1" value="${editingEntry?.sauceGrams || 0}" /></div>
          <div class="field"><label>ملاحظات</label><input class="input" name="notes" value="${editingEntry?.notes || ""}" placeholder="اختياري" /></div>
        </div>
      </details>
      <div id="foodPreview" class="food-preview-card"></div>
      <div class="actions">
        <button class="btn" type="submit">${editingEntry ? "تحديث الوجبة" : "إضافة الوجبة"}</button>
        ${editingEntry ? `<button class="btn secondary" type="button" data-action="cancel-edit">إلغاء</button>` : ""}
      </div>
    </form>
    <form class="panel daily-cardio-panel" id="dailyCardioForm">
      <div class="entry-head">
        <div>
          <span class="hero-label">كارديو</span>
          <h3>سجل تمرين اليوم</h3>
        </div>
        <span class="pill">${formatNumber(cardioTotal)} سعرة اليوم</span>
      </div>
      <div class="cardio-main-grid">
        <div class="field"><label>نوع التمرين</label><input class="input" name="type" required placeholder="مشي سريع، سير، دراجة..." /></div>
        <div class="field"><label>السعرات المحروقة</label><input class="input" name="calories" type="number" min="1" step="1" required placeholder="250" /></div>
        <div class="field"><label>المدة بالدقائق</label><input class="input" name="minutes" type="number" min="1" step="1" required placeholder="30" /></div>
      </div>
      <details class="optional-entry">
        <summary>ملاحظات التمرين</summary>
        <div class="field-grid">
          <div class="field"><label>ملاحظات</label><input class="input" name="notes" placeholder="اختياري" /></div>
        </div>
      </details>
      <input type="hidden" name="date" value="${activeDate}" />
      <div class="actions"><button class="btn" type="submit">حفظ الكارديو</button></div>
    </form>
    <div class="list daily-cardio-list">
      ${cardioEntries.map(renderCardioItem).join("") || `<div class="list-item"><p class="item-meta">لا يوجد كارديو مسجل لهذا اليوم.</p></div>`}
    </div>
    ${renderMealGroups(entries)}
  `;
  const form = document.querySelector("#foodForm");
  if (editingEntry) form.source.value = `${editingEntry.sourceType}:${editingEntry.itemId}`;
  form.addEventListener("input", updateFoodPreview);
  form.addEventListener("submit", saveFoodEntry);
  document.querySelector("#dailyCardioForm").addEventListener("submit", saveCardio);
  updateFoodPreview();
}

function renderMealGroups(entries) {
  const slots = ["الفطور", "الغداء", "السناك", "العشاء", "وجبة إضافية"];
  if (!entries.length) return `<div class="list"><div class="list-item"><p class="item-meta">لا توجد وجبات مسجلة لهذا اليوم.</p></div></div>`;
  return `
    <section class="meal-groups">
      ${slots.map((slot) => {
        const slotEntries = entries.filter((entry) => entry.slot === slot);
        const totals = addMacros(slotEntries.map(entryMacros));
        return `
          <article class="meal-group">
            <div class="meal-group-title">
              <h3>${slot}</h3>
              <span class="pill ${slotEntries.length ? "good" : ""}">${slotEntries.length ? `${formatNumber(totals.calories)} سعرة` : "فارغ"}</span>
            </div>
            <div class="list meal-group-list">
              ${slotEntries.map(renderFoodEntry).join("") || `<div class="list-item empty-slot"><p class="item-meta">لا توجد أصناف في ${slot}.</p></div>`}
            </div>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function renderFoodEntry(entry) {
  const macros = entryMacros(entry);
  const source = entry.sourceType === "meal" ? state.meals.find((item) => item.id === entry.itemId) : state.foods.find((item) => item.id === entry.itemId);
  const sauce = state.sauces.find((item) => item.id === entry.sauceId);
  return `
    <article class="list-item meal-card">
      <div class="item-head">
        <div>
          <p class="item-title">${entry.slot}: ${source?.name || "صنف محذوف"}</p>
          <p class="item-meta">${entry.grams} غ${sauce ? ` + ${entry.sauceGrams} غ ${sauce.name}` : ""}</p>
          <div class="meal-macros">
            <span class="pill good">${formatNumber(macros.calories)} سعرة</span>
            <span class="pill">بروتين ${formatNumber(macros.protein)}g</span>
            <span class="pill info">كارب ${formatNumber(macros.carbs)}g</span>
            <span class="pill">دهون ${formatNumber(macros.fat)}g</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn icon secondary" data-edit-log="${entry.id}" title="تعديل">✎</button>
          <button class="btn icon secondary" data-repeat-log="${entry.id}" title="تكرار">↻</button>
          <button class="btn icon danger" data-delete-log="${entry.id}" title="حذف">×</button>
        </div>
      </div>
    </article>
  `;
}

function updateFoodPreview() {
  const form = document.querySelector("#foodForm");
  if (!form) return;
  const [sourceType, itemId] = form.source.value.split(":");
  const temp = { sourceType, itemId, grams: form.grams.value, sauceId: form.sauceId.value, sauceGrams: form.sauceGrams.value };
  const macros = itemId ? entryMacros(temp) : { calories: 0, protein: 0, carbs: 0, fat: 0 };
  document.querySelector("#foodPreview").innerHTML = `
    <span>المتوقع</span>
    <strong>${formatNumber(macros.calories)} سعرة</strong>
    <div>
      <b>${formatNumber(macros.protein)}g بروتين</b>
      <b>${formatNumber(macros.carbs)}g كارب</b>
      <b>${formatNumber(macros.fat)}g دهون</b>
    </div>
  `;
}

function saveFoodEntry(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.source) return;
  const [sourceType, itemId] = data.source.split(":");
  const payload = { id: editing.foodLog || crypto.randomUUID(), date: activeDate, slot: data.slot, sourceType, itemId, grams: Number(data.grams), sauceId: data.sauceId, sauceGrams: Number(data.sauceGrams), notes: data.notes };
  state.foodLogs = state.foodLogs.filter((entry) => entry.id !== payload.id).concat(payload);
  editing.foodLog = null;
  render();
}

function foodFromExternal(item) {
  return {
    id: crypto.randomUUID(),
    name: item.name,
    category: item.category || "مستورد",
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
    notes: `${item.source || "مصدر خارجي"} · الحصة ${item.servingSize || 100}${item.servingUnit || "g"}${item.brand ? ` · ${item.brand}` : ""}${item.barcode ? ` · باركود ${item.barcode}` : ""}`,
  };
}

function importedFoodKey(item) {
  return String(item.fdcId || item.barcode || item.name);
}

function findImportedFood(key) {
  return usdaResults.find((result) => importedFoodKey(result) === String(key));
}

function addImportedFoodToToday(item) {
  const food = foodFromExternal(item);
  state.foods.push(food);
  state.foodLogs.push({
    id: crypto.randomUUID(),
    date: activeDate,
    slot: "وجبة إضافية",
    sourceType: "food",
    itemId: food.id,
    grams: Number(item.servingSize || 100) || 100,
    sauceId: "",
    sauceGrams: 0,
    notes: item.barcode ? `باركود ${item.barcode}` : "إضافة من البحث",
  });
  render();
  setView("food-log");
}

function setupUSDAInput() {
  const input = document.querySelector("#usdaSearchInput");
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(usdaSearchTimer);
    usdaSearchTimer = setTimeout(() => searchUSDA(input.value), 450);
  });
}

async function searchUSDA(query) {
  const stateBox = document.querySelector("#usdaState");
  const resultsBox = document.querySelector("#usdaResults");
  if (!stateBox || !resultsBox) return;
  if (!query.trim()) {
    stateBox.textContent = "ابدأ بالكتابة للبحث في USDA.";
    resultsBox.innerHTML = "";
    return;
  }
  stateBox.innerHTML = `<span class="loader"></span> جاري البحث...`;
  resultsBox.innerHTML = "";
  try {
    usdaResults = await window.USDAService.search(query);
    if (!usdaResults.length) {
      stateBox.textContent = "لا توجد نتائج. جرّب اسم طعام آخر.";
      return;
    }
    stateBox.textContent = `${usdaResults.length} نتيجة`;
    resultsBox.innerHTML = usdaResults.map(renderImportedFoodCard).join("");
  } catch (error) {
    stateBox.textContent = error.message || "تعذر الاتصال بخدمة USDA.";
  }
}

function renderImportedFoodCard(item) {
  const key = importedFoodKey(item);
  return `
    <article class="import-card">
      <div>
        <p class="item-title">${item.name}</p>
        <p class="item-meta">${item.category}${item.brand ? ` · ${item.brand}` : ""} · الحصة ${item.servingSize || 100}${item.servingUnit || "g"}</p>
        <div class="meal-macros">
          <span class="pill good">${formatNumber(item.calories)} سعرة</span>
          <span class="pill">بروتين ${formatNumber(item.protein)}g</span>
          <span class="pill info">كارب ${formatNumber(item.carbs)}g</span>
          <span class="pill">دهون ${formatNumber(item.fat)}g</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn" type="button" data-add-imported-today="${key}">أضف لليوم</button>
        <button class="btn secondary" type="button" data-import-food="${key}">حفظ</button>
      </div>
    </article>
  `;
}

async function lookupBarcode(code) {
  const result = document.querySelector("#barcodeResult");
  const stateBox = document.querySelector("#barcodeState");
  if (!result || !stateBox || !code.trim()) return;
  stateBox.innerHTML = `<span class="loader"></span> تم قراءة ${code}، جاري البحث...`;
  result.innerHTML = "";
  try {
    usdaResults = await window.USDAService.lookupBarcode(code);
    if (!usdaResults.length) {
      stateBox.textContent = "لم يتم العثور على المنتج. أدخله يدوياً واحفظه في قاعدة بياناتك.";
      result.innerHTML = manualFoodForm(code);
      document.querySelector("#manualFoodForm")?.addEventListener("submit", saveManualImportedFood);
      return;
    }
    stateBox.textContent = "تم العثور على المنتج.";
    result.innerHTML = renderImportedFoodCard(usdaResults[0]);
  } catch (error) {
    stateBox.textContent = error.message || "تعذر البحث عن الباركود.";
    result.innerHTML = manualFoodForm(code);
    document.querySelector("#manualFoodForm")?.addEventListener("submit", saveManualImportedFood);
  }
}

function manualFoodForm(barcode = "") {
  return `
    <form class="import-card manual-import" id="manualFoodForm">
      <input type="hidden" name="barcode" value="${barcode}" />
      <div class="field"><label>اسم المنتج</label><input class="input" name="name" required /></div>
      <div class="field-grid">
        ${macroInputs({})}
        <div class="field"><label>حجم الحصة</label><input class="input" name="servingSize" type="number" value="100" /></div>
      </div>
      <button class="btn" type="submit">حفظ في أطعمي</button>
    </form>
  `;
}

function saveManualImportedFood(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.foods.push({
    id: crypto.randomUUID(),
    name: data.name,
    category: "باركود",
    calories: Number(data.calories),
    protein: Number(data.protein),
    carbs: Number(data.carbs),
    fat: Number(data.fat),
    notes: `Manual barcode ${data.barcode || ""} · serving ${data.servingSize || 100}g`,
  });
  render();
  setView("food-log");
}

function renderAdd() {
  document.querySelector("#add").innerHTML = `
    <div class="split-title"><h2>إضافة</h2><span class="pill info">إجراء سريع</span></div>
    <p class="section-kicker">المسارات اليومية الأساسية: وجبة، كارديو، مقاومة، قياس. بدون بحث طويل.</p>
    <section class="quick-actions">
      <button class="quick-action" data-view="food-log" type="button"><span>${icon("utensils")}</span>وجبة</button>
      <button class="quick-action secondary" data-action="focus-cardio" type="button"><span>${icon("cardio")}</span>كارديو</button>
      <button class="quick-action secondary" data-action="toggle-resistance" type="button"><span>${icon("target")}</span>مقاومة</button>
      <button class="quick-action secondary" data-action="focus-weight" type="button"><span>${icon("scale")}</span>وزن</button>
    </section>

    <section class="panel api-panel">
      <div class="split-title"><h3>بحث الأطعمة العالمي</h3><span class="pill info">USDA</span></div>
      <div class="field">
        <label>ابحث عن طعام عالمي</label>
        <input class="input" id="usdaSearchInput" placeholder="مثال: chicken breast, greek yogurt, oats" autocomplete="off" />
      </div>
      <div id="usdaState" class="api-state">ابدأ بالكتابة للبحث في USDA.</div>
      <div id="usdaResults" class="api-results"></div>
    </section>

    <section class="panel api-panel">
      <div class="split-title"><h3>قارئ الباركود</h3><span class="pill">الكاميرا</span></div>
      <div class="scanner-box">
        <video id="barcodeVideo" playsinline muted></video>
        <div id="barcodeState" class="api-state">افتح الكاميرا أو أدخل الباركود يدوياً.</div>
      </div>
      <div class="two-cols">
        <button class="btn" type="button" data-action="start-barcode">فتح الكاميرا</button>
        <button class="btn secondary" type="button" data-action="stop-barcode">إيقاف</button>
      </div>
      <div class="field">
        <label>باركود يدوي</label>
        <input class="input" id="manualBarcode" placeholder="مثال: 012345678905" />
      </div>
      <div class="actions"><button class="btn secondary" type="button" data-action="lookup-barcode">بحث عن المنتج</button></div>
      <div id="barcodeResult" class="api-results"></div>
    </section>

    <form class="panel" id="addCardioForm">
      <div class="split-title"><h3>كارديو سريع</h3><span class="pill">${formatNumber(dayCardio())} اليوم</span></div>
      <div class="field-grid">
        <div class="field"><label>التاريخ</label><input class="input" name="date" type="date" value="${activeDate}" /></div>
        <div class="field"><label>النوع</label><input class="input" name="type" required placeholder="مشي سريع" /></div>
        <div class="field"><label>الدقائق</label><input class="input" name="minutes" type="number" required /></div>
        <div class="field"><label>السعرات</label><input class="input" name="calories" type="number" required /></div>
        <div class="field"><label>ملاحظات</label><input class="input" name="notes" /></div>
      </div>
      <div class="actions"><button class="btn" type="submit">حفظ الكارديو</button></div>
    </form>

    <form class="panel" id="addProgressForm">
      <div class="split-title"><h3>قياس سريع</h3><span class="pill">وزن + خصر</span></div>
      <div class="field-grid">
        <div class="field"><label>التاريخ</label><input class="input" name="date" type="date" value="${activeDate}" /></div>
        <div class="field"><label>الوزن</label><input class="input" name="weight" type="number" step="0.1" required /></div>
        <div class="field"><label>الخصر</label><input class="input" name="waist" type="number" step="0.1" required /></div>
        <div class="field"><label>ملاحظات</label><input class="input" name="notes" /></div>
      </div>
      <div class="actions"><button class="btn" type="submit">حفظ القياس</button></div>
    </form>
  `;
  document.querySelector("#addCardioForm").addEventListener("submit", saveCardio);
  document.querySelector("#addProgressForm").addEventListener("submit", saveProgress);
  setupUSDAInput();
}

function renderDatabase() {
  document.querySelector("#database").innerHTML = `
    <div class="split-title"><h2>قاعدة الأطعمة والصوصات</h2><span class="pill">${state.foods.length + state.sauces.length} صنف</span></div>
    <div class="panel">
      <input id="dbSearch" class="input" placeholder="بحث داخل الأطعمة والصوصات" />
    </div>
    ${foodDatabaseForm()}
    ${sauceDatabaseForm()}
    <div class="list" id="dbList"></div>
  `;
  document.querySelector("#foodDbForm").addEventListener("submit", saveFood);
  document.querySelector("#sauceDbForm").addEventListener("submit", saveSauce);
  document.querySelector("#dbSearch").addEventListener("input", renderDbList);
  renderDbList();
}

function foodDatabaseForm() {
  const item = state.foods.find((food) => food.id === editing.food);
  return `
    <form class="subform" id="foodDbForm">
      <h3>${item ? "تعديل صنف" : "إضافة صنف"}</h3>
      <div class="field-grid">
        <div class="field"><label>اسم الصنف</label><input class="input" name="name" required value="${item?.name || ""}" /></div>
        <div class="field"><label>التصنيف</label><select class="select" name="category">${["بروتين", "كارب", "دهون", "صوص", "وجبة كاملة", "سناك"].map((cat) => `<option ${item?.category === cat ? "selected" : ""}>${cat}</option>`).join("")}</select></div>
        ${macroInputs(item)}
        <div class="field"><label>ملاحظات</label><input class="input" name="notes" value="${item?.notes || ""}" /></div>
      </div>
      <div class="actions"><button class="btn" type="submit">${item ? "تحديث" : "إضافة"}</button>${item ? `<button class="btn secondary" type="button" data-action="cancel-food-db">إلغاء</button>` : ""}</div>
    </form>
  `;
}

function sauceDatabaseForm() {
  const item = state.sauces.find((sauce) => sauce.id === editing.sauce);
  return `
    <form class="subform" id="sauceDbForm">
      <h3>${item ? "تعديل صوص" : "إضافة صوص"}</h3>
      <div class="field-grid">
        <div class="field"><label>اسم الصوص</label><input class="input" name="name" required value="${item?.name || ""}" /></div>
        ${macroInputs(item)}
        <div class="field"><label>المكونات</label><input class="input" name="ingredients" value="${item?.ingredients || ""}" /></div>
        <div class="field"><label>ملاحظات</label><input class="input" name="notes" value="${item?.notes || ""}" /></div>
      </div>
      <div class="actions"><button class="btn" type="submit">${item ? "تحديث" : "إضافة"}</button>${item ? `<button class="btn secondary" type="button" data-action="cancel-sauce-db">إلغاء</button>` : ""}</div>
    </form>
  `;
}

function macroInputs(item = {}) {
  return `
    <div class="field"><label>السعرات لكل 100 غ</label><input class="input" name="calories" type="number" step="0.1" required value="${item.calories || ""}" /></div>
    <div class="field"><label>البروتين لكل 100 غ</label><input class="input" name="protein" type="number" step="0.1" required value="${item.protein || ""}" /></div>
    <div class="field"><label>الكارب لكل 100 غ</label><input class="input" name="carbs" type="number" step="0.1" required value="${item.carbs || ""}" /></div>
    <div class="field"><label>الدهون لكل 100 غ</label><input class="input" name="fat" type="number" step="0.1" required value="${item.fat || ""}" /></div>
  `;
}

function saveFood(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const payload = { id: editing.food || crypto.randomUUID(), name: data.name, category: data.category, calories: Number(data.calories), protein: Number(data.protein), carbs: Number(data.carbs), fat: Number(data.fat), notes: data.notes };
  state.foods = state.foods.filter((item) => item.id !== payload.id).concat(payload);
  editing.food = null;
  render();
}

function saveSauce(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const payload = { id: editing.sauce || crypto.randomUUID(), name: data.name, calories: Number(data.calories), protein: Number(data.protein), carbs: Number(data.carbs), fat: Number(data.fat), ingredients: data.ingredients, notes: data.notes };
  state.sauces = state.sauces.filter((item) => item.id !== payload.id).concat(payload);
  editing.sauce = null;
  render();
}

function renderDbList() {
  const term = (document.querySelector("#dbSearch")?.value || "").trim().toLowerCase();
  const foods = state.foods.filter((item) => item.name.toLowerCase().includes(term));
  const sauces = state.sauces.filter((item) => item.name.toLowerCase().includes(term));
  document.querySelector("#dbList").innerHTML = `
    ${foods.map((item) => dbItem(item, "food")).join("")}
    ${sauces.map((item) => dbItem(item, "sauce")).join("")}
  ` || `<div class="list-item"><p class="item-meta">لا توجد نتائج.</p></div>`;
}

function dbItem(item, type) {
  return `
    <article class="list-item">
      <div class="item-head">
        <div>
          <p class="item-title">${item.name} <span class="pill">${type === "sauce" ? "صوص" : item.category}</span></p>
          <p class="item-meta">لكل 100 غ: ${formatNumber(item.calories)} سعرة · بروتين ${formatNumber(item.protein, 1)} · كارب ${formatNumber(item.carbs, 1)} · دهون ${formatNumber(item.fat, 1)} ${item.notes ? `· ${item.notes}` : ""}</p>
        </div>
        <div class="actions">
          <button class="btn icon secondary" data-edit-${type}="${item.id}" title="تعديل">✎</button>
          <button class="btn icon danger" data-delete-${type}="${item.id}" title="حذف">×</button>
        </div>
      </div>
    </article>
  `;
}

function renderMealBuilder() {
  document.querySelector("#meal-builder").innerHTML = mealBuilderInner();
  document.querySelector("#mealForm").addEventListener("submit", saveMeal);
}

function mealBuilderInner() {
  const meal = state.meals.find((item) => item.id === editing.meal);
  const components = meal?.components || editing.components || [];
  return `
    <div class="split-title"><h3>وجباتي</h3><span class="pill">${state.meals.length} وجبة</span></div>
    <form class="subform" id="mealForm">
      <div class="field"><label>اسم الوجبة</label><input class="input" name="name" required value="${meal?.name || editing.mealName || ""}" placeholder="مثال: دجاج برياني" /></div>
      <div class="two-cols">
        <div class="field"><label>مكون</label><select class="select" id="componentSource">${sourceComponentOptions()}</select></div>
        <div class="field"><label>الجرامات</label><input class="input" id="componentGrams" type="number" value="100" /></div>
      </div>
      <div class="actions"><button class="btn secondary" type="button" data-action="add-component">إضافة مكون</button></div>
      <div class="list">${components.map(renderComponent).join("") || `<div class="list-item"><p class="item-meta">أضف مكونات الوجبة.</p></div>`}</div>
      <div class="compact-note">${mealBuilderTotals(components)}</div>
      <div class="actions"><button class="btn" type="submit">${meal ? "تحديث الوجبة" : "حفظ كوجبة جاهزة"}</button>${meal ? `<button class="btn secondary" type="button" data-action="cancel-meal">إلغاء</button>` : ""}</div>
    </form>
    <div class="list">${state.meals.map(renderMeal).join("") || `<div class="list-item"><p class="item-meta">لا توجد وجبات جاهزة محفوظة.</p></div>`}</div>
  `;
}

function sourceComponentOptions() {
  return `
    ${state.foods.map((item) => `<option value="food:${item.id}">${item.name}</option>`).join("")}
    ${state.sauces.map((item) => `<option value="sauce:${item.id}">${item.name}</option>`).join("")}
  `;
}

function renderComponent(component, index) {
  const source = component.type === "sauce" ? state.sauces.find((item) => item.id === component.itemId) : state.foods.find((item) => item.id === component.itemId);
  return `<article class="list-item"><div class="item-head"><p class="item-title">${source?.name || "مكون محذوف"} · ${component.grams} غ</p><button class="btn icon danger" data-remove-component="${index}" type="button">×</button></div></article>`;
}

function mealBuilderTotals(components) {
  const total = addMacros(components.map((component) => {
    const source = component.type === "sauce" ? state.sauces.find((item) => item.id === component.itemId) : state.foods.find((item) => item.id === component.itemId);
    return macroFromItem(source, component.grams);
  }));
  return `إجمالي الوجبة: ${formatNumber(total.calories)} سعرة · بروتين ${formatNumber(total.protein)}غ · كارب ${formatNumber(total.carbs)}غ · دهون ${formatNumber(total.fat)}غ`;
}

function renderMeal(meal) {
  const total = mealMacros(meal, (meal.components || []).reduce((sum, item) => sum + Number(item.grams || 0), 0));
  return `
    <article class="list-item">
      <div class="item-head">
        <div><p class="item-title">${meal.name}</p><p class="item-meta">${mealBuilderTotals(meal.components)} · لكل الكمية الأصلية</p></div>
        <div class="actions"><button class="btn icon secondary" data-edit-meal="${meal.id}">✎</button><button class="btn icon danger" data-delete-meal="${meal.id}">×</button></div>
      </div>
    </article>
  `;
}

function saveMeal(event) {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  const components = editing.components || state.meals.find((item) => item.id === editing.meal)?.components || [];
  if (!components.length) return;
  const payload = { id: editing.meal || crypto.randomUUID(), name, components };
  state.meals = state.meals.filter((item) => item.id !== payload.id).concat(payload);
  editing.meal = null;
  editing.components = [];
  render();
}

function renderProgress() {
  const logs = [...state.progressLogs].sort(byDate);
  const first = logs[0];
  const latest = logs.at(-1);
  const weightChange = latest && first ? latest.weight - first.weight : 0;
  const waistChange = latest && first ? latest.waist - first.waist : 0;
  const weeks = first && latest ? Math.max(1, (new Date(latest.date) - new Date(first.date)) / 604800000) : 1;
  const avgWeeklyLoss = -weightChange / weeks;
  const bestWeek = bestProgressWeek();
  const recompositionAlert = logs.length >= 2 && Math.abs(logs.at(-1).weight - logs.at(-2).weight) < 0.3 && logs.at(-1).waist < logs.at(-2).waist;
  const smart = progressIntelligence(logs);
  const targetGap = latest ? latest.weight - state.settings.goalWeight : 0;
  const waistGap = latest ? latest.waist - state.settings.goalWaist : 0;
  document.querySelector("#progress").innerHTML = `
    <div class="split-title"><h2>التقدم</h2><span class="pill">${logs.length} قياس</span></div>
    <section class="progress-command">
      <div>
        <span class="hero-label">اتجاه الجسم</span>
        <h3>${smart.title}</h3>
        <p>${smart.text}</p>
      </div>
      <div class="progress-command-grid">
        <span><strong>${latest?.weight ? formatNumber(latest.weight, 1) : "--"}</strong> كجم الآن</span>
        <span><strong>${latest?.waist ? formatNumber(latest.waist, 1) : "--"}</strong> سم خصر</span>
        <span><strong>${latest ? formatNumber(targetGap, 1) : "--"}</strong> كجم للهدف</span>
      </div>
    </section>
    <form class="panel progress-entry-panel" id="progressForm">
      <div class="entry-head">
        <div>
          <span class="hero-label">قياس جديد</span>
          <h3>سجل الوزن والخصر</h3>
        </div>
        <span class="pill info">${smart.eta}</span>
      </div>
      <div class="progress-main-grid">
        <div class="field"><label>التاريخ</label><input class="input" name="date" type="date" value="${activeDate}" /></div>
        <div class="field"><label>الوزن</label><input class="input" name="weight" type="number" step="0.1" required /></div>
        <div class="field"><label>محيط الخصر</label><input class="input" name="waist" type="number" step="0.1" required /></div>
      </div>
      <details class="optional-entry">
        <summary>ملاحظات القياس</summary>
        <div class="field-grid">
          <div class="field"><label>ملاحظات</label><input class="input" name="notes" placeholder="نوم، احتباس، تمرين قوي..." /></div>
        </div>
      </details>
      <div class="actions"><button class="btn" type="submit">تسجيل القياس</button></div>
    </form>
    ${recompositionAlert ? `<div class="alert good">الوزن شبه ثابت لكن الخصر ينزل. هذا غالباً تقدم جيد في تركيب الجسم.</div>` : ""}
    <div class="weekly-strip">
      ${weeklyMini("تغير الوزن", `${formatNumber(weightChange, 1)} كجم`, "من البداية")}
      ${weeklyMini("تغير الخصر", `${formatNumber(waistChange, 1)} سم`, "من البداية")}
      ${weeklyMini("متوسط النزول", `${formatNumber(avgWeeklyLoss, 2)} كجم`, "أسبوعياً")}
      ${weeklyMini("متوسط 7 أيام", `${formatNumber(rollingAverage(logs, "weight", 7), 1)} كجم`, "وزن")}
      ${weeklyMini("متوسط 30 يوم", `${formatNumber(rollingAverage(logs, "weight", 30), 1)} كجم`, "وزن")}
      ${weeklyMini("فارق الخصر", latest ? `${formatNumber(waistGap, 1)} سم` : "--", "عن الهدف")}
    </div>
    <div class="chart-row">
      <article class="chart-card"><h3>وزني</h3><canvas class="chart" id="weightChart"></canvas></article>
      <article class="chart-card"><h3>خصري</h3><canvas class="chart" id="waistChart"></canvas></article>
      <article class="chart-card"><h3>العجز</h3><canvas class="chart" id="progressDeficitChart"></canvas></article>
      <article class="chart-card"><h3>الكارديو</h3><canvas class="chart" id="progressCardioChart"></canvas></article>
      <article class="chart-card"><h3>المتوسط الأسبوعي</h3><canvas class="chart" id="weeklyAverageChart"></canvas></article>
    </div>
    <div class="list">${logs.slice().reverse().map(renderProgressItem).join("") || `<div class="list-item"><p class="item-meta">لا توجد قياسات بعد.</p></div>`}</div>
  `;
  document.querySelector("#progressForm")?.addEventListener("submit", saveProgress);
  drawChart("weightChart", logs.map((item) => ({ label: item.date.slice(5), value: item.weight })), "#2563eb");
  drawChart("waistChart", logs.map((item) => ({ label: item.date.slice(5), value: item.waist })), "#0f766e");
  const dates = getWeekDates();
  drawChart("progressDeficitChart", dates.map((date) => ({ label: date.slice(5), value: dayDeficit(date) })), "#34d399");
  drawChart("progressCardioChart", dates.map((date) => ({ label: date.slice(5), value: dayCardio(date) })), "#f59e0b");
  drawChart("weeklyAverageChart", dates.map((date) => ({ label: date.slice(5), value: dayFood(date).calories })), "#a78bfa");
}

function bestProgressWeek() {
  const logs = [...state.progressLogs].sort(byDate);
  if (logs.length < 2) return "";
  let best = null;
  for (let index = 1; index < logs.length; index += 1) {
    const score = (logs[index - 1].weight - logs[index].weight) + ((logs[index - 1].waist - logs[index].waist) / 2);
    if (!best || score > best.score) best = { score, date: logs[index].date };
  }
  return best?.score > 0 ? best.date : "لا يوجد";
}

function rollingAverage(logs, key, days) {
  const values = logs.slice(-days).map((item) => Number(item[key])).filter(Boolean);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function progressIntelligence(logs) {
  if (logs.length < 2) {
    return { title: "ابدأ القياس", text: "سجل وزنك وخصرك مرتين على الأقل حتى تظهر التوقعات.", eta: "غير كاف" };
  }
  const first = logs[0];
  const latest = logs.at(-1);
  const weeks = Math.max(1, (new Date(latest.date) - new Date(first.date)) / 604800000);
  const weeklyLoss = (first.weight - latest.weight) / weeks;
  const remaining = latest.weight - state.settings.goalWeight;
  const etaWeeks = weeklyLoss > 0 ? Math.ceil(remaining / weeklyLoss) : 0;
  if (weeklyLoss <= 0) {
    return { title: "تحتاج تعديل بسيط", text: "المعدل الحالي لا يتجه للهدف. راجع متوسط السعرات أو ارفع الحركة الأسبوعية.", eta: "غير واضح" };
  }
  return {
    title: "ممتاز، استمر بهذا المعدل",
    text: `تنزل تقريباً ${formatNumber(weeklyLoss, 2)} كجم أسبوعياً. لو استمر هذا الإيقاع ستصل لهدفك خلال ${etaWeeks} أسابيع.`,
    eta: `${etaWeeks} أسابيع`,
  };
}

function renderProgressItem(item) {
  return `
    <article class="list-item">
      <div class="item-head">
        <div>
          <p class="item-title">${item.date}</p>
          <p class="item-meta">${item.weight} كجم · خصر ${item.waist} سم ${item.notes ? `· ${item.notes}` : ""}</p>
        </div>
        <button class="btn icon danger" data-delete-progress="${item.id}">×</button>
      </div>
    </article>
  `;
}

function saveProgress(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  state.progressLogs.push({ id: crypto.randomUUID(), date: data.date, weight: Number(data.weight), waist: Number(data.waist), notes: data.notes });
  render();
}

function renderCardio() {
  const logs = state.cardioLogs.filter((entry) => entry.date === activeDate);
  const week = weekStats();
  document.querySelector("#cardio").innerHTML = `
    <div class="split-title"><h2>الكارديو</h2><span class="pill">${formatNumber(dayCardio())} اليوم</span></div>
    <form class="panel" id="cardioForm">
      <div class="field-grid">
        <div class="field"><label>التاريخ</label><input class="input" name="date" type="date" value="${activeDate}" /></div>
        <div class="field"><label>نوع الكارديو</label><input class="input" name="type" required placeholder="مشي، دراجة، سير..." /></div>
        <div class="field"><label>المدة بالدقائق</label><input class="input" name="minutes" type="number" required /></div>
        <div class="field"><label>السعرات المحروقة</label><input class="input" name="calories" type="number" required /></div>
        <div class="field"><label>ملاحظات</label><input class="input" name="notes" /></div>
      </div>
      <div class="actions"><button class="btn" type="submit">تسجيل الكارديو</button></div>
    </form>
    <div class="metrics-grid">
      ${metric("مجموع اليوم", formatNumber(dayCardio()), "سعرات")}
      ${metric("مجموع الأسبوع", formatNumber(week.cardio), "سعرات")}
      ${metric("متوسط الحرق", formatNumber(week.cardio / 7), "أسبوعياً / يوم")}
      ${metric("هدف الأسبوع", formatNumber(state.settings.weeklyCardioGoal), "سعرات")}
    </div>
    <div class="list">${logs.map(renderCardioItem).join("") || `<div class="list-item"><p class="item-meta">لا يوجد كارديو مسجل لهذا اليوم.</p></div>`}</div>
  `;
  document.querySelector("#cardioForm").addEventListener("submit", saveCardio);
}

function renderCardioItem(item) {
  return `<article class="list-item"><div class="item-head"><div><p class="item-title">${item.type}</p><p class="item-meta">${item.minutes} دقيقة · ${item.calories} سعرة ${item.notes ? `· ${item.notes}` : ""}</p></div><button class="btn icon danger" data-delete-cardio="${item.id}">×</button></div></article>`;
}

function saveCardio(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  state.cardioLogs.push({ id: crypto.randomUUID(), date: data.date, type: data.type, minutes: Number(data.minutes), calories: Number(data.calories), notes: data.notes });
  render();
}

function toggleResistance(dateISO = activeDate) {
  const current = dayResistance(dateISO);
  if (current) {
    state.resistanceLogs = (state.resistanceLogs || []).filter((entry) => entry.id !== current.id);
  } else {
    state.resistanceLogs = (state.resistanceLogs || []).filter((entry) => entry.date !== dateISO).concat({
      id: crypto.randomUUID(),
      date: dateISO,
      done: true,
      type: "تمرين مقاومة",
      notes: "",
    });
  }
  render();
}

function renderSettings() {
  const s = state.settings;
  document.querySelector("#settings").innerHTML = `
    <div class="split-title"><h2>مركز التحكم</h2><span class="pill">النظام</span></div>
    <section class="control-command">
      <div>
        <span class="hero-label">حفظ واستمرارية</span>
        <h3>بياناتك أولاً</h3>
        <p>صدّر نسخة، عدل الأهداف، وخذ تقريراً جاهزاً للمدرب الذكي بدون تشتيت شاشة اليوم.</p>
      </div>
      <button class="command-button" type="button" data-action="export-backup">تصدير نسخة الآن</button>
    </section>
    <section class="quick-actions">
      <button class="quick-action" data-view="ai-coach" type="button"><span>${icon("coach")}</span>المدرب الذكي</button>
      <button class="quick-action secondary" data-action="copy-ai-report" type="button"><span>${icon("spark")}</span>نسخ التقرير</button>
      <button class="quick-action secondary" data-action="export-backup" type="button"><span>${icon("database")}</span>نسخة احتياطية</button>
    </section>
    <div class="more-stack">
      <details class="panel details-card">
        <summary>الأهداف والإعدادات</summary>
        <form id="settingsForm">
          <div class="field-grid">
            ${settingInput("maintenance", "سعرات المحافظة", s.maintenance)}
            ${settingInput("targetCalories", "السعرات المستهدفة اليومية", s.targetCalories)}
            ${settingInput("proteinGoal", "هدف البروتين", s.proteinGoal)}
            ${settingInput("carbsGoal", "هدف الكارب", s.carbsGoal)}
            ${settingInput("fatGoal", "هدف الدهون", s.fatGoal)}
            ${settingInput("goalWeight", "هدف الوزن", s.goalWeight)}
            ${settingInput("goalWaist", "هدف محيط الخصر", s.goalWaist)}
            ${settingInput("minProtein", "الحد الأدنى للبروتين", s.minProtein)}
            ${settingInput("maxFat", "الحد الأعلى للدهون", s.maxFat)}
            ${settingInput("weeklyCardioGoal", "هدف الكارديو الأسبوعي", s.weeklyCardioGoal)}
            <div class="field"><label>بداية الأسبوع</label><select class="select" name="weekStartsOn">
              ${["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((day, index) => `<option value="${index}" ${Number(s.weekStartsOn) === index ? "selected" : ""}>${day}</option>`).join("")}
            </select></div>
          </div>
          <div class="actions"><button class="btn" type="submit">حفظ الإعدادات</button><button class="btn secondary" type="button" data-action="seed-demo">بيانات تجربة</button><button class="btn danger" type="button" data-action="reset-data">تصفير</button></div>
        </form>
      </details>

      <details class="panel details-card">
        <summary>النسخ الاحتياطي والاسترجاع</summary>
        ${recoveryTools()}
      </details>

      <details class="panel details-card">
        <summary>تقرير للذكاء الاصطناعي</summary>
        ${aiReportTools()}
      </details>

      <details class="panel details-card">
        <summary>قاعدة الأطعمة والصوصات</summary>
        <div class="subform">
          <input id="dbSearch" class="input" placeholder="بحث داخل الأطعمة والصوصات" />
        </div>
        ${foodDatabaseForm()}
        ${sauceDatabaseForm()}
        <div class="list" id="dbList"></div>
      </details>

      <details class="panel details-card">
        <summary>بناء الوجبات الجاهزة</summary>
        ${mealBuilderInner()}
      </details>

      <details class="panel details-card" id="apiSettings">
        <summary>الربط التقني</summary>
        <form id="apiSettingsForm" class="subform">
          <div class="field-grid">
            <div class="field"><label>مفتاح USDA</label><input class="input" name="usda" type="password" value="${localStorage.getItem("USDA_API_KEY") || ""}" placeholder="محفوظ محلياً" /></div>
            <div class="field"><label>مفتاح OpenAI</label><input class="input" name="openai" type="password" value="${localStorage.getItem("OPENAI_API_KEY") || ""}" placeholder="محفوظ محلياً" /></div>
          </div>
          <p class="compact-note">تحفظ المفاتيح داخل هذا المتصفح فقط.</p>
          <div class="actions"><button class="btn" type="submit">حفظ المفاتيح</button></div>
        </form>
      </details>
    </div>
  `;
  document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
  document.querySelector("#apiSettingsForm").addEventListener("submit", saveApiSettings);
  document.querySelector("#foodDbForm").addEventListener("submit", saveFood);
  document.querySelector("#sauceDbForm").addEventListener("submit", saveSauce);
  document.querySelector("#dbSearch").addEventListener("input", renderDbList);
  document.querySelector("#mealForm").addEventListener("submit", saveMeal);
  renderDbList();
}

function recoveryTools() {
  recoveryCandidates = discoverRecoveryCandidates();
  const bundledSnapshot = window.HEALTHTRACKKER_BUNDLED_RESTORE?.state;
  const bundledSummary = bundledSnapshot && meaningfulDataCount(bundledSnapshot) > 0 ? snapshotSummary(bundledSnapshot) : null;
  const bundledDate = window.HEALTHTRACKKER_BUNDLED_RESTORE?.exportedAt
    ? new Date(window.HEALTHTRACKKER_BUNDLED_RESTORE.exportedAt).toLocaleDateString("ar-SA")
    : "8 يوليو";
  const bundledRestore = bundledSummary ? `
    <div class="restore-callout">
      <div>
        <p class="item-title">نسخة بيانات محفوظة داخل التطبيق</p>
        <p class="item-meta">${summaryText(bundledSummary)} · تاريخ النسخة ${bundledDate}</p>
      </div>
      <button class="btn" type="button" data-action="restore-bundled">استرجاع بيانات 8 يوليو</button>
    </div>
  ` : "";
  const candidateList = recoveryCandidates.length ? `
    <div class="list">
      ${recoveryCandidates.map((candidate, index) => `
        <article class="list-item">
          <div class="item-head">
            <div>
              <p class="item-title">${candidate.source}</p>
              <p class="item-meta">${summaryText(candidate.summary)}${candidate.createdAt ? ` · ${new Date(candidate.createdAt).toLocaleString("ar-SA")}` : ""}</p>
            </div>
            <button class="btn secondary" type="button" data-restore-snapshot="${index}">دمج هذه النسخة</button>
          </div>
        </article>
      `).join("")}
    </div>
  ` : `<p class="compact-note">لا توجد نسخة قديمة قابلة للدمج داخل هذا المتصفح حالياً.</p>`;
  return `
    <div class="subform">
      <p class="compact-note">احتفظ بنسخة واحدة خارج المتصفح. الدمج لا يحذف الموجود، والاستبدال الكامل يجعل هذا المتصفح مطابقاً للملف بعد حفظ نسخة أمان أولاً.</p>
      ${bundledRestore}
      <div class="actions">
        <button class="btn" type="button" data-action="export-backup">تصدير نسخة احتياطية</button>
      </div>
      <div class="field">
        <label>استيراد نسخة محفوظة</label>
        <input class="input" id="backupImportFile" type="file" accept="application/json" />
      </div>
      <div class="actions">
        <button class="btn secondary" type="button" data-action="import-backup">استيراد ودمج</button>
        <button class="btn danger" type="button" data-action="replace-backup">استبدال كامل من الملف</button>
      </div>
      ${candidateList}
    </div>
  `;
}

function aiReportTools() {
  return `
    <div class="subform">
      <p class="compact-note">انسخ هذا التقرير وأرسله لأي تطبيق ذكاء اصطناعي لمتابعة جسمك وتقدمك.</p>
      <textarea class="textarea report-box" id="aiReportText" readonly>${generateAIReport()}</textarea>
      <div class="actions">
        <button class="btn" type="button" data-action="copy-ai-report">نسخ التقرير</button>
      </div>
    </div>
  `;
}

function generateAIReport() {
  const weekDates = getWeekDates();
  const progressLogs = [...state.progressLogs].sort(byDate);
  const latest = progressLogs.at(-1);
  const previous = progressLogs.at(-2);
  const week = weekStats();
  const today = dayFood();
  const adherence = adherenceDays();
  const dayLines = weekDates.map((date) => {
    const food = dayFood(date);
    const cardio = dayCardio(date);
    const insight = dayInsight(date);
    return `- ${date}: سعرات ${formatNumber(food.calories)}, بروتين ${formatNumber(food.protein)}g, كارب ${formatNumber(food.carbs)}g, دهون ${formatNumber(food.fat)}g, كارديو ${formatNumber(cardio)} cal, مقاومة: ${dayResistance(date) ? "نعم" : "لا"}, الحالة: ${insight.issues.join(" / ")}`;
  }).join("\n");
  const mealsToday = state.foodLogs
    .filter((entry) => entry.date === activeDate)
    .map((entry) => {
      const source = entry.sourceType === "meal" ? state.meals.find((item) => item.id === entry.itemId) : state.foods.find((item) => item.id === entry.itemId);
      const macros = entryMacros(entry);
      return `- ${entry.slot}: ${source?.name || "صنف محذوف"}، ${entry.grams}g، ${formatNumber(macros.calories)} سعرة، P ${formatNumber(macros.protein)}g / C ${formatNumber(macros.carbs)}g / F ${formatNumber(macros.fat)}g`;
    }).join("\n") || "- لا توجد وجبات مسجلة اليوم.";
  return `تقرير متابعة الجسم والتغذية
التاريخ النشط: ${activeDate}

الأهداف:
- سعرات المحافظة: ${formatNumber(state.settings.maintenance)}
- السعرات اليومية المستهدفة: ${formatNumber(state.settings.targetCalories)}
- هدف البروتين: ${formatNumber(state.settings.proteinGoal)}g
- الحد الأدنى للبروتين: ${formatNumber(state.settings.minProtein)}g
- هدف الكارب: ${formatNumber(state.settings.carbsGoal)}g
- هدف الدهون: ${formatNumber(state.settings.fatGoal)}g
- حد الدهون الأعلى: ${formatNumber(state.settings.maxFat)}g
- هدف الكارديو الأسبوعي: ${formatNumber(state.settings.weeklyCardioGoal)} cal

اليوم:
- السعرات: ${formatNumber(today.calories)} / ${formatNumber(state.settings.targetCalories)}
- البروتين: ${formatNumber(today.protein)}g
- الكارب: ${formatNumber(today.carbs)}g
- الدهون: ${formatNumber(today.fat)}g
- الكارديو: ${formatNumber(dayCardio())} cal
- تمرين مقاومة: ${dayResistance() ? "نعم" : "لا"}
- العجز التقريبي: ${formatNumber(dayDeficit())}

وجبات اليوم:
${mealsToday}

ملخص الأسبوع:
- أيام الالتزام: ${adherence} / 7
- إجمالي السعرات المأكولة: ${formatNumber(week.actualCalories)}
- إجمالي الكارديو: ${formatNumber(week.cardio)} cal
- جلسات المقاومة: ${resistanceSessionsThisWeek()}
- العجز الأسبوعي التقريبي: ${formatNumber(week.deficit)}
- متوسط البروتين: ${formatNumber(weekProteinAverage())}g

تفاصيل أيام الأسبوع:
${dayLines}

القياسات:
- آخر وزن: ${latest?.weight ? `${latest.weight} kg` : "غير مسجل"}
- آخر خصر: ${latest?.waist ? `${latest.waist} cm` : "غير مسجل"}
- القياس السابق: ${previous ? `${previous.weight} kg، خصر ${previous.waist} cm بتاريخ ${previous.date}` : "غير متوفر"}

المطلوب من التحليل:
حلل الالتزام، اذكر أين النقص أو الزيادة، واقترح تعويضاً أسبوعياً عملياً للبروتين والسعرات والكارديو مع مراعاة خسارة الدهون والمحافظة على العضلات.`;
}

function exportBackup() {
  const payload = {
    app: "healthtrackker",
    version: 1,
    exportedAt: new Date().toISOString(),
    state: stripStoredPhotos(state),
  };
  const raw = JSON.stringify(payload, null, 2);
  writeStateBackup(JSON.stringify(payload.state));
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `healthtrackker-backup-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importBackup() {
  const file = document.querySelector("#backupImportFile")?.files?.[0];
  if (!file) {
    alert("اختر ملف النسخة الاحتياطية أولاً.");
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const snapshot = parsed.state || parsed;
    const raw = JSON.stringify(snapshot);
    const before = recoveryCandidates;
    recoveryCandidates = [{ source: file.name, raw, snapshot, summary: snapshotSummary(snapshot) }];
    mergeRecoveryCandidate(0);
    recoveryCandidates = before;
    render();
  } catch {
    alert("تعذر قراءة ملف النسخة الاحتياطية.");
  }
}

async function replaceBackup() {
  const file = document.querySelector("#backupImportFile")?.files?.[0];
  if (!file) {
    alert("اختر ملف النسخة الاحتياطية أولاً.");
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const snapshot = parsed.state || parsed;
    replaceStateFromSnapshot(snapshot, file.name);
  } catch {
    alert("تعذر قراءة ملف النسخة الاحتياطية.");
  }
}

function restoreBundledBackup() {
  const snapshot = window.HEALTHTRACKKER_BUNDLED_RESTORE?.state;
  if (!snapshot || meaningfulDataCount(snapshot) === 0) {
    alert("لم أجد نسخة بيانات مدمجة داخل هذا الإصدار.");
    return;
  }
  replaceStateFromSnapshot(snapshot, "نسخة بيانات 8 يوليو");
}

async function copyAIReport() {
  const report = generateAIReport();
  const box = document.querySelector("#aiReportText");
  if (box) box.value = report;
  try {
    await navigator.clipboard.writeText(report);
    alert("تم نسخ التقرير.");
  } catch {
    const temp = document.createElement("textarea");
    temp.value = report;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    alert("تم تجهيز التقرير للنسخ.");
  }
}

function saveApiSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (data.usda) localStorage.setItem("USDA_API_KEY", data.usda);
  if (data.openai) localStorage.setItem("OPENAI_API_KEY", data.openai);
  render();
}

function aiContext() {
  const week = weekStats();
  const logs = [...state.progressLogs].sort(byDate);
  return {
    date: activeDate,
    settings: state.settings,
    today: dayFood(),
    cardioToday: dayCardio(),
    resistanceToday: Boolean(dayResistance()),
    resistanceThisWeek: resistanceSessionsThisWeek(),
    dailyDeficit: dayDeficit(),
    week,
    latestProgress: logs.at(-1) || null,
    previousProgress: logs.at(-2) || null,
    foodsLoggedToday: state.foodLogs.filter((entry) => entry.date === activeDate).map((entry) => ({ ...entry, macros: entryMacros(entry) })),
  };
}

function renderAICoach() {
  const today = dayFood();
  const decision = dailyDecision(today, dayCardio());
  const hasOpenAIKey = Boolean(localStorage.getItem("OPENAI_API_KEY"));
  document.querySelector("#ai-coach").innerHTML = `
    <div class="split-title"><h2>المدرب الذكي</h2><span class="pill info">تحليل التغذية</span></div>
    <section class="ai-command">
      <div>
        <span class="hero-label">${hasOpenAIKey ? "ChatGPT متصل" : "تحليل محلي"}</span>
        <h3>${decision.title}</h3>
        <p>${decision.text}</p>
      </div>
      <button class="command-button" type="button" data-ai-task="dailyCoach">${hasOpenAIKey ? "حلل بـ ChatGPT" : "حلل يومي"}</button>
    </section>
    ${hasOpenAIKey ? "" : `
      <section class="alert warn">
        يعمل المدرب الآن بوضع محلي مختصر. لإجابات أذكى، أضف مفتاح OpenAI من مركز التحكم.
        <button class="btn secondary inline-action" type="button" data-action="focus-api-settings">ربط ChatGPT</button>
      </section>
    `}
    <section class="coach-command-grid">
      <button class="quick-action" data-ai-task="dailyCoach" type="button"><span>${icon("coach")}</span>قرار اليوم</button>
      <button class="quick-action secondary" data-ai-task="weeklyAnalysis" type="button"><span>${icon("trending")}</span>تحليل الأسبوع</button>
      <button class="quick-action secondary" data-ai-task="progressAnalysis" type="button"><span>${icon("scale")}</span>تحليل التقدم</button>
      <button class="quick-action secondary" data-ai-task="mealSuggestions" type="button"><span>${icon("chef")}</span>أفكار وجبات</button>
    </section>
    <form class="panel" id="aiQuestionForm">
      <div class="field">
        <label>اسأل المدرب</label>
        <textarea class="textarea" name="question" placeholder="مثال: عندي عزيمة الليلة، ماذا آكل؟"></textarea>
      </div>
      <div class="actions">
        <button class="btn" type="submit">اسأل</button>
        <button class="btn secondary" type="button" data-ai-task="foodAdvisor" data-ai-question="عندي عزيمة">مستشار وجبة</button>
      </div>
    </form>
    <article class="coach-card ai-response">
      <div class="coach-avatar">${icon("spark")}</div>
      <div>
        <span class="hero-label">رد المدرب</span>
        <h3>${aiLastResponse ? "آخر تحليل" : "جاهز للتحليل"}</h3>
        <p id="aiResponse">${aiLastResponse || "اضغط على أحد الأزرار أو اكتب سؤالاً. إذا لم تضف مفتاح OpenAI سيظهر تحليل محلي مبسط."}</p>
      </div>
    </article>
  `;
  document.querySelector("#aiQuestionForm")?.addEventListener("submit", askAIQuestion);
}

async function runAITask(task, question = "") {
  const responseBox = document.querySelector("#aiResponse");
  if (responseBox) responseBox.innerHTML = `<span class="loader"></span> المدرب يحلل بياناتك...`;
  try {
    const service = window.OpenAIService;
    const context = aiContext();
    if (task === "dailyCoach") aiLastResponse = await service.dailyCoach(context);
    if (task === "weeklyAnalysis") aiLastResponse = await service.weeklyAnalysis(context);
    if (task === "progressAnalysis") aiLastResponse = await service.progressAnalysis(context);
    if (task === "mealSuggestions") aiLastResponse = await service.mealSuggestions(context);
    if (task === "foodAdvisor") aiLastResponse = await service.foodAdvisor(context, question || "عندي عزيمة");
    if (task === "questionAnswer") aiLastResponse = await service.questionAnswer(context, question);
  } catch (error) {
    aiLastResponse = error.message || "تعذر تشغيل المدرب الذكي.";
  }
  renderAICoach();
}

function askAIQuestion(event) {
  event.preventDefault();
  const question = new FormData(event.currentTarget).get("question");
  runAITask("questionAnswer", question);
}

function settingInput(name, label, value) {
  return `<div class="field"><label>${label}</label><input class="input" name="${name}" type="number" step="0.1" value="${value}" /></div>`;
}

function saveSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const nextSettings = { ...state.settings };
  Object.keys(defaultState.settings).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return;
    nextSettings[key] = finiteSetting(data[key], nextSettings[key]);
  });
  state.settings = normalizeSettings(nextSettings);
  compactLocalStorage();
  const settingsSaved = saveSettingsOnly(state.settings);
  const stateSaved = saveState();
  alert(settingsSaved ? "تم حفظ الإعدادات." : "لم يتم حفظ الإعدادات. إذا كنت تستخدم Safari، اضغط Reduce Protections أو افتح الرابط في Safari مباشرة.");
  render();
}

function drawChart(canvasId, points, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const gradient = ctx.createLinearGradient(0, 0, rect.width, 0);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(255,255,255,0.75)");
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = 28 + i * ((rect.height - 56) / 3);
    ctx.beginPath();
    ctx.moveTo(18, y);
    ctx.lineTo(rect.width - 12, y);
    ctx.stroke();
  }
  if (points.length < 2) {
    ctx.fillStyle = "rgba(244,251,248,0.62)";
    ctx.font = "13px system-ui";
    ctx.fillText("أضف قياسين أو أكثر لظهور الرسم", 22, rect.height / 2);
    return;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xFor = (index) => 24 + index * ((rect.width - 48) / (points.length - 1));
  const yFor = (value) => 24 + (max - value) * ((rect.height - 52) / span);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  points.forEach((point, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xFor(index), yFor(point.value), 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function seedDemo() {
  const dates = getWeekDates();
  const chicken = state.foods.find((item) => item.name === "صدر دجاج");
  const rice = state.foods.find((item) => item.name === "رز أبيض");
  state.foodLogs = state.foodLogs.concat(dates.slice(0, 5).flatMap((date, index) => [
    { id: crypto.randomUUID(), date, slot: "الغداء", sourceType: "food", itemId: chicken.id, grams: 240, sauceId: "", sauceGrams: 0, notes: "" },
    { id: crypto.randomUUID(), date, slot: "الغداء", sourceType: "food", itemId: rice.id, grams: 180 + index * 10, sauceId: state.sauces[0].id, sauceGrams: 35, notes: "" },
  ]));
  state.cardioLogs = state.cardioLogs.concat(dates.slice(0, 4).map((date) => ({ id: crypto.randomUUID(), date, type: "مشي سريع", minutes: 45, calories: 320, notes: "" })));
  state.progressLogs = state.progressLogs.concat([
    { id: crypto.randomUUID(), date: dates[0], weight: 91.2, waist: 101, notes: "بداية" },
    { id: crypto.randomUUID(), date: dates[3], weight: 90.8, waist: 100.2, notes: "" },
    { id: crypto.randomUUID(), date: dates[6], weight: 90.7, waist: 99.4, notes: "الخصر نازل" },
  ]);
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.view) {
    setView(target.dataset.view);
    return;
  }
  if (target.dataset.aiTask) {
    runAITask(target.dataset.aiTask, target.dataset.aiQuestion || "");
    return;
  }
  if (!isCommandButton(target)) return;
  handleAction(target);
});

function isCommandButton(target) {
  const commandKeys = [
    "action",
    "editLog",
    "deleteLog",
    "repeatLog",
    "importFood",
    "editFood",
    "deleteFood",
    "editSauce",
    "deleteSauce",
    "editMeal",
    "deleteMeal",
    "removeComponent",
    "deleteProgress",
    "deleteCardio",
    "restoreSnapshot",
    "setDate",
    "addImportedToday",
  ];
  return commandKeys.some((key) => target.dataset[key] !== undefined);
}

function handleAction(target) {
  const action = target.dataset.action;
  if (action === "open-quick-add") {
    openQuickAdd();
    return;
  }
  if (action === "close-quick-add") {
    closeQuickAdd();
    return;
  }
  if (action === "show-insight") {
    activeDashboardInsight = target.dataset.insight || "consistency";
    render();
    requestAnimationFrame(() => document.querySelector("#dashboardInsight")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (action === "close-insight") {
    activeDashboardInsight = "";
    render();
    return;
  }
  if (action === "export-backup") {
    exportBackup();
    return;
  }
  if (action === "import-backup") {
    importBackup();
    return;
  }
  if (action === "replace-backup") {
    replaceBackup();
    return;
  }
  if (action === "restore-bundled") {
    restoreBundledBackup();
    return;
  }
  if (action === "copy-ai-report") {
    copyAIReport();
    return;
  }
  if (action === "quick-cardio") {
    closeQuickAdd();
    setView("food-log");
    requestAnimationFrame(() => document.querySelector("#dailyCardioForm")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (action === "quick-food-search") {
    closeQuickAdd();
    setView("add");
    requestAnimationFrame(() => document.querySelector("#usdaSearchInput")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (action === "quick-weight") {
    closeQuickAdd();
    setView("add");
    requestAnimationFrame(() => document.querySelector("#addProgressForm")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (action === "toggle-resistance") {
    toggleResistance();
    return;
  }
  if (action === "focus-api-settings") {
    const details = document.querySelector("#apiSettings");
    if (details) details.open = true;
    details?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "lookup-barcode") {
    lookupBarcode(document.querySelector("#manualBarcode")?.value || "");
    return;
  }
  if (action === "start-barcode") {
    const video = document.querySelector("#barcodeVideo");
    const stateBox = document.querySelector("#barcodeState");
    if (stateBox) stateBox.innerHTML = `<span class="loader"></span> افتح الكاميرا ووجهها للباركود...`;
    window.BarcodeService.scanUntilFound(video, (code) => {
      const input = document.querySelector("#manualBarcode");
      if (input) input.value = code;
      lookupBarcode(code);
    }, (error) => {
      if (stateBox) stateBox.textContent = error.message || "تعذر تشغيل الكاميرا.";
    });
    return;
  }
  if (action === "stop-barcode") {
    window.BarcodeService.stop();
    const stateBox = document.querySelector("#barcodeState");
    if (stateBox) stateBox.textContent = "تم إيقاف الكاميرا.";
    return;
  }
  if (target.dataset.editLog) editing.foodLog = target.dataset.editLog;
  if (target.dataset.deleteLog) state.foodLogs = state.foodLogs.filter((item) => item.id !== target.dataset.deleteLog);
  if (target.dataset.repeatLog) {
    const original = state.foodLogs.find((item) => item.id === target.dataset.repeatLog);
    if (original) state.foodLogs.push({ ...original, id: crypto.randomUUID(), date: activeDate });
  }
  if (target.dataset.importFood) {
    const item = findImportedFood(target.dataset.importFood);
    if (item) {
      state.foods.push(foodFromExternal(item));
      render();
      setView("food-log");
      return;
    }
  }
  if (target.dataset.addImportedToday) {
    const item = findImportedFood(target.dataset.addImportedToday);
    if (item) {
      addImportedFoodToToday(item);
      return;
    }
  }
  if (target.dataset.editFood) editing.food = target.dataset.editFood;
  if (target.dataset.deleteFood) state.foods = state.foods.filter((item) => item.id !== target.dataset.deleteFood);
  if (target.dataset.editSauce) editing.sauce = target.dataset.editSauce;
  if (target.dataset.deleteSauce) state.sauces = state.sauces.filter((item) => item.id !== target.dataset.deleteSauce);
  if (target.dataset.editMeal) {
    const meal = state.meals.find((item) => item.id === target.dataset.editMeal);
    editing.meal = meal.id;
    editing.components = structuredClone(meal.components);
  }
  if (target.dataset.deleteMeal) state.meals = state.meals.filter((item) => item.id !== target.dataset.deleteMeal);
  if (target.dataset.removeComponent) editing.components.splice(Number(target.dataset.removeComponent), 1);
  if (target.dataset.deleteProgress) state.progressLogs = state.progressLogs.filter((item) => item.id !== target.dataset.deleteProgress);
  if (target.dataset.deleteCardio) state.cardioLogs = state.cardioLogs.filter((item) => item.id !== target.dataset.deleteCardio);
  if (target.dataset.restoreSnapshot) mergeRecoveryCandidate(target.dataset.restoreSnapshot);
  if (target.dataset.setDate) {
    activeDate = target.dataset.setDate;
    activeDateInput.value = activeDate;
    setView("food-log");
    return;
  }
  if (action === "cancel-edit") editing.foodLog = null;
  if (action === "cancel-food-db") editing.food = null;
  if (action === "cancel-sauce-db") editing.sauce = null;
  if (action === "cancel-meal") { editing.meal = null; editing.components = []; }
  if (action === "add-component") {
    const source = document.querySelector("#componentSource").value;
    const grams = Number(document.querySelector("#componentGrams").value);
    const [type, itemId] = source.split(":");
    editing.components = editing.components || [];
    editing.components.push({ type, itemId, grams });
  }
  if (action === "save-day") {
    const entries = state.foodLogs.filter((entry) => entry.date === activeDate);
    state.savedDays.push({ id: crypto.randomUUID(), name: `يوم ${activeDate}`, entries });
  }
  if (action === "copy-active-day") copyActiveDayToTarget();
  if (action === "apply-saved-day") applySavedDay();
  if (action === "delete-saved-day") deleteSavedDay();
  if (action === "focus-cardio") {
    document.querySelector("#addCardioForm, #dailyCardioForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "focus-weight") {
    document.querySelector("#addProgressForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "seed-demo") seedDemo();
  if (action === "reset-data" && confirm("تأكيد تصفير كل بيانات التطبيق؟")) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    state = structuredClone(defaultState);
  }
  render();
}

function copyActiveDayToTarget() {
  const targetDate = document.querySelector("#copyTargetDate")?.value;
  if (!targetDate) return;
  const copied = state.foodLogs
    .filter((entry) => entry.date === activeDate)
    .map((entry) => ({ ...entry, id: crypto.randomUUID(), date: targetDate }));
  state.foodLogs = state.foodLogs.concat(copied);
}

function applySavedDay() {
  const savedId = document.querySelector("#savedDaySelect")?.value;
  const saved = state.savedDays.find((day) => day.id === savedId);
  if (!saved) return;
  const copied = saved.entries.map((entry) => ({ ...entry, id: crypto.randomUUID(), date: activeDate }));
  state.foodLogs = state.foodLogs.concat(copied);
}

function deleteSavedDay() {
  const savedId = document.querySelector("#savedDaySelect")?.value;
  if (!savedId) return;
  state.savedDays = state.savedDays.filter((day) => day.id !== savedId);
}

activeDateInput.addEventListener("change", (event) => {
  activeDate = event.target.value;
  render();
});

window.addEventListener("resize", () => {
  if (document.querySelector("#progress.active")) renderProgress();
});

render();
