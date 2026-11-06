import CardSearch from "./card-search";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">New York Public Library</p>
      <h1>Cigarette Card Search</h1>
      <p className="introduction">
        Explore the collection through natural-language image search.
      </p>
      <CardSearch />
    </main>
  );
}
