import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Button, Confirm, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, inputCls, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMessage, useDebounced } from '../lib/hooks';
import { usePage } from '../lib/queries';
import type { Named } from '../lib/types';

interface Category extends Named { _count?: { products: number } }

const CategoryForm = ({ category, onClose }: { category: Category | null; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const save = useMutation({
    mutationFn: () => (category ? api(`/categories/${category.id}`, { method: 'PATCH', body: { name } }) : api('/categories', { method: 'POST', body: { name } })),
    onSuccess: () => {
      toast('success', category ? 'Category updated' : 'Category added');
      // 'ref' feeds the category dropdown on the product form, so new names show up there straight away.
      for (const key of ['categories', 'ref', 'products']) void client.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={category ? 'Edit category' : 'Add category'} width="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>Save</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        <Input label="Category name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
        <ErrorNote error={save.error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

export const Categories = ({ tabs }: { tabs: ReactNode }) => {
  const { can } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Category | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const q = useDebounced(search);
  const list = usePage<Category>('categories', '/categories', { search: q, page, pageSize: 25 });
  const del = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('success', 'Category deleted'); for (const key of ['categories', 'ref']) void client.invalidateQueries({ queryKey: [key] }); },
    onError: (err) => toast('error', errorMessage(err)),
    onSettled: () => setDeleting(null),
  });
  const writable = can('product:write');

  return (
    <>
      <PageHeader title="Products" subtitle="Categories group products on the till, in reports and on shelves">
        <input aria-label="Search categories" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search categories" className={`${inputCls} !w-64`} />
        {writable && <Button onClick={() => setEditing('new')}>Add category</Button>}
      </PageHeader>
      {tabs}
      <Panel className="!p-0">
        <DataTable rowKey={(c) => c.id} rows={list.data?.data} loading={list.isLoading}
          empty={<p className="p-10 text-center text-muted">{q ? 'No categories match.' : 'No categories yet.'} {writable && !q && 'Add one to start grouping products.'}</p>}
          columns={[
            { header: 'Category', cell: (c) => <span className="font-semibold">{c.name}</span> },
            { header: 'Products', cell: (c) => c._count?.products ?? 0, align: 'right' },
            ...(writable ? [{ header: 'Actions', align: 'right' as const, cell: (c: Category) => (
              <span className="flex justify-end gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} disabled={Boolean(c._count?.products)} title={c._count?.products ? 'Reassign its products to another category first' : undefined}>Delete</Button>
              </span>) }] : []),
          ]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      {editing && <CategoryForm category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Confirm open={Boolean(deleting)} danger title="Delete category?" message={`“${deleting?.name}” will be removed. It has no products assigned.`} confirmLabel="Delete" onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} />
    </>
  );
};
