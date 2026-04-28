import "dotenv/config";
import { tavily } from "@tavily/core";
import * as fs from "fs";
import * as path from "path";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY ?? "" });

interface ResearchOutput {
  niche: string;
  product: string;
  audience: string;
  content_topics: string[];
  content_angles: string[];
  keywords: string[];
  ad_hooks: string[];
  video_concepts: string[];
}

async function runResearch(
  niche: string,
  product: string,
  audience: string,
  taskName: string
): Promise<ResearchOutput> {
  const date = new Date().toISOString().split("T")[0];
  const outputDir = path.join("outputs", `${taskName}_${date}`, "research");
  fs.mkdirSync(outputDir, { recursive: true });

  const [trendResults, hookResults, competitorResults] = await Promise.all([
    client.search(`${niche} tendências marketing 2025 ${audience}`, {
      maxResults: 5,
      searchDepth: "advanced",
    }),
    client.search(`melhores hooks ads ${niche} instagram reels`, {
      maxResults: 5,
      searchDepth: "advanced",
    }),
    client.search(`${product} concorrentes mensagem marketing`, {
      maxResults: 5,
      searchDepth: "basic",
    }),
  ]);

  const allContent = [
    ...trendResults.results,
    ...hookResults.results,
    ...competitorResults.results,
  ]
    .map((r) => r.content)
    .join("\n");

  const output: ResearchOutput = {
    niche,
    product,
    audience,
    content_topics: extractTopics(trendResults.results),
    content_angles: extractAngles(hookResults.results),
    keywords: extractKeywords(niche, product, audience),
    ad_hooks: extractHooks(hookResults.results),
    video_concepts: extractVideoConcepts(trendResults.results),
  };

  const outputPath = path.join(outputDir, "research_output.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Research saved to ${outputPath}`);

  return output;
}

function extractTopics(results: { title: string }[]): string[] {
  return results.slice(0, 4).map((r) => r.title);
}

function extractAngles(results: { title: string }[]): string[] {
  return results.slice(0, 3).map((r) => r.title);
}

function extractKeywords(niche: string, product: string, audience: string): string[] {
  const base = niche.split(" ").concat(product.split(" "), audience.split(" "));
  return [...new Set(base.map((w) => w.toLowerCase()).filter((w) => w.length > 3))];
}

function extractHooks(results: { content: string }[]): string[] {
  return results
    .slice(0, 3)
    .map((r) => r.content.split(".")[0].trim())
    .filter((h) => h.length > 10);
}

function extractVideoConcepts(results: { title: string }[]): string[] {
  return results.slice(0, 3).map((r) => `Video: ${r.title}`);
}

// Run from CLI: npx ts-node agents/research.ts
const [, , niche, product, audience, taskName] = process.argv;

if (niche && product && audience && taskName) {
  runResearch(niche, product, audience, taskName).catch(console.error);
} else {
  console.log(
    "Usage: npx ts-node agents/research.ts <niche> <product> <audience> <task_name>"
  );
}

export { runResearch };
export type { ResearchOutput };
