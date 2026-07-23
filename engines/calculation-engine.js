(function (global) {
  const DAY_MS = 86400000;
  const FAT_CALORIES_PER_KG = 7700;

  const ACTIVITY_FACTORS = {
    sedentary: 1.2,
    light: 1.35,
    moderate: 1.5,
    active: 1.7,
    athlete: 1.9,
  };

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round(toNumber(value) * factor) / factor;
  }

  function dateFromISO(dateISO) {
    return new Date(`${dateISO}T12:00:00`);
  }

  function diffDays(startISO, endISO) {
    return Math.round((dateFromISO(endISO) - dateFromISO(startISO)) / DAY_MS);
  }

  function addDays(dateISO, days) {
    const date = dateFromISO(dateISO);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function isFutureDate(dateISO, currentISO = todayISO()) {
    return Boolean(dateISO && dateISO > currentISO);
  }

  function rangeDates(startISO, endISO) {
    const dates = [];
    if (!startISO || !endISO || startISO > endISO) return dates;
    for (let date = startISO; date <= endISO; date = addDays(date, 1)) dates.push(date);
    return dates;
  }

  function getWeekStart(dateISO, weekStartsOn = 0) {
    const date = dateFromISO(dateISO);
    const day = date.getDay();
    const target = clamp(toNumber(weekStartsOn, 0), 0, 6);
    const diff = (day - target + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  }

  function getWeekDates(dateISO, weekStartsOn = 0, currentISO = todayISO()) {
    const start = getWeekStart(dateISO, weekStartsOn);
    return rangeDates(start, addDays(start, 6)).filter((date) => date <= currentISO);
  }

  function getMonthDates(dateISO, currentISO = todayISO()) {
    const date = dateFromISO(dateISO);
    const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    const end = endDate.toISOString().slice(0, 10);
    return rangeDates(start, end).filter((day) => day <= currentISO);
  }

  function getYearDates(dateISO, currentISO = todayISO()) {
    const year = dateISO.slice(0, 4);
    return rangeDates(`${year}-01-01`, `${year}-12-31`).filter((day) => day <= currentISO);
  }

  function average(values) {
    const clean = values.map((value) => toNumber(value, NaN)).filter(Number.isFinite);
    if (!clean.length) return null;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  }

  function sum(values) {
    return values.reduce((total, value) => total + toNumber(value), 0);
  }

  function settingsForDate(state, dateISO) {
    const current = state?.settings || {};
    const history = Array.isArray(state?.targetHistory) ? state.targetHistory : [];
    const snapshots = history
      .filter((item) => item?.effectiveFrom && item.effectiveFrom <= dateISO && item.settings)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return { ...current, ...(snapshots.at(-1)?.settings || {}) };
  }

  function sourceCollections(state) {
    return {
      foods: Array.isArray(state?.foods) ? state.foods : [],
      sauces: Array.isArray(state?.sauces) ? state.sauces : [],
      meals: Array.isArray(state?.meals) ? state.meals : [],
    };
  }

  function macroFromItem(item, grams) {
    const factor = toNumber(grams) / 100;
    return {
      calories: toNumber(item?.calories) * factor,
      protein: toNumber(item?.protein) * factor,
      carbs: toNumber(item?.carbs) * factor,
      fat: toNumber(item?.fat) * factor,
    };
  }

  function addMacros(items) {
    return items.reduce((total, item) => ({
      calories: total.calories + toNumber(item?.calories),
      protein: total.protein + toNumber(item?.protein),
      carbs: total.carbs + toNumber(item?.carbs),
      fat: total.fat + toNumber(item?.fat),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  function mealMacros(state, meal, grams = 100) {
    const { foods, sauces } = sourceCollections(state);
    const components = Array.isArray(meal?.components) ? meal.components : [];
    const base = addMacros(components.map((component) => {
      const source = component.type === "sauce"
        ? sauces.find((item) => item.id === component.itemId)
        : foods.find((item) => item.id === component.itemId);
      return macroFromItem(source, component.grams);
    }));
    const totalGrams = sum(components.map((item) => item.grams)) || 100;
    const factor = toNumber(grams) / totalGrams;
    return {
      calories: base.calories * factor,
      protein: base.protein * factor,
      carbs: base.carbs * factor,
      fat: base.fat * factor,
    };
  }

  function entryMacros(state, entry) {
    const { foods, sauces, meals } = sourceCollections(state);
    const source = entry?.sourceType === "meal"
      ? meals.find((item) => item.id === entry.itemId)
      : foods.find((item) => item.id === entry?.itemId);
    const main = entry?.sourceType === "meal" ? mealMacros(state, source, entry.grams) : macroFromItem(source, entry?.grams);
    const sauce = sauces.find((item) => item.id === entry?.sauceId);
    return addMacros([main, macroFromItem(sauce, entry?.sauceGrams)]);
  }

  function foodEntriesForDate(state, dateISO, currentISO = todayISO()) {
    if (isFutureDate(dateISO, currentISO)) return [];
    return (Array.isArray(state?.foodLogs) ? state.foodLogs : []).filter((entry) => entry.date === dateISO);
  }

  function dayFood(state, dateISO, currentISO = todayISO()) {
    return addMacros(foodEntriesForDate(state, dateISO, currentISO).map((entry) => entryMacros(state, entry)));
  }

  function dayCardio(state, dateISO, currentISO = todayISO()) {
    if (isFutureDate(dateISO, currentISO)) return 0;
    const seen = new Set();
    return (Array.isArray(state?.cardioLogs) ? state.cardioLogs : [])
      .filter((entry) => entry.date === dateISO)
      .reduce((total, entry, index) => {
        const key = entry.id || `${entry.date}:${entry.type}:${entry.minutes}:${entry.calories}:${index}`;
        if (seen.has(key)) return total;
        seen.add(key);
        return total + toNumber(entry.calories);
      }, 0);
  }

  function resistanceSessions(state, dates) {
    const dateSet = new Set(dates);
    const seen = new Set();
    return (Array.isArray(state?.resistanceLogs) ? state.resistanceLogs : []).filter((entry, index) => {
      if (!entry?.done || !dateSet.has(entry.date)) return false;
      const key = entry.id || `${entry.date}:${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).length;
  }

  function latestMeasurementByDate(state) {
    const map = new Map();
    (Array.isArray(state?.progressLogs) ? state.progressLogs : []).forEach((entry, index) => {
      if (!entry?.date) return;
      map.set(entry.date, { ...entry, _index: index });
    });
    return map;
  }

  function measurementsForDates(state, dates) {
    const dateSet = new Set(dates);
    return [...latestMeasurementByDate(state).values()]
      .filter((entry) => dateSet.has(entry.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a._index - b._index);
  }

  function latestMeasurementOnOrBefore(state, dateISO) {
    return [...latestMeasurementByDate(state).values()]
      .filter((entry) => entry.date <= dateISO)
      .sort((a, b) => a.date.localeCompare(b.date) || a._index - b._index)
      .at(-1) || null;
  }

  function macroDistribution(food) {
    const proteinCalories = toNumber(food?.protein) * 4;
    const carbsCalories = toNumber(food?.carbs) * 4;
    const fatCalories = toNumber(food?.fat) * 9;
    const macroCalories = proteinCalories + carbsCalories + fatCalories;
    return {
      protein: macroCalories ? (proteinCalories / macroCalories) * 100 : 0,
      carbs: macroCalories ? (carbsCalories / macroCalories) * 100 : 0,
      fat: macroCalories ? (fatCalories / macroCalories) * 100 : 0,
    };
  }

  function targetMacroDistribution(settings) {
    return macroDistribution({
      protein: settings?.proteinGoal,
      carbs: settings?.carbsGoal,
      fat: settings?.fatGoal,
    });
  }

  function adherencePercent(actual, target, inverse = false) {
    if (!target) return null;
    const ratio = inverse ? target / Math.max(actual, 1) : actual / target;
    return clamp(ratio * 100, 0, 100);
  }

  function calculateBMR(settings, weight) {
    const bodyWeight = toNumber(weight || settings?.goalWeight);
    const height = toNumber(settings?.heightCm, 170);
    const age = toNumber(settings?.age, 30);
    const sex = settings?.sex === "female" ? "female" : "male";
    if (!bodyWeight || !height || !age) return null;
    const base = (10 * bodyWeight) + (6.25 * height) - (5 * age);
    return sex === "female" ? base - 161 : base + 5;
  }

  function activityFactor(settings) {
    const value = settings?.activityLevel;
    if (typeof value === "string" && ACTIVITY_FACTORS[value]) return ACTIVITY_FACTORS[value];
    return clamp(toNumber(value, 1.35), 1.1, 2.2);
  }

  function loggedFoodDates(state, dates, currentISO = todayISO()) {
    const dateSet = new Set(dates.filter((date) => date <= currentISO));
    return [...new Set((Array.isArray(state?.foodLogs) ? state.foodLogs : [])
      .filter((entry) => dateSet.has(entry.date))
      .map((entry) => entry.date))]
      .sort();
  }

  function cardioDates(state, dates, currentISO = todayISO()) {
    const dateSet = new Set(dates.filter((date) => date <= currentISO));
    return [...new Set((Array.isArray(state?.cardioLogs) ? state.cardioLogs : [])
      .filter((entry) => dateSet.has(entry.date))
      .map((entry) => entry.date))]
      .sort();
  }

  function periodNutrition(state, dates, currentISO = todayISO()) {
    const foodDates = loggedFoodDates(state, dates, currentISO);
    const daily = foodDates.map((date) => ({ date, food: dayFood(state, date, currentISO) }));
    return {
      loggedDays: foodDates.length,
      totals: addMacros(daily.map((item) => item.food)),
      averages: {
        calories: average(daily.map((item) => item.food.calories)),
        protein: average(daily.map((item) => item.food.protein)),
        carbs: average(daily.map((item) => item.food.carbs)),
        fat: average(daily.map((item) => item.food.fat)),
      },
      daily,
    };
  }

  function periodCardio(state, dates, currentISO = todayISO()) {
    const cleanDates = dates.filter((date) => date <= currentISO);
    const total = sum(cleanDates.map((date) => dayCardio(state, date, currentISO)));
    const days = cardioDates(state, cleanDates, currentISO);
    return {
      total,
      loggedDays: days.length,
      average: days.length ? total / days.length : null,
      daily: cleanDates.map((date) => ({ date, calories: dayCardio(state, date, currentISO) })),
    };
  }

  function observedTDEEForPeriod(state, dates, currentISO = todayISO()) {
    const settings = settingsForDate(state, dates.at(-1) || currentISO);
    const nutrition = periodNutrition(state, dates, currentISO);
    const measurements = measurementsForDates(state, dates);
    if (nutrition.loggedDays < 4 || measurements.length < 2) return null;
    const first = measurements[0];
    const last = measurements.at(-1);
    const spanDays = Math.max(1, diffDays(first.date, last.date));
    if (spanDays < 5) return null;
    const cardio = periodCardio(state, dates, currentISO);
    const averageCalories = nutrition.averages.calories || 0;
    const averageCardio = cardio.total / Math.max(1, nutrition.loggedDays);
    const weightChange = toNumber(last.weight) - toNumber(first.weight);
    const observedDailyDeficit = (-weightChange * FAT_CALORIES_PER_KG) / spanDays;
    const observed = averageCalories - averageCardio + observedDailyDeficit;
    const plausible = observed > 900 && observed < 6000;
    if (!plausible) return null;
    const bmr = calculateBMR(settings, last.weight);
    return {
      value: observed,
      averageCalories,
      averageCardio,
      observedDailyDeficit,
      weightChange,
      spanDays,
      bmr,
      confidence: clamp((nutrition.loggedDays / dates.length) * 45 + Math.min(35, spanDays * 2) + Math.min(20, measurements.length * 5), 0, 100),
    };
  }

  function estimateTDEE(state, dateISO, currentISO = todayISO()) {
    const date = dateISO > currentISO ? currentISO : dateISO;
    const settings = settingsForDate(state, date);
    const latest = latestMeasurementOnOrBefore(state, date);
    const weight = latest?.weight || settings.goalWeight;
    const bmr = calculateBMR(settings, weight);
    const weekDates = rangeDates(addDays(date, -13), date).filter((day) => day <= currentISO);
    const previousDates = rangeDates(addDays(date, -27), addDays(date, -14)).filter((day) => day <= currentISO);
    const currentObserved = observedTDEEForPeriod(state, weekDates, currentISO);
    const previousObserved = observedTDEEForPeriod(state, previousDates, currentISO);
    const resistancePerWeek = resistanceSessions(state, weekDates) / Math.max(1, weekDates.length / 7);
    const trainingAdjustment = Math.min(120, resistancePerWeek * 20);
    const formula = bmr ? (bmr * activityFactor(settings)) + trainingAdjustment : null;
    const observedConfidence = currentObserved?.confidence || 0;
    const observedWeight = observedConfidence / 100;
    const value = currentObserved && formula
      ? (currentObserved.value * observedWeight) + (formula * (1 - observedWeight))
      : currentObserved?.value || formula || toNumber(settings.maintenance);
    const previousValue = previousObserved?.value || formula || toNumber(settings.maintenance);
    const confidence = clamp((observedConfidence || 35) + (latest ? 10 : 0), 0, 100);
    return {
      bmr,
      estimatedTDEE: value,
      previousTDEE: previousValue,
      difference: value - previousValue,
      confidence,
      method: currentObserved ? "trend_blend" : "formula",
      observed: currentObserved,
      formula,
      weight,
      activityFactor: activityFactor(settings),
      resistancePerWeek,
    };
  }

  function dailyReport(state, dateISO, currentISO = todayISO()) {
    const future = isFutureDate(dateISO, currentISO);
    const settings = settingsForDate(state, dateISO);
    const tdee = estimateTDEE(state, dateISO, currentISO);
    const food = future ? { calories: 0, protein: 0, carbs: 0, fat: 0 } : dayFood(state, dateISO, currentISO);
    const cardio = future ? 0 : dayCardio(state, dateISO, currentISO);
    const measurement = future ? null : latestMeasurementOnOrBefore(state, dateISO);
    const distribution = macroDistribution(food);
    const targetDistribution = targetMacroDistribution(settings);
    const caloriesRemaining = Math.max(0, toNumber(settings.targetCalories) - food.calories);
    const estimatedIfStopsNow = tdee.estimatedTDEE - food.calories + cardio;
    const estimatedIfTarget = tdee.estimatedTDEE - toNumber(settings.targetCalories) + cardio;
    const finalDailyDeficit = dateISO < currentISO ? estimatedIfStopsNow : null;
    const cardioDailyGoal = toNumber(settings.weeklyCardioGoal) / 7;
    const adherence = {
      calories: adherencePercent(food.calories, settings.targetCalories, true),
      protein: adherencePercent(food.protein, settings.proteinGoal),
      carbs: adherencePercent(food.carbs, settings.carbsGoal),
      fat: adherencePercent(food.fat, settings.fatGoal, true),
      cardio: adherencePercent(cardio, cardioDailyGoal),
    };
    adherence.overall = average(Object.values(adherence).filter((value) => value !== null)) || 0;
    return {
      date: dateISO,
      isFuture: future,
      goals: {
        maintenanceCalories: settings.maintenance,
        estimatedTDEE: tdee.estimatedTDEE,
        previousTDEE: tdee.previousTDEE,
        tdeeDifference: tdee.difference,
        tdeeConfidence: tdee.confidence,
        bmr: tdee.bmr,
        targetCalories: settings.targetCalories,
        proteinTarget: settings.proteinGoal,
        proteinMinimum: settings.minProtein,
        carbTarget: settings.carbsGoal,
        fatTarget: settings.fatGoal,
        weeklyCardioGoal: settings.weeklyCardioGoal,
      },
      summary: {
        caloriesConsumed: food.calories,
        caloriesRemaining,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        cardio,
        resistanceTraining: resistanceSessions(state, [dateISO]) > 0,
        weight: measurement?.weight || null,
        waist: measurement?.waist || null,
      },
      macroDistribution: distribution,
      targetMacroDistribution: targetDistribution,
      adherence,
      deficit: {
        caloriesRemaining,
        estimatedIfStopsNow,
        estimatedIfTarget,
        finalDailyDeficit,
      },
      tdee,
    };
  }

  function progressForMeasurements(measurements) {
    const first = measurements[0] || null;
    const latest = measurements.at(-1) || null;
    return {
      first,
      latest,
      weightChange: first && latest ? toNumber(latest.weight) - toNumber(first.weight) : null,
      waistChange: first && latest ? toNumber(latest.waist) - toNumber(first.waist) : null,
    };
  }

  function scoreReports(report) {
    const nutrition = average([
      report.averageCalories ? adherencePercent(report.averageCalories, report.targetCalories, true) : null,
      report.averageFat ? adherencePercent(report.averageFat, report.fatTarget, true) : null,
      report.averageCarbs ? adherencePercent(report.averageCarbs, report.carbTarget) : null,
    ].filter((value) => value !== null)) || 0;
    const protein = adherencePercent(report.averageProtein, report.proteinTarget) || 0;
    const cardioTarget = toNumber(report.weeklyCardioGoal) * Math.max(1, report.periodDays / 7);
    const cardio = adherencePercent(report.cardioTotal, cardioTarget) || 0;
    const training = clamp((report.resistanceSessions / Math.max(1, report.periodDays / 7)) * 25, 0, 100);
    const consistency = report.periodDays ? clamp((report.loggedNutritionDays / report.periodDays) * 100, 0, 100) : 0;
    const recovery = report.measurementCount ? 75 : 50;
    const overall = average([nutrition, protein, cardio, training, recovery, consistency]) || 0;
    return { nutrition, protein, training, cardio, recovery, consistency, overall };
  }

  function periodReport(state, dates, currentISO = todayISO(), label = "period") {
    const cleanDates = dates.filter((date) => date <= currentISO);
    const settings = settingsForDate(state, cleanDates.at(-1) || currentISO);
    const nutrition = periodNutrition(state, cleanDates, currentISO);
    const cardio = periodCardio(state, cleanDates, currentISO);
    const measurements = measurementsForDates(state, cleanDates);
    const progress = progressForMeasurements(measurements);
    const tdee = estimateTDEE(state, cleanDates.at(-1) || currentISO, currentISO);
    const calorieTargetTotal = toNumber(settings.targetCalories) * nutrition.loggedDays;
    const estimatedDeficit = nutrition.loggedDays
      ? (tdee.estimatedTDEE * nutrition.loggedDays) - nutrition.totals.calories + cardio.total
      : 0;
    const expectedFatLoss = estimatedDeficit / FAT_CALORIES_PER_KG;
    const estimatedFatLoss = progress.weightChange !== null ? Math.max(0, -progress.weightChange) : null;
    const report = {
      label,
      dates: cleanDates,
      start: cleanDates[0] || null,
      end: cleanDates.at(-1) || null,
      periodDays: cleanDates.length,
      loggedNutritionDays: nutrition.loggedDays,
      targetCalories: settings.targetCalories,
      proteinTarget: settings.proteinGoal,
      carbTarget: settings.carbsGoal,
      fatTarget: settings.fatGoal,
      weeklyCardioGoal: settings.weeklyCardioGoal,
      averageCalories: nutrition.averages.calories,
      averageProtein: nutrition.averages.protein,
      averageCarbs: nutrition.averages.carbs,
      averageFat: nutrition.averages.fat,
      totalCalories: nutrition.totals.calories,
      totalProtein: nutrition.totals.protein,
      totalCarbs: nutrition.totals.carbs,
      totalFat: nutrition.totals.fat,
      calorieTargetTotal,
      cardioTotal: cardio.total,
      averageCardio: cardio.average,
      cardioLoggedDays: cardio.loggedDays,
      resistanceSessions: resistanceSessions(state, cleanDates),
      measurements,
      measurementCount: measurements.length,
      averageWeight: average(measurements.map((item) => item.weight)),
      averageWaist: average(measurements.map((item) => item.waist)),
      startingWeight: progress.first?.weight || null,
      currentWeight: progress.latest?.weight || null,
      weightChange: progress.weightChange,
      startingWaist: progress.first?.waist || null,
      currentWaist: progress.latest?.waist || null,
      waistChange: progress.waistChange,
      estimatedDeficit,
      expectedFatLoss,
      estimatedFatLoss,
      macroDistribution: macroDistribution(nutrition.averages),
      targetMacroDistribution: targetMacroDistribution(settings),
      tdee,
    };
    report.scores = scoreReports(report);
    return report;
  }

  function compareReports(current, previous) {
    if (!previous) return { calories: "same", protein: "same", cardio: "same", weight: "same", waist: "same", overall: "same" };
    const direction = (currentValue, previousValue, lowerBetter = false, threshold = 0.01) => {
      if (currentValue === null || previousValue === null || currentValue === undefined || previousValue === undefined) return "same";
      const delta = currentValue - previousValue;
      if (Math.abs(delta) <= Math.abs(previousValue || 1) * threshold) return "same";
      const improved = lowerBetter ? delta < 0 : delta > 0;
      return improved ? "improved" : "worse";
    };
    return {
      calories: direction(current.averageCalories, previous.averageCalories, true, 0.03),
      protein: direction(current.averageProtein, previous.averageProtein, false, 0.03),
      cardio: direction(current.cardioTotal, previous.cardioTotal, false, 0.05),
      weight: direction(current.weightChange, previous.weightChange, true, 0.05),
      waist: direction(current.waistChange, previous.waistChange, true, 0.05),
      overall: direction(current.scores.overall, previous.scores.overall, false, 0.02),
    };
  }

  function weeklyReport(state, dateISO, currentISO = todayISO()) {
    const settings = settingsForDate(state, dateISO);
    const dates = getWeekDates(dateISO, settings.weekStartsOn, currentISO);
    const report = periodReport(state, dates, currentISO, "weekly");
    const previousStart = addDays(getWeekStart(dateISO, settings.weekStartsOn), -7);
    const previousDates = rangeDates(previousStart, addDays(previousStart, 6)).filter((date) => date <= currentISO);
    report.previous = previousDates.length ? periodReport(state, previousDates, currentISO, "previous_week") : null;
    report.trend = compareReports(report, report.previous);
    return report;
  }

  function monthlyReport(state, dateISO, currentISO = todayISO()) {
    const dates = getMonthDates(dateISO, currentISO);
    const report = periodReport(state, dates, currentISO, "monthly");
    const first = dateFromISO(dateISO);
    const previousMonth = new Date(first.getFullYear(), first.getMonth() - 1, 15, 12);
    const previousISO = previousMonth.toISOString().slice(0, 10);
    const previousDates = getMonthDates(previousISO, currentISO);
    report.previous = previousDates.length ? periodReport(state, previousDates, currentISO, "previous_month") : null;
    report.trend = compareReports(report, report.previous);
    report.compliance = report.scores.overall;
    report.estimatedMusclePreservation = average([
      report.scores.protein,
      report.scores.training,
      report.waistChange !== null && report.weightChange !== null && report.weightChange <= 0 ? 85 : 60,
    ]) || 0;
    return report;
  }

  function yearlyReport(state, dateISO, currentISO = todayISO()) {
    return periodReport(state, getYearDates(dateISO, currentISO), currentISO, "yearly");
  }

  global.NutritionCalculationEngine = {
    FAT_CALORIES_PER_KG,
    ACTIVITY_FACTORS,
    todayISO,
    toNumber,
    round,
    addDays,
    diffDays,
    rangeDates,
    getWeekStart,
    getWeekDates,
    getMonthDates,
    getYearDates,
    isFutureDate,
    average,
    settingsForDate,
    macroFromItem,
    mealMacros,
    entryMacros,
    addMacros,
    dayFood,
    dayCardio,
    resistanceSessions,
    measurementsForDates,
    latestMeasurementOnOrBefore,
    macroDistribution,
    targetMacroDistribution,
    calculateBMR,
    estimateTDEE,
    dailyReport,
    weeklyReport,
    monthlyReport,
    yearlyReport,
    periodNutrition,
    periodCardio,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.NutritionCalculationEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
