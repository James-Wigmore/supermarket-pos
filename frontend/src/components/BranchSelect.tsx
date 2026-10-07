import { useAuth } from '../lib/auth';
import { useBranches } from '../lib/queries';
import { inputCls } from './ui';

/** Super admins can switch branch; everyone else is fixed to their own. */
export const BranchSelect = ({ value, onChange }: { value: string; onChange: (id: string) => void }) => {
  const { session } = useAuth();
  const isAdmin = session?.user.role === 'SUPER_ADMIN';
  const branches = useBranches(isAdmin);
  if (!isAdmin) return null;
  return (
    <select aria-label="Branch" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} !w-auto`}>
      <option value="">All branches</option>
      {branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
};
