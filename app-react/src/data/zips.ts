export interface ZipMarket {
  zip: string;
  city: string;
  state: string;
  medianDom: number;
  uii: number;
  note?: string;
}

export const ZIP_MARKETS: ZipMarket[] = [
  { zip: "92373", city: "Redlands", state: "CA", medianDom: 40, uii: 4.8, note: "Verification submarket" },
  { zip: "92374", city: "Redlands", state: "CA", medianDom: 38, uii: 4.5 },
  { zip: "92346", city: "Highland", state: "CA", medianDom: 36, uii: 4.1 },
  { zip: "92324", city: "Colton", state: "CA", medianDom: 44, uii: 5.2 },
  { zip: "92376", city: "Rialto", state: "CA", medianDom: 42, uii: 4.9 },
  { zip: "92335", city: "Fontana", state: "CA", medianDom: 35, uii: 3.8 },
  { zip: "92336", city: "Fontana", state: "CA", medianDom: 33, uii: 3.6 },
  { zip: "91730", city: "Rancho Cucamonga", state: "CA", medianDom: 28, uii: 3.1 },
  { zip: "91701", city: "Rancho Cucamonga", state: "CA", medianDom: 30, uii: 3.3 },
  { zip: "91786", city: "Upland", state: "CA", medianDom: 32, uii: 3.5 },
  { zip: "91764", city: "Ontario", state: "CA", medianDom: 34, uii: 3.9 },
  { zip: "91761", city: "Ontario", state: "CA", medianDom: 37, uii: 4.2 },
  { zip: "92399", city: "Yucaipa", state: "CA", medianDom: 48, uii: 5.6 },
  { zip: "92223", city: "Beaumont", state: "CA", medianDom: 45, uii: 5.4 },
  { zip: "92501", city: "Riverside", state: "CA", medianDom: 39, uii: 4.4 },
  { zip: "92506", city: "Riverside", state: "CA", medianDom: 31, uii: 3.4 },
  { zip: "92507", city: "Riverside", state: "CA", medianDom: 41, uii: 4.7 },
  { zip: "92503", city: "Riverside", state: "CA", medianDom: 38, uii: 4.3 },
  { zip: "92553", city: "Moreno Valley", state: "CA", medianDom: 43, uii: 5.0 },
  { zip: "92404", city: "San Bernardino", state: "CA", medianDom: 47, uii: 5.8 },
  { zip: "92410", city: "San Bernardino", state: "CA", medianDom: 52, uii: 6.4 },
  { zip: "92407", city: "San Bernardino", state: "CA", medianDom: 46, uii: 5.5 },
  { zip: "91709", city: "Chino Hills", state: "CA", medianDom: 26, uii: 2.8 },
  { zip: "91710", city: "Chino", state: "CA", medianDom: 29, uii: 3.2 },
  { zip: "92882", city: "Corona", state: "CA", medianDom: 33, uii: 3.6 },
  { zip: "92592", city: "Temecula", state: "CA", medianDom: 36, uii: 4.0 },
  { zip: "92201", city: "Indio", state: "CA", medianDom: 58, uii: 6.8 },
  { zip: "92262", city: "Palm Springs", state: "CA", medianDom: 72, uii: 8.1 },
  { zip: "92264", city: "Palm Springs", state: "CA", medianDom: 78, uii: 8.6 },
  { zip: "90026", city: "Los Angeles", state: "CA", medianDom: 34, uii: 3.7 },
  { zip: "90046", city: "Los Angeles", state: "CA", medianDom: 48, uii: 5.1 },
  { zip: "90210", city: "Beverly Hills", state: "CA", medianDom: 88, uii: 9.4 },
  { zip: "90291", city: "Venice", state: "CA", medianDom: 54, uii: 5.9 },
  { zip: "90401", city: "Santa Monica", state: "CA", medianDom: 51, uii: 5.4 },
  { zip: "91101", city: "Pasadena", state: "CA", medianDom: 29, uii: 3.2 },
  { zip: "91011", city: "La Cañada", state: "CA", medianDom: 27, uii: 2.9 },
  { zip: "92602", city: "Irvine", state: "CA", medianDom: 22, uii: 2.4 },
  { zip: "92603", city: "Irvine", state: "CA", medianDom: 24, uii: 2.6 },
  { zip: "92612", city: "Irvine", state: "CA", medianDom: 23, uii: 2.5 },
  { zip: "92660", city: "Newport Beach", state: "CA", medianDom: 62, uii: 6.9 },
  { zip: "92677", city: "Laguna Niguel", state: "CA", medianDom: 41, uii: 4.5 },
  { zip: "92101", city: "San Diego", state: "CA", medianDom: 32, uii: 3.5 },
  { zip: "92109", city: "San Diego", state: "CA", medianDom: 38, uii: 4.1 },
  { zip: "92130", city: "San Diego", state: "CA", medianDom: 30, uii: 3.2 },
  { zip: "94110", city: "San Francisco", state: "CA", medianDom: 28, uii: 3.0 },
  { zip: "94115", city: "San Francisco", state: "CA", medianDom: 31, uii: 3.4 },
  { zip: "94301", city: "Palo Alto", state: "CA", medianDom: 18, uii: 1.9 },
  { zip: "95014", city: "Cupertino", state: "CA", medianDom: 16, uii: 1.7 },
  { zip: "95125", city: "San Jose", state: "CA", medianDom: 21, uii: 2.2 },
  { zip: "85016", city: "Phoenix", state: "AZ", medianDom: 49, uii: 5.7 },
  { zip: "85251", city: "Scottsdale", state: "AZ", medianDom: 61, uii: 6.8 },
  { zip: "89109", city: "Las Vegas", state: "NV", medianDom: 44, uii: 5.1 },
  { zip: "80206", city: "Denver", state: "CO", medianDom: 26, uii: 2.8 },
  { zip: "78704", city: "Austin", state: "TX", medianDom: 55, uii: 6.2 },
  { zip: "75201", city: "Dallas", state: "TX", medianDom: 42, uii: 4.8 },
  { zip: "77006", city: "Houston", state: "TX", medianDom: 51, uii: 5.9 },
  { zip: "33139", city: "Miami Beach", state: "FL", medianDom: 83, uii: 9.1 },
  { zip: "33131", city: "Miami", state: "FL", medianDom: 67, uii: 7.4 },
  { zip: "33480", city: "Palm Beach", state: "FL", medianDom: 112, uii: 11.8 },
  { zip: "10011", city: "New York", state: "NY", medianDom: 74, uii: 8.2 },
  { zip: "11201", city: "Brooklyn", state: "NY", medianDom: 58, uii: 6.5 },
  { zip: "02116", city: "Boston", state: "MA", medianDom: 29, uii: 3.1 },
  { zip: "60614", city: "Chicago", state: "IL", medianDom: 36, uii: 4.0 },
  { zip: "98109", city: "Seattle", state: "WA", medianDom: 25, uii: 2.7 },
  { zip: "97209", city: "Portland", state: "OR", medianDom: 39, uii: 4.4 },
  { zip: "20001", city: "Washington", state: "DC", medianDom: 27, uii: 2.9 },
  { zip: "30309", city: "Atlanta", state: "GA", medianDom: 41, uii: 4.6 },
  { zip: "27601", city: "Raleigh", state: "NC", medianDom: 24, uii: 2.6 },
  { zip: "28202", city: "Charlotte", state: "NC", medianDom: 28, uii: 3.0 },
  { zip: "37203", city: "Nashville", state: "TN", medianDom: 33, uii: 3.6 },
  { zip: "84101", city: "Salt Lake City", state: "UT", medianDom: 35, uii: 3.9 },
  { zip: "96815", city: "Honolulu", state: "HI", medianDom: 96, uii: 10.4 },
];

export const NATIONAL_FALLBACK: ZipMarket = {
  zip: "00000",
  city: "National",
  state: "US",
  medianDom: 190,
  uii: 6.24,
  note: "Uncalibrated ZIP — national shape",
};

export function lookupZip(zip: string): ZipMarket {
  const z = zip.trim();
  return ZIP_MARKETS.find((m) => m.zip === z) ?? { ...NATIONAL_FALLBACK, zip: z || "00000" };
}

export function searchZips(q: string, limit = 8): ZipMarket[] {
  const s = q.trim().toLowerCase();
  if (!s) return ZIP_MARKETS.slice(0, limit);
  return ZIP_MARKETS.filter(
    (m) =>
      m.zip.startsWith(s) ||
      m.city.toLowerCase().includes(s) ||
      `${m.city}, ${m.state}`.toLowerCase().includes(s),
  ).slice(0, limit);
}
