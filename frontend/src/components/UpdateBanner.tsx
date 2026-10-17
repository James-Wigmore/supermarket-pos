import { useAuth } from '../lib/auth';
import { isDesktop } from '../lib/desktop';
import { useUpdateStatus } from '../lib/updates';
import { UpdateControls } from './UpdateControls';

/** Tells administrators of the Windows app that an update can be downloaded or installed. Other users and browsers never see it. */
export const UpdateBanner = () => {
  const { canAny } = useAuth();
  const { data } = useUpdateStatus();
  const needsAttention = data && (['available', 'downloading', 'downloaded'].includes(data.state) || (data.state === 'error' && data.version));
  if (!isDesktop() || !canAny('settings:manage') || !needsAttention) return null;
  const failed = data.state === 'error';
  return (
    <div className={`border-b border-line px-4 py-1.5 ${failed ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-dark'}`}>
      <UpdateControls status={data} compact />
    </div>
  );
};
