import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StaticStoryDetail } from "@brief/core";

/** Build-time only: the pipeline's detail files, which the site is rebuilt from on every run. */
const STORY_DIR = join(process.cwd(), "public", "data", "story");

export function storyIds(): string[] {
  if (!existsSync(STORY_DIR)) return [];
  return readdirSync(STORY_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
}

export function readStory(id: string): StaticStoryDetail | null {
  const path = join(STORY_DIR, `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as StaticStoryDetail) : null;
}
