import type { BranchChoice } from '../lib/queries';
import { Select } from './ui';

/** Branch picker for super admins (shown by name, never by ID); renders nothing for branch users. */
export const BranchField = ({ choice, className }: { choice: BranchChoice; className?: string }) =>
  choice.isAdmin ? (
    <Select label="Branch" value={choice.branchId} onChange={(e) => choice.setBranchId(e.target.value)} className={className}>
      <option value="">Select branch…</option>
      {choice.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  ) : null;
