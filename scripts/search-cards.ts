import { performance } from "node:perf_hooks";

import { stdin as input, stdout as output } from "node:process";

import { createInterface } from "node:readline/promises";

import { closeDatabase } from "../src/db.js";

import { embedText } from "../src/embedding.js";

import { searchCards } from "../src/search.js";

import { getIiifUrl } from "../src/iiif.js";

async function main() {
  const publicOnly = process.argv.includes("--public-only");

  const readline = createInterface({
    input,
    output,
  });

  console.log("TypeScript semantic search");

  console.log("--------------------------");

  console.log("Search scope: " + (publicOnly ? "public only" : "full corpus"));

  console.log("Type 'quit' or 'exit' to stop.");

  try {
    while (true) {
      console.log();

      const query = (await readline.question("Search: ")).trim();

      if (query.toLowerCase() === "quit" || query.toLowerCase() === "exit") {
        break;
      }

      if (!query) {
        continue;
      }

      const embeddingStart = performance.now();

      const embedding = await embedText(query);

      const embeddingMs = performance.now() - embeddingStart;

      const searchStart = performance.now();

      const results = await searchCards(embedding, {
        limit: 5,
        publicOnly,
      });

      const searchMs = performance.now() - searchStart;

      console.log();

      for (const [index, result] of results.entries()) {
        console.log(`${index + 1}. ` + result.title);

        console.log("   Similarity: " + result.similarity.toFixed(4));

        console.log("   Image: " + getIiifUrl(result.frontImageId));

        console.log("   Source: " + result.sourceUrl);

        console.log("   DPLA ID: " + result.dplaId);

        console.log("   Display eligible: " + result.displayEligible);

        console.log("   Rights: " + result.rights);
      }

      console.log();

      console.log("Timing");

      console.log("--------------------------");

      console.log("Text embedding: " + `${embeddingMs.toFixed(1)} ms`);

      console.log("Database search: " + `${searchMs.toFixed(1)} ms`);
    }
  } finally {
    readline.close();

    await closeDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
