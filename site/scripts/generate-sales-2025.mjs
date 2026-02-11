import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const csvPath = path.join(rootDir, "Sales.csv");
const productsOutputPath = path.join(rootDir, "src", "data", "products.json");
const salesOutputPath = path.join(rootDir, "public", "data", "sales-2025.json");

const LOC_WEIGHTS = [0.37, 0.28, 0.21, 0.14];

const pad2 = (num) => String(num).padStart(2, "0");

const getCategory = (name) => {
  const lower = name.toLowerCase();
  if (lower.includes("раф")) return "c-raf";
  if (lower.includes("чай")) return "c-tea";
  if (lower.includes("лимонад")) return "c-lemonade";
  if (
    lower.includes("какао") ||
    lower.includes("шоколад") ||
    lower.includes("коктейль")
  ) {
    return "c-free";
  }
  return "c-coffee";
};

const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const weightedPick = (weights) => {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
};

const createDateKey = (year, monthIndex, day) =>
  `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;

const ensureAllDays = (year) => {
  const dayMap = new Map();
  for (let month = 0; month < 12; month += 1) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = createDateKey(year, month, day);
      dayMap.set(dateKey, []);
    }
  }
  return dayMap;
};

const parseProducts = (csvText) => {
  const lines = csvText.trim().split(/\r?\n/);
  const rows = lines.slice(1).filter(Boolean);
  return rows.map((row, index) => {
    const [name, volume, priceRaw, minRaw, maxRaw, costRaw] = row.split(";");
    const price = Number.parseFloat(priceRaw.replace(",", "."));
    let cost = 0;
    if (costRaw) {
      const trimmedCost = costRaw.trim();
      if (trimmedCost.endsWith("%")) {
        const pct = Number.parseFloat(trimmedCost.replace("%", "").replace(",", "."));
        cost = price * (pct / 100);
      } else {
        cost = Number.parseFloat(trimmedCost.replace(",", "."));
      }
    }
    return {
      id: index,
      name: name.trim(),
      volume: volume.trim(),
      price: price,
      cost: cost,
      min: Number.parseInt(minRaw, 10),
      max: Number.parseInt(maxRaw, 10),
      category: getCategory(name),
    };
  });
};

const generateSalesFor2025 = (products) => {
  const year = 2025;
  const dayMap = ensureAllDays(year);

  for (let month = 0; month < 12; month += 1) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    products.forEach((product) => {
      const monthlyCount = randInt(Math.round(product.min * 2.5), Math.round(product.max * 2.5));
      for (let i = 0; i < monthlyCount; i += 1) {
        const day = randInt(1, daysInMonth);
        const minutes = randInt(600, 1320);
        const locId = weightedPick(LOC_WEIGHTS);
        const dateKey = createDateKey(year, month, day);
        const entries = dayMap.get(dateKey);
        if (entries) entries.push([minutes, product.id, locId]);
      }
    });
  }

  for (const [, entries] of dayMap) {
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  return Array.from(dayMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
};

const run = async () => {
  const csvText = await fs.readFile(csvPath, "utf-8");
  const products = parseProducts(csvText);
  const sales2025 = generateSalesFor2025(products);

  await fs.mkdir(path.dirname(productsOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(salesOutputPath), { recursive: true });

  await fs.writeFile(
    productsOutputPath,
    JSON.stringify(products, null, 0),
    "utf-8"
  );
  await fs.writeFile(
    salesOutputPath,
    JSON.stringify(sales2025, null, 0),
    "utf-8"
  );

  console.log(`Products saved to ${productsOutputPath}`);
  console.log(`Sales saved to ${salesOutputPath}`);
};

run().catch((error) => {
  console.error("Failed to generate sales data:", error);
  process.exitCode = 1;
});
