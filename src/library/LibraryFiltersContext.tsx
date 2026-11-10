import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useMemo,
  useState,
} from "react";

import { DEFAULT_FILTERS, type LibraryFilters } from "./filters";

interface LibraryFiltersValue {
  readonly filters: LibraryFilters;
  readonly setFilters: Dispatch<SetStateAction<LibraryFilters>>;
}

const LibraryFiltersContext = createContext<LibraryFiltersValue | null>(null);

/**
 * Holds the Library's filters (docs/SPEC.md 3.9) above the screens, so that they hold until
 * changed while the app runs, whatever screen is opened in between, and start at their defaults
 * when it starts: they are kept in memory only.
 */
export function LibraryFiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const value = useMemo(() => ({ filters, setFilters }), [filters]);
  return <LibraryFiltersContext.Provider value={value}>{children}</LibraryFiltersContext.Provider>;
}

/** The Library's filters, and the means to change them. */
export function useLibraryFilters(): LibraryFiltersValue {
  const value = useContext(LibraryFiltersContext);
  if (value === null) {
    throw new Error("useLibraryFilters must be used inside a LibraryFiltersProvider");
  }
  return value;
}
