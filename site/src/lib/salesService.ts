import productsData from "@/data/products.json";

export type Product = {
  id: number;
  name: string;
  volume: string;
  price: number;
  cost: number;
  min: number;
  max: number;
  category: string;
};

export type Location = {
  id: number;
  name: string;
  weight: number;
};

export type SaleEntry = [number, number, number];
export type DailySales = [string, SaleEntry[]];

export const PRODUCTS: Product[] = productsData as Product[];

export const LOCATIONS: Location[] = [
  { id: 0, name: "Москва, Парк Горького", weight: 0.212 },
  { id: 1, name: "Москва, БЦ «Сити»", weight: 0.187 },
  { id: 2, name: "Москва, Тверская 14", weight: 0.181 },
  { id: 3, name: "Москва, ТЦ Галерея", weight: 0.170 },
  { id: 4, name: "Москва, Мира, 42", weight: 0.131 },
  { id: 5, name: "Химки, Маяковского, 14", weight: 0.119 },
];

export const ALL_LOCATION_IDS = LOCATIONS.map((loc) => loc.id);

type ProductStats = {
  count: number;
  revenue: number;
  byLocation: Map<number, number>;
};

type SalesStatsResult = {
  totalCount: number;
  totalRevenue: number;
  totalCost: number;
  products: Array<{
    product: Product;
    count: number;
    revenue: number;
    byLocation: Array<{
      location: Location;
      count: number;
      pct: number;
    }>;
  }>;
};

const pad2 = (value: number) => String(value).padStart(2, "0");
const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const normalizeDate = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const productById = new Map(PRODUCTS.map((product) => [product.id, product]));

let sales2025Cache: Map<string, SaleEntry[]> | null = null;
let sales2025Promise: Promise<Map<string, SaleEntry[]>> | null = null;

const loadSales2025 = async () => {
  if (sales2025Cache) return sales2025Cache;
  if (!sales2025Promise) {
    sales2025Promise = fetch("/data/sales-2025.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sales-2025.json");
        return res.json();
      })
      .then((data: DailySales[]) => {
        sales2025Cache = new Map(data.map(([date, entries]) => [date, entries]));
        return sales2025Cache;
      });
  }
  return sales2025Promise;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let result = t;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const seededRandom = (seed: string) => mulberry32(hashString(seed));

const randInt = (rng: () => number, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;

const weightedPick = (rng: () => number, weights: number[]) => {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
};

const generatedByDate = new Map<string, SaleEntry[]>();
const generatedMonths = new Set<string>();

const ensureMonthGenerated = (year: number, monthIndex: number) => {
  const monthKey = `${year}-${pad2(monthIndex + 1)}`;
  if (generatedMonths.has(monthKey)) return;
  generatedMonths.add(monthKey);

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const dayBuckets = new Map<string, SaleEntry[]>();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${pad2(day)}`;
    dayBuckets.set(dateKey, []);
  }

  PRODUCTS.forEach((product) => {
    const countRng = seededRandom(`${monthKey}|pid:${product.id}|count`);
    const salesRng = seededRandom(`${monthKey}|pid:${product.id}|sales`);
    const multiplier = 3.75;
    const monthlyCount = randInt(countRng, Math.round(product.min * multiplier), Math.round(product.max * multiplier));
    for (let i = 0; i < monthlyCount; i += 1) {
      const day = randInt(salesRng, 1, daysInMonth);
      const minutes = randInt(salesRng, 600, 1320);
      const locId = weightedPick(
        salesRng,
        LOCATIONS.map((loc) => loc.weight)
      );
      const dateKey = `${monthKey}-${pad2(day)}`;
      const entries = dayBuckets.get(dateKey);
      if (entries) entries.push([minutes, product.id, locId]);
    }
  });

  for (const [dateKey, entries] of dayBuckets) {
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    generatedByDate.set(dateKey, entries);
  }
};

const getEntriesForDate = async (dateKey: string) => {
  const year = Number.parseInt(dateKey.slice(0, 4), 10);
  const monthIndex = Number.parseInt(dateKey.slice(5, 7), 10) - 1;
  ensureMonthGenerated(year, monthIndex);
  return generatedByDate.get(dateKey) ?? [];
};

const getDateRange = (start: Date, end: Date) => {
  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(toDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

export const getSalesStats = async ({
  startDate,
  endDate,
  locationIds,
}: {
  startDate: Date;
  endDate?: Date | null;
  locationIds?: number[];
}): Promise<SalesStatsResult> => {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate ?? startDate);
  const locations =
    locationIds && locationIds.length > 0 ? locationIds : ALL_LOCATION_IDS;
  const locationSet = new Set(locations);

  const statsByProduct = new Map<number, ProductStats>();
  PRODUCTS.forEach((product) => {
    const byLocation = new Map<number, number>();
    LOCATIONS.forEach((loc) => byLocation.set(loc.id, 0));
    statsByProduct.set(product.id, { count: 0, revenue: 0, byLocation });
  });

  let totalCount = 0;
  let totalRevenue = 0;
  let totalCost = 0;

  const today = new Date();
  const todayKey = toDateKey(today);
  const nowMinutes = today.getHours() * 60 + today.getMinutes();

  const dateKeys = getDateRange(start, end);
  
  // Pre-load all entries in parallel to avoid sequential await in loop
  const allEntries = await Promise.all(dateKeys.map(key => getEntriesForDate(key)));
  
  allEntries.forEach((entries) => {
    for (const [minutes, pid, locId] of entries) {
      if (!locationSet.has(locId)) continue;
      const product = productById.get(pid);
      if (!product) continue;
      const stats = statsByProduct.get(pid);
      if (!stats) continue;
      stats.count += 1;
      stats.revenue += product.price;
      stats.byLocation.set(locId, (stats.byLocation.get(locId) ?? 0) + 1);
      totalCount += 1;
      totalRevenue += product.price;
      totalCost += product.cost || 0;
    }
  });


  const products = PRODUCTS.map((product) => {
    const stats = statsByProduct.get(product.id);
    const count = stats?.count ?? 0;
    const revenue = stats?.revenue ?? 0;
    const byLocation = LOCATIONS.filter((loc) => locationSet.has(loc.id))
      .map((loc) => {
        const locCount = stats?.byLocation.get(loc.id) ?? 0;
        return {
          location: loc,
          count: locCount,
          pct: count > 0 ? (locCount / count) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { product, count, revenue, byLocation };
  }).sort((a, b) => b.count - a.count || b.revenue - a.revenue);

  return { totalCount, totalRevenue, totalCost, products };
};
