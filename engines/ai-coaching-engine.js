(function (global) {
  function buildContext(state, dateISO, currentISO) {
    const reports = global.NutritionReportingEngine.createReports(state, dateISO, currentISO);
    return {
      rule: "All numerical calculations are deterministic app outputs. AI must interpret only and must not recalculate.",
      activeDate: dateISO,
      generatedAt: new Date().toISOString(),
      settings: state.settings,
      reports,
      cleanExport: global.NutritionReportingEngine.cleanAIExport(state, dateISO, currentISO),
    };
  }

  function systemPrompt() {
    return [
      "You are a concise Arabic bodybuilding nutrition analytics coach.",
      "Never calculate calories, macros, adherence, BMR, TDEE, deficits, cardio totals, resistance totals, weight change, waist change, averages, or scores.",
      "Use the deterministic app report as the source of truth.",
      "Only provide interpretation, decision support, trend analysis, plateau detection, water-retention detection, and recommendations.",
      "If data is missing, say the confidence is limited instead of treating missing days as zero.",
      "Keep advice practical, non-medical, and focused on fat loss while preserving muscle.",
    ].join(" ");
  }

  global.NutritionAICoachingEngine = {
    buildContext,
    systemPrompt,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.NutritionAICoachingEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
