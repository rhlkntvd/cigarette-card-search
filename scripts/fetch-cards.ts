import { mkdir, writeFile } from "node:fs/promises";

const apiKey = process.env.DPLA_API_KEY;

if (!apiKey) {
  throw new Error("DPLA_API_KEY environment variable is missing");
}

const url = new URL("https://api.dp.la/v2/items");

url.searchParams.set("sourceResource.collection.title", "Cigarette cards");

url.searchParams.set("page_size", "20");
url.searchParams.set("api_key", apiKey);

console.log("Fetching cigarette cards from DPLA...");

const response = await fetch(url);

if (!response.ok) {
  throw new Error(
    `DPLA request failed: ${response.status} ${response.statusText}`,
  );
}

const data: unknown = await response.json();

await mkdir("data/raw", { recursive: true });

await writeFile("data/raw/cigarette-cards.json", JSON.stringify(data, null, 2));

console.log("Saved response to data/raw/cigarette-cards.json");
