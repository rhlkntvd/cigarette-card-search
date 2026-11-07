import type { SearchResult } from "../search";

export const SEARCH_PAGE_SIZE = 6;

export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
}
