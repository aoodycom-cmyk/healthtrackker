(function (global) {
  const C = global.NutritionCalculationEngine;

  function n(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function pct(value) {
    return value === null || value === undefined ? "--" : `${n(value)}%`;
  }

  function loggedNumber(isLogged, value, digits = 0, suffix = "") {
    return isLogged ? `${n(value, digits)}${suffix}` : "Not logged";
  }

  function trendArabic(value) {
    const map = { improved: "تحسن", same: "ثابت", worse: "أسوأ" };
    return map[value] || "ثابت";
  }

  function createReports(state, dateISO, currentISO = C.todayISO()) {
    return {
      daily: C.dailyReport(state, dateISO, currentISO),
      weekly: C.weeklyReport(state, dateISO, currentISO),
      monthly: C.monthlyReport(state, dateISO, currentISO),
      yearly: C.yearlyReport(state, dateISO, currentISO),
    };
  }

  function explainWeeklyDifference(weekly) {
    const notes = [];
    if (weekly.weightChange !== null && weekly.expectedFatLoss && Math.abs((-weekly.weightChange) - weekly.expectedFatLoss) > 0.5) {
      notes.push("الفرق بين الوزن المتوقع والفعلي قد يكون من احتباس ماء، صوديوم، كارب عالي، أو تذبذب قياس.");
    }
    if (weekly.loggedNutritionDays < Math.max(3, weekly.periodDays * 0.6)) {
      notes.push("دقة التقرير محدودة لأن أيام التغذية المسجلة قليلة؛ الأيام المفقودة لا تُحسب كصفر.");
    }
    if (weekly.cardioTotal < Number(weekly.weeklyCardioGoal || 0) * 0.7) {
      notes.push("الكارديو أقل من الهدف الأسبوعي، وقد يقلل العجز الفعلي.");
    }
    if (weekly.averageProtein !== null && weekly.averageProtein < Number(weekly.proteinTarget || 0) * 0.9) {
      notes.push("البروتين أقل من الهدف، وهذا يضعف المحافظة على الكتلة العضلية.");
    }
    if (!notes.length) notes.push("الأرقام متسقة ولا توجد إشارة قوية لمشكلة تتبع واضحة.");
    return notes;
  }

  function weeklyCoach(weekly) {
    const notes = [];
    notes.push(weekly.scores.protein >= 85 ? "البروتين جيد." : "ارفع البروتين قبل تعديل السعرات.");
    notes.push(weekly.scores.cardio >= 85 ? "الكارديو قريب من الهدف." : `باقي تقريباً ${n(Math.max(0, weekly.weeklyCardioGoal - weekly.cardioTotal))} سعرة كارديو للهدف الأسبوعي.`);
    notes.push(weekly.weightChange !== null && weekly.weightChange < 0 ? "الوزن يتحرك نزولاً." : "لا تغيّر السعرات قبل مراجعة القياسات والتزام الأسبوع.");
    if (weekly.scores.overall >= 85) notes.push("لا يوجد سبب قوي لتغيير السعرات الآن.");
    return notes;
  }

  function monthlyCoach(monthly) {
    const notes = [];
    notes.push(monthly.weightChange !== null ? `تغير الوزن الشهري ${n(monthly.weightChange, 1)} كجم.` : "لا توجد قياسات وزن كافية للشهر.");
    notes.push(monthly.waistChange !== null ? `تغير الخصر الشهري ${n(monthly.waistChange, 1)} سم.` : "لا توجد قياسات خصر كافية للشهر.");
    notes.push(`درجة المحافظة على العضلات التقديرية ${pct(monthly.estimatedMusclePreservation)} بناءً على البروتين والمقاومة واتجاه الخصر.`);
    return notes;
  }

  function cleanAIExport(state, dateISO, currentISO = C.todayISO()) {
    const reports = createReports(state, dateISO, currentISO);
    const { daily, weekly, monthly, yearly } = reports;
    const weeklyNotes = explainWeeklyDifference(weekly).map((item) => `- ${item}`).join("\n");
    const weeklyAdvice = weeklyCoach(weekly).map((item) => `- ${item}`).join("\n");
    const monthlyAdvice = monthlyCoach(monthly).map((item) => `- ${item}`).join("\n");
    const dailyLines = weekly.dates ? weekly.dates.map((date) => {
      const nutritionLogged = C.hasFoodLogged(state, date, currentISO);
      const cardioLogged = C.hasCardioLogged(state, date, currentISO);
      const food = C.dayFood(state, date, currentISO);
      const cardio = C.dayCardio(state, date, currentISO);
      const nutritionText = nutritionLogged
        ? `Calories ${n(food.calories)}, Protein ${n(food.protein)}g, Carbs ${n(food.carbs)}g, Fat ${n(food.fat)}g`
        : "Nutrition Not logged";
      const cardioText = cardioLogged ? n(cardio) : "Not logged";
      return `- ${date}: ${nutritionText}, Cardio ${cardioText}, Resistance ${C.resistanceSessions(state, [date]) ? "Yes" : "No"}`;
    }).join("\n") : "";

    return `Healthtrackker Nutrition Analytics Export
Active Date: ${dateISO}
Generated At: ${new Date().toISOString()}

Important Rules:
- All calculations below are deterministic and calculated locally by the app.
- Do not recalculate calories, macros, adherence, BMR, TDEE, deficits, or trends.
- Use the numbers as source of truth. Provide interpretation, coaching, decision support, plateau/water-retention analysis, and recommendations only.
- Future days are excluded.
- Missing days are excluded from averages and are not counted as zero.

Goals:
- Maintenance Calories: ${n(daily.goals.maintenanceCalories)}
- Estimated TDEE: ${n(daily.goals.estimatedTDEE)}
- Previous TDEE: ${n(daily.goals.previousTDEE)}
- TDEE Difference: ${n(daily.goals.tdeeDifference)}
- TDEE Confidence: ${pct(daily.goals.tdeeConfidence)}
- BMR: ${n(daily.goals.bmr)}
- Target Calories: ${n(daily.goals.targetCalories)}
- Protein Target: ${n(daily.goals.proteinTarget)}g
- Protein Minimum: ${n(daily.goals.proteinMinimum)}g
- Carb Target: ${n(daily.goals.carbTarget)}g
- Fat Target: ${n(daily.goals.fatTarget)}g
- Weekly Cardio Goal: ${n(daily.goals.weeklyCardioGoal)}

Daily Summary:
- Calories Consumed: ${loggedNumber(daily.summary.nutritionLogged, daily.summary.caloriesConsumed)}
- Calories Remaining: ${n(daily.summary.caloriesRemaining)}
- Protein: ${loggedNumber(daily.summary.nutritionLogged, daily.summary.protein, 0, "g")}
- Carbs: ${loggedNumber(daily.summary.nutritionLogged, daily.summary.carbs, 0, "g")}
- Fat: ${loggedNumber(daily.summary.nutritionLogged, daily.summary.fat, 0, "g")}
- Cardio: ${loggedNumber(daily.summary.cardioLogged, daily.summary.cardio)}
- Resistance Training: ${daily.summary.resistanceTraining ? "Yes" : "No"}
- Weight: ${daily.summary.weight ? `${n(daily.summary.weight, 1)} kg` : "Not logged"}
- Waist: ${daily.summary.waist ? `${n(daily.summary.waist, 1)} cm` : "Not logged"}
- Macro Distribution: ${daily.summary.nutritionLogged ? `Protein ${pct(daily.macroDistribution.protein)}, Carbs ${pct(daily.macroDistribution.carbs)}, Fat ${pct(daily.macroDistribution.fat)}` : "Not logged"}
- Daily Adherence: Calories ${pct(daily.adherence.calories)}, Protein ${pct(daily.adherence.protein)}, Carbs ${pct(daily.adherence.carbs)}, Fat ${pct(daily.adherence.fat)}, Cardio ${pct(daily.adherence.cardio)}, Overall ${pct(daily.adherence.overall)}
- Estimated Deficit If Stops Eating Now: ${n(daily.deficit.estimatedIfStopsNow)}
- Estimated Deficit If Reaches Target: ${n(daily.deficit.estimatedIfTarget)}
- Final Daily Deficit: ${daily.deficit.finalDailyDeficit === null ? "Not calculated until day ends" : n(daily.deficit.finalDailyDeficit)}

Weekly Summary:
- Range: ${weekly.start || "--"} to ${weekly.end || "--"}
- Logged Nutrition Days: ${weekly.loggedNutritionDays}/${weekly.periodDays}
- Average Calories: ${n(weekly.averageCalories)}
- Average Protein: ${n(weekly.averageProtein)}g
- Average Carbs: ${n(weekly.averageCarbs)}g
- Average Fat: ${n(weekly.averageFat)}g
- Cardio Total: ${n(weekly.cardioTotal)}
- Average Cardio: ${n(weekly.averageCardio)}
- Resistance Sessions: ${n(weekly.resistanceSessions)}
- Average Weight: ${n(weekly.averageWeight, 1)} kg
- Average Waist: ${n(weekly.averageWaist, 1)} cm
- Weight Change: ${n(weekly.weightChange, 1)} kg
- Waist Change: ${n(weekly.waistChange, 1)} cm
- Expected Fat Loss: ${n(weekly.expectedFatLoss, 2)} kg
- Estimated Fat Loss: ${n(weekly.estimatedFatLoss, 2)} kg
- Weekly Deficit: ${n(weekly.estimatedDeficit)}
- Scores: Nutrition ${pct(weekly.scores.nutrition)}, Protein ${pct(weekly.scores.protein)}, Training ${pct(weekly.scores.training)}, Cardio ${pct(weekly.scores.cardio)}, Recovery ${pct(weekly.scores.recovery)}, Consistency ${pct(weekly.scores.consistency)}, Overall ${pct(weekly.scores.overall)}
- Trend vs Previous Week: Calories ${trendArabic(weekly.trend.calories)}, Protein ${trendArabic(weekly.trend.protein)}, Cardio ${trendArabic(weekly.trend.cardio)}, Weight ${trendArabic(weekly.trend.weight)}, Waist ${trendArabic(weekly.trend.waist)}, Overall ${trendArabic(weekly.trend.overall)}

Weekly Difference Notes:
${weeklyNotes}

Weekly Coach Inputs:
${weeklyAdvice}

Monthly Summary:
- Range: ${monthly.start || "--"} to ${monthly.end || "--"}
- Starting Weight: ${n(monthly.startingWeight, 1)} kg
- Current Weight: ${n(monthly.currentWeight, 1)} kg
- Weight Lost: ${monthly.weightChange === null ? "--" : n(-monthly.weightChange, 1)} kg
- Starting Waist: ${n(monthly.startingWaist, 1)} cm
- Current Waist: ${n(monthly.currentWaist, 1)} cm
- Waist Lost: ${monthly.waistChange === null ? "--" : n(-monthly.waistChange, 1)} cm
- Average Calories: ${n(monthly.averageCalories)}
- Average Protein: ${n(monthly.averageProtein)}g
- Average Carbs: ${n(monthly.averageCarbs)}g
- Average Fat: ${n(monthly.averageFat)}g
- Average Cardio: ${n(monthly.averageCardio)}
- Resistance Sessions: ${n(monthly.resistanceSessions)}
- Estimated Fat Loss: ${n(monthly.estimatedFatLoss, 2)} kg
- Estimated Muscle Preservation: ${pct(monthly.estimatedMusclePreservation)}
- Compliance: ${pct(monthly.compliance)}

Monthly Coach Inputs:
${monthlyAdvice}

Historical Trends:
- Yearly Average Calories: ${n(yearly.averageCalories)}
- Yearly Average Protein: ${n(yearly.averageProtein)}g
- Yearly Cardio Total: ${n(yearly.cardioTotal)}
- Yearly Resistance Sessions: ${n(yearly.resistanceSessions)}
- Yearly Weight Change: ${n(yearly.weightChange, 1)} kg
- Yearly Waist Change: ${n(yearly.waistChange, 1)} cm

Current Week Daily Breakdown:
${dailyLines}

Requested AI Role:
Interpret the data like an elite bodybuilding nutrition coach. Detect plateau, likely water retention, poor tracking, maintenance adaptation, recovery issues, and give practical recommendations. Do not perform mathematical recalculation.`;
  }

  global.NutritionReportingEngine = {
    n,
    pct,
    trendArabic,
    createReports,
    explainWeeklyDifference,
    weeklyCoach,
    monthlyCoach,
    cleanAIExport,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.NutritionReportingEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
