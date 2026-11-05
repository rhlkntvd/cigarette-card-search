export function getSearchScope(): "public" | "all" {
  const scope = process.env.SEARCH_SCOPE ?? "public";

  if (scope !== "public" && scope !== "all") {
    throw new Error('SEARCH_SCOPE must be "public" or "all"');
  }

  return scope;
}
