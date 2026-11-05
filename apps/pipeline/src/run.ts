import { randomUUID } from "node:crypto";
import { SupabaseRest } from "@brief/core";
import { createModel } from "./ai";
import { loadConfig } from "./config";
import { FileStore } from "./fileStore";
import { politeFetch } from "./http";
import { runPipeline } from "./pipeline";
import { buildStaticData, writeStaticData } from "./staticData";
import { MemoryStore, SupabaseStore } from "./store";

async function main() {
  const cfg = loadConfig();
  const store = cfg.dryRun
    ? new MemoryStore()
    : cfg.dataDir
      ? new FileStore(cfg.dataDir)
      : new SupabaseStore(new SupabaseRest(cfg.supabaseUrl, cfg.supabaseKey));
  const model = createModel(cfg.ai);
  if (!model && cfg.ai.provider !== "extractive") console.log("AI_PROVIDER not configured: stories will be published as headline-only entries.");

  const report = await runPipeline(cfg, {
    store,
    model,
    now: () => new Date(),
    newId: () => randomUUID(),
    log: (m) => console.log(m),
    fetchText: async (url, kind) => {
      const res = await politeFetch(url, {
        userAgent: cfg.userAgent,
        minIntervalMs: kind === "gdelt" ? 6000 : 1000,
        timeoutMs: kind === "gdelt" ? 30_000 : 15_000,
      });
      return { status: res.status, text: await res.text() };
    },
  });

  console.log(JSON.stringify(report, null, 2));
  if (store instanceof FileStore) {
    await store.cleanup();
    store.save();
    const data = buildStaticData(store, new Date());
    writeStaticData(cfg.publicDir!, data);
    console.log(`Static data: ${new Set(data.stories.map((s) => s.id)).size} stories in the last 48 h, ${data.details.length} story pages.`);
  }
  if (cfg.dryRun && store instanceof MemoryStore) {
    console.log("\nSample of stories (dry run, nothing written):");
    const sample = [...store.summaries.values()].slice(0, 10);
    for (const s of sample) console.log(`• [${s.kind}] ${s.headline}${s.summary ? `\n  ${s.summary}` : ""}`);
  }
  // Fail the scheduled job loudly if every feed failed (likely network or config problem).
  if (report.sources_fetched === 0 && cfg.sources.some((s) => s.status === "approved")) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
