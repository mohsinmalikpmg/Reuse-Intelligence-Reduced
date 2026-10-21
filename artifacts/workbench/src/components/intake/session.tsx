import { getGetIntakeSessionQueryKey, useGetIntakeSession } from '@workspace/api-client-react';

export function useSession() {
  return useGetIntakeSession({
    query: {
      queryKey: getGetIntakeSessionQueryKey(),
      retry: 1,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
    request: { credentials: 'same-origin' },
  });
}

export const signIn = () => {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
};
