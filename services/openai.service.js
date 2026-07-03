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
          content: "You are a concise Arabic nutrition coach for fat loss. Give practical, safe, non-medical guidance. Use bullet points only when helpful.",
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
    const food = context.today || {};
    const remaining = Math.round((context.settings?.targetCalories || 0) - (food.calories || 0));
    const proteinGap = Math.round((context.settings?.proteinGoal || 0) - (food.protein || 0));
    if (task === "mealSuggestions") {
      return `اقتراح سريع بدون API: اختر وجبة عالية البروتين ضمن ${Math.max(0, remaining)} سعرة. ركز على دجاج/زبادي/بيض مع كارب محسوب، وحاول تغطية ${Math.max(0, proteinGap)}g بروتين.`;
    }
    if (task === "foodAdvisor") {
      return `لو عندك عزيمة: ابدأ ببروتين واضح، خذ كمية كارب صغيرة، قلل الصوصات، واترك ${Math.max(0, remaining)} سعرة كهامش أمان.`;
    }
    if (question) {
      return `وضع Offline: بناءً على يومك، المتبقي ${remaining} سعرة وفجوة البروتين ${proteinGap}g. ضع مفتاح OpenAI في الإعدادات للحصول على إجابة أذكى.`;
    }
    return `ملخص Offline: البروتين ${proteinGap > 0 ? "يحتاج دعم" : "جيد"}، المتبقي ${remaining} سعرة، واستمر على عجز ثابت بدون مبالغة.`;
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
