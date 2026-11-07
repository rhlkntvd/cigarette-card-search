import CardSearch from "./card-search";

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <p className="eyebrow">New York Public Library</p>
        <h1>Cigarette Card Search</h1>
        <p className="introduction">
          Explore the collection through natural-language image search.
        </p>
      </header>
      <CardSearch />
      <footer className="site-footer">
        <p>
          built by rhlkntvd ·{" "}
          <a
            href="https://github.com/rhlkntvd"
            target="_blank"
            rel="noopener noreferrer"
          >
            github
          </a>
        </p>
      </footer>
    </main>
  );
}
