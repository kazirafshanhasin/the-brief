import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

const ISSUES_URL = "https://github.com/kazirafshanhasin/the-brief/issues";

/** Have this reviewed for your jurisdiction before promoting the site. */
export default function PrivacyPage() {
  return (
    <main className="prose">
      <article className="article">
        <h1>Privacy</h1>
        <p className="lede">The Brief works without an account, and this website keeps no data about you on any server.</p>

        <h2>On your device</h2>
        <p>Your countries, topics, language, display settings and saved stories are stored in your browser’s local storage. They never leave your device. Your browser downloads the same public news file as every other reader and ranks it on your device, so your choices are never sent anywhere. We set no cookies and use no analytics or advertising trackers.</p>

        <h2>Hosting</h2>
        <p>The site is hosted on GitHub Pages. As the host, GitHub may process technical data such as your IP address to deliver the site and keep it secure. See the <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub Privacy Statement</a>. Links to stories take you to the publishers’ own sites, which have their own policies.</p>

        <h2>News and AI</h2>
        <p>Stories come from publishers’ public news feeds. Summaries are taken automatically from the publishers’ own feed excerpts, and every story links to its publisher. No AI provider is used.</p>

        <h2>Deleting your data</h2>
        <p>In Settings, “Erase my data” deletes your preferences and saved stories from this browser. Clearing this site’s data in your browser does the same.</p>

        <h2>Contact</h2>
        <p>Questions or requests: open an issue on <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">this project’s GitHub Issues page</a>. Issues are public, so don’t include personal details.</p>
        <p className="selected-line">Last updated: 5 November 2026.</p>
      </article>
    </main>
  );
}
