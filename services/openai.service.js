(function () {
  const ENDPOINT = "https://api.openai.com/v1/chat/completions";
  const MODEL = "gpt-4.1-mini";

  function getApiKey() {
    return localStorage.getItem("OPENAI_API_KEY") || "";
  }

  async function retryFetch(url, options = {}, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
        return response.json();
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function compactState(context) {
    return JSON.stringify(context, null, 2).slice(0, 9000);
  }

  async function askCoach(task, context, question = "") {
    const apiKey = getApiKey();
    if (!apiKey) {
      return offlineCoach(task, context, question);
    }
    const body = {
      model: MODEL,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content: window.NutritionAICoachingEngine?.systemPrompt?.() || "You are a concise Arabic nutrition coach. Interpret only; do not recalculate the app numbers.",
        },
        {
          role: "user",
          content: `Task: ${task}\nQuestion: ${question}\nContext:\n${compactState(context)}`,
        },
      ],
    };
    const json = await retryFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return json.choices?.[0]?.message?.content || "لم يصل رد واضح من المدرب.";
  }

  function offlineCoach(task, context, question = "") {
    const daily = context.reports?.daily || {};
    const weekly = context.reports?.weekly || {};
    const food = daily.summary || {};
    const goals = daily.goals || context.settings || {};
    const remaining = Math.round(daily.deficit?.caloriesRemaining ?? ((goals.targetCalories || 0) - (food.caloriesConsumed || 0)));
    const proteinGap = Math.round((goals.proteinTarget || goals.proteinGoal || 0) - (food.protein || 0));
    const cardioGap = Math.round(Math.max(0, (weekly.weeklyCardioGoal || 0) - (weekly.cardioTotal || 0)));
    if (task === "mealSuggestions") {
      return `اقتراح سريع بدون API: اختر وجبة عالية البروتين ضمن ${Math.max(0, remaining)} سعرة. ركز على دجاج/زبادي/بيض مع كارب محسوب، وحاول تغطية ${Math.max(0, proteinGap)}g بروتين.`;
    }
    if (task === "foodAdvisor") {
      return `لو عندك عزيمة: ابدأ ببروتين واضح، خذ كمية كارب صغيرة، قلل الصوصات، واترك ${Math.max(0, remaining)} سعرة كهامش أمان.`;
    }
    if (question) {
      return `وضع Offline: المتبقي ${remaining} سعرة، فجوة البروتين ${proteinGap}g، وباقي الكارديو الأسبوعي ${cardioGap} سعرة. ضع مفتاح OpenAI في الإعدادات للحصول على تفسير أعمق.`;
    }
    return `ملخص Offline: البروتين ${proteinGap > 0 ? "يحتاج دعم" : "جيد"}، المتبقي ${remaining} سعرة، كارديو الأسبوع المتبقي ${cardioGap}، ودرجة الأسبوع ${Math.round(weekly.scores?.overall || 0)}%.`;
  }

  window.OpenAIService = {
    dailyCoach: (context) => askCoach("dailyCoach", context),
    weeklyAnalysis: (context) => askCoach("weeklyAnalysis", context),
    progressAnalysis: (context) => askCoach("progressAnalysis", context),
    foodAdvisor: (context, question) => askCoach("foodAdvisor", context, question),
    mealSuggestions: (context) => askCoach("mealSuggestions", context),
    questionAnswer: (context, question) => askCoach("questionAnswer", context, question),
  };
})();
