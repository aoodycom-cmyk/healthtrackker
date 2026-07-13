(function () {
  const CACHE_KEY = "fatLossDashboard.usdaCache.v1";
  const BASE_URL = "https://api.nal.usda.gov/fdc/v1";
  const OFF_URL = "https://world.openfoodfacts.org/api/v2/product";
  const cache = readCache();

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function writeCache() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  function getApiKey() {
    return localStorage.getItem("USDA_API_KEY") || "";
  }

  async function retryFetch(url, options = {}, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`USDA request failed: ${response.status}`);
        return response.json();
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  function nutrient(food, ids) {
    const nutrients = food.foodNutrients || [];
    const item = nutrients.find((entry) => ids.includes(Number(entry.nutrientId || entry.nutrientNumber)));
    return Number(item?.value ?? item?.amount ?? 0);
  }

  function normalize(food) {
    return {
      source: "USDA",
      fdcId: food.fdcId,
      name: food.description || food.lowercaseDescription || "USDA Food",
      brand: food.brandOwner || food.brandName || "",
      category: food.foodCategory || food.dataType || "Imported",
      servingSize: Number(food.servingSize || 100),
      servingUnit: food.servingSizeUnit || "g",
      calories: nutrient(food, [1008, 208]),
      protein: nutrient(food, [1003, 203]),
      carbs: nutrient(food, [1005, 205]),
      fat: nutrient(food, [1004, 204]),
      raw: food,
    };
  }

  function normalizeOpenFoodFacts(product, code) {
    const nutriments = product.nutriments || {};
    const servingQuantity = Number(product.serving_quantity || 100) || 100;
    return {
      source: "OpenFoodFacts",
      fdcId: `off:${code}`,
      barcode: code,
      name: product.product_name_ar || product.product_name || product.generic_name || "منتج باركود",
      brand: product.brands || "",
      category: product.categories_tags?.[0]?.replace(/^.*:/, "") || product.categories || "باركود",
      servingSize: servingQuantity,
      servingUnit: product.serving_quantity_unit || "g",
      calories: Number(nutriments["energy-kcal_100g"] ?? nutriments["energy-kcal"] ?? 0),
      protein: Number(nutriments.proteins_100g ?? nutriments.proteins ?? 0),
      carbs: Number(nutriments.carbohydrates_100g ?? nutriments.carbohydrates ?? 0),
      fat: Number(nutriments.fat_100g ?? nutriments.fat ?? 0),
      raw: product,
    };
  }

  async function search(query) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("USDA API key is missing. Add it in More > API Integrations.");
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    const key = `search:${normalizedQuery}`;
    if (cache[key] && Date.now() - cache[key].createdAt < 86400000) return cache[key].data;
    const url = `${BASE_URL}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=12`;
    const json = await retryFetch(url);
    const data = (json.foods || []).map(normalize);
    cache[key] = { createdAt: Date.now(), data };
    writeCache();
    return data;
  }

  async function lookupBarcode(code) {
    const normalizedCode = String(code || "").trim();
    if (!normalizedCode) return [];
    const key = `barcode:${normalizedCode}`;
    if (cache[key] && Date.now() - cache[key].createdAt < 604800000) return cache[key].data;
    try {
      const json = await retryFetch(`${OFF_URL}/${encodeURIComponent(normalizedCode)}.json?fields=product_name,product_name_ar,generic_name,brands,categories,categories_tags,serving_quantity,serving_quantity_unit,serving_size,nutriments`, {}, 0);
      if (json.status === 1 && json.product) {
        const data = [normalizeOpenFoodFacts(json.product, normalizedCode)];
        cache[key] = { createdAt: Date.now(), data };
        writeCache();
        return data;
      }
    } catch (error) {
      console.warn("OpenFoodFacts barcode lookup failed", error);
    }
    return search(normalizedCode);
  }

  window.USDAService = { search, lookupBarcode, normalize };
})();
