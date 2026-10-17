import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateStatus } from '../../../desktop/bridge';
import { tokenStore } from './api';
import { ipc, isDesktop } from './desktop';

const KEY = ['app-update'];
const token = () => tokenStore.get() ?? '';

/** What the Windows app knows about updates. Never asked in a browser. Polled quickly only while something is happening. */
export const useUpdateStatus = () =>
  useQuery({
    queryKey: KEY,
    enabled: isDesktop(),
    queryFn: () => ipc(window.pos!.updateStatus()),
    refetchInterval: (query) => (['checking', 'downloading'].includes(query.state.data?.state ?? '') ? 1500 : 60_000),
  });

/** Administrator actions. Each answer is the new status, so the screen changes at once. */
export const useUpdateActions = () => {
  const client = useQueryClient();
  const action = (call: (token: string) => Promise<UpdateStatus>) => ({
    mutationFn: () => ipc(call(token())),
    onSuccess: (status: UpdateStatus) => client.setQueryData(KEY, status),
  });
  return {
    check: useMutation(action((t) => window.pos!.updateCheck(t))),
    download: useMutation(action((t) => window.pos!.updateDownload(t))),
    install: useMutation(action((t) => window.pos!.updateInstall(t))),
  };
};
