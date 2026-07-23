(function (global) {
  const TARGET_KEYS = [
    "maintenance",
    "targetCalories",
    "proteinGoal",
    "carbsGoal",
    "fatGoal",
    "minProtein",
    "maxFat",
    "weeklyCardioGoal",
  ];

  function goalSnapshot(settings = {}) {
    return Object.fromEntries(TARGET_KEYS.map((key) => [key, settings[key]]));
  }

  function settingsChanged(previous = {}, next = {}) {
    return TARGET_KEYS.some((key) => Number(previous[key]) !== Number(next[key]));
  }

  function ensureTargetHistory(state, nextSettings, dateISO) {
    const currentHistory = Array.isArray(state.targetHistory) ? state.targetHistory : [];
    if (!settingsChanged(state.settings, nextSettings)) return currentHistory;
    const snapshot = {
      id: crypto.randomUUID(),
      effectiveFrom: dateISO,
      createdAt: new Date().toISOString(),
      settings: goalSnapshot(nextSettings),
    };
    return currentHistory.concat(snapshot);
  }

  function exportStatePayload(state, exportedAt = new Date().toISOString()) {
    return {
      app: "healthtrackker",
      version: 2,
      exportedAt,
      state,
    };
  }

  global.NutritionStorageEngine = {
    TARGET_KEYS,
    goalSnapshot,
    settingsChanged,
    ensureTargetHistory,
    exportStatePayload,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.NutritionStorageEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
