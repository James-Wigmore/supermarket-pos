import { useEffect, useState } from 'react';

export const useDebounced = <T,>(value: T, ms = 250) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
