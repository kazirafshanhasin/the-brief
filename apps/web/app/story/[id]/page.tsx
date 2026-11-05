import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { longDate, storyWhere } from "@/lib/format";
import { readStory, storyIds } from "@/lib/static-data";
import { StoryArticle } from "./StoryArticle";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  const ids = storyIds();
  // `next build` fails on an empty list, and CI builds with no news data. This id renders the not-found page.
  return (ids.length ? ids : ["none"]).map((id) => ({ id }));
}

async function load(props: Props) {
  const { id } = await props.params;
  return readStory(id) ?? notFound();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const story = await load(props);
  return {
    title: story.headline,
    description: story.summary ?? `${storyWhere(story)}. Read the full report at the source.`,
    openGraph: { title: story.headline, description: story.summary ?? undefined, type: "article" },
  };
}

export default async function StoryPage(props: Props) {
  const story = await load(props);
  return (
    <main>
      <StoryArticle story={story} />

      <section aria-labelledby="sources-h">
        <div className="section-head">
          <h2 id="sources-h">Reported by</h2>
        </div>
        <ul className="sources">
          {story.sources.map((s) => (
            <li key={s.url}>
              <span className="publisher">
                {s.name} · {longDate(s.published_at, "UTC")}
              </span>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.headline}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {story.related.length > 0 && (
        <section aria-labelledby="related-h">
          <div className="section-head">
            <h2 id="related-h">Related coverage</h2>
          </div>
          <ul className="sources">
            {story.related.map((r) => (
              <li key={r.id}>
                <Link href={`/story/${r.id}`}>{r.headline}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
