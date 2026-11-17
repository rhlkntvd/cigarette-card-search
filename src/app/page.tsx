import CardSearch from "./card-search";

export default function HomePage() {
  return (
    <main>
      <header className="site-header">
        <p className="eyebrow">
          <a
            className="collection-link"
            href="https://digitalcollections.nypl.org/collections/b50ab6f0-c52b-012f-5986-58d385a7bc34"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="New York Public Library Cigarette Cards collection (opens in a new tab)"
          >
            New York Public Library
          </a>
        </p>
        <h1>
          <a
            className="home-link"
            href="/"
            aria-label="Cigarette Card Search home"
          >
            Cigarette Card Search
          </a>
        </h1>
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
