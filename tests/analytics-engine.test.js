const assert = require("assert");
const path = require("path");

const enginePath = path.join(__dirname, "..", "engines", "calculation-engine.js");
const C = require(enginePath);
require(path.join(__dirname, "..", "engines", "reporting-engine.js"));
require(path.join(__dirname, "..", "engines", "ai-coaching-engine.js"));

function stateFixture() {
  const chicken = { id: "chicken", name: "Chicken", calories: 165, protein: 31, carbs: 0, fat: 3.6 };
  const rice = { id: "rice", name: "Rice", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 };
  return {
    settings: {
      maintenance: 2600,
      targetCalories: 2100,
      proteinGoal: 180,
      carbsGoal: 210,
      fatGoal: 65,
      minProtein: 170,
      maxFat: 75,
      weeklyCardioGoal: 1250,
      weekStartsOn: 0,
      sex: "male",
      age: 30,
      heightCm: 180,
      goalWeight: 80,
      goalWaist: 84,
      activityLevel: 1.35,
    },
    foods: [chicken, rice],
    sauces: [],
    meals: [],
    foodLogs: [
      { id: "f1", date: "2026-07-12", slot: "lunch", sourceType: "food", itemId: "chicken", grams: 200 },
      { id: "f2", date: "2026-07-12", slot: "lunch", sourceType: "food", itemId: "rice", grams: 300 },
      { id: "f3", date: "2026-07-14", slot: "lunch", sourceType: "food", itemId: "chicken", grams: 200 },
      { id: "future", date: "2026-07-30", slot: "lunch", sourceType: "food", itemId: "rice", grams: 500 },
    ],
    cardioLogs: [
      { id: "c1", date: "2026-07-12", type: "walk", minutes: 40, calories: 250 },
      { id: "c1", date: "2026-07-12", type: "walk", minutes: 40, calories: 250 },
      { id: "c2", date: "2026-07-13", type: "bike", minutes: 30, calories: 200 },
      { id: "future-cardio", date: "2026-07-30", type: "walk", minutes: 30, calories: 150 },
    ],
    resistanceLogs: [
      { id: "r1", date: "2026-07-12", done: true },
      { id: "r2", date: "2026-07-15", done: true },
    ],
    progressLogs: [
      { id: "p1", date: "2026-07-01", weight: 80.2, waist: 88 },
      { id: "p2", date: "2026-07-12", weight: 80, waist: 87 },
      { id: "p3", date: "2026-07-12", weight: 79.8, waist: 86.8 },
      { id: "p4", date: "2026-07-20", weight: 79.2, waist: 86 },
    ],
    savedDays: [],
    targetHistory: [],
  };
}

function near(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);
}

const state = stateFixture();

near(C.calculateBMR(state.settings, 80), 1780);

const food = C.dayFood(state, "2026-07-12", "2026-07-23");
near(food.calories, 720);
near(food.protein, 70.1);
near(food.carbs, 84);
near(food.fat, 8.1);

const distribution = C.macroDistribution({ protein: 70, carbs: 84, fat: 8 });
near(Math.round(distribution.protein + distribution.carbs + distribution.fat), 100);

assert.equal(C.dayCardio(state, "2026-07-12", "2026-07-23"), 250, "duplicate cardio id should count once");
assert.equal(C.dayCardio(state, "2026-07-30", "2026-07-23"), 0, "future cardio should be excluded");
assert.equal(C.dayFood(state, "2026-07-30", "2026-07-23").calories, 0, "future food should be excluded");

const week = C.weeklyReport(state, "2026-07-14", "2026-07-23");
assert.deepEqual(week.dates, ["2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"]);
assert.equal(week.loggedNutritionDays, 2, "missing food days should be excluded from nutrition averages");
near(week.averageCalories, (720 + 330) / 2);
assert.equal(week.cardioTotal, 450);
assert.equal(week.resistanceSessions, 2);
assert.equal(week.measurements.length, 1, "latest same-day measurement should replace earlier same-day measurement in reports");
near(week.averageWeight, 79.8);

const daily = C.dailyReport(state, "2026-07-23", "2026-07-23");
assert.equal(daily.deficit.finalDailyDeficit, null, "today should not have final deficit before day end");
assert.ok(Number.isFinite(daily.deficit.estimatedIfStopsNow));
assert.ok(Number.isFinite(daily.goals.estimatedTDEE));
assert.ok(Number.isFinite(daily.goals.bmr));

const pastDaily = C.dailyReport(state, "2026-07-12", "2026-07-23");
assert.notEqual(pastDaily.deficit.finalDailyDeficit, null, "past days should have final deficit");

const month = C.monthlyReport(state, "2026-07-23", "2026-07-23");
assert.equal(month.loggedNutritionDays, 2);
assert.ok(month.scores.overall >= 0 && month.scores.overall <= 100);
assert.ok(month.estimatedMusclePreservation >= 0 && month.estimatedMusclePreservation <= 100);

const reports = globalThis.NutritionReportingEngine.createReports(state, "2026-07-23", "2026-07-23");
assert.ok(reports.daily.goals.bmr);
assert.ok(reports.weekly.scores.overall >= 0);

const aiContext = globalThis.NutritionAICoachingEngine.buildContext(state, "2026-07-23", "2026-07-23");
assert.ok(aiContext.cleanExport.includes("Do not recalculate"));
assert.ok(aiContext.cleanExport.includes("BMR"));
assert.ok(globalThis.NutritionAICoachingEngine.systemPrompt().includes("Never calculate"));

console.log("analytics-engine tests passed");
