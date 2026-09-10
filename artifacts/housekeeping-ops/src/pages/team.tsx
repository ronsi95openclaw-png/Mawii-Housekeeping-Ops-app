import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useListEmployees, useCreateEmployee, useUpdateEmployee,
  getListEmployeesQueryKey, useListTeam
} from '@workspace/api-client-react';
import type { Employee, EmployeeInputRole } from '@workspace/api-client-react';
import { Plus, X, Phone, Edit2, ShieldAlert } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Avatar, Badge } from '@/lib/shared';

export function Team() {
  const employees = useListEmployees();
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  
  const legacyTeam = useListTeam();

  if (employees.isLoading) return <LoadingState label="Loading the crew" />;
  if (employees.isError) return <ErrorState onRetry={() => void employees.refetch()} />;
  
  const submitCreate = (data: any) => {
    create.mutate({ data }, { onSuccess: () => { setShowAdd(false); void queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); } });
  };

  const submitEdit = (data: any) => {
    if (!editEmployee) return;
    update.mutate({ id: editEmployee.id, data }, { onSuccess: () => { setEditEmployee(null); void queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() }); } });
  };
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="System access & roles" title="Team & Employees" body="Manage user access, roles, and cleaner profiles." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-team-member"><Plus size={16} />Add user</button>} />
      
      {employees.data?.length ? (
        <div className="team-grid">
          {employees.data.map((emp) => (
            <article className="panel team-card" key={emp.id} data-testid={`team-card-${emp.id}`}>
              <div className="team-card-head">
                <Avatar member={{ name: emp.name }} size="lg" />
                <Badge tone={emp.role === 'owner' ? 'red' : emp.role === 'manager' ? 'orange' : 'green'}>{emp.role}</Badge>
              </div>
              <h3>{emp.name}</h3>
              <span className="team-role">{emp.clerkUserId ? 'Linked to Clerk' : 'No Clerk ID'}</span>
              <div className="team-contact">
                <span><Phone size={14} />{emp.phone || 'No phone'}</span>
                <div className="team-actions">
                  <button className="button button-secondary" onClick={() => setEditEmployee(emp)}><Edit2 size={14} />Edit</button>
                  {emp.phone && <a href={`tel:${emp.phone}`} className="button button-secondary"><Phone size={14} />Call</a>}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No employees found" body="Add your first employee to grant them access." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-first-team-member"><Plus size={15} />Add user</button>} />
      )}

      {legacyTeam.data?.length ? (
        <section className="panel" style={{ marginTop: '32px' }}>
          <div className="section-heading">
            <div><span className="eyebrow">Legacy</span><h3>Legacy scheduling contacts</h3></div>
            <ShieldAlert size={20} className="muted-icon" />
          </div>
          <p className="muted-copy" style={{ marginTop: '8px', fontSize: '11px' }}>Legacy contacts are preserved here to avoid breaking old records.</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
            {legacyTeam.data.map(m => (
              <Badge key={m.id} tone="neutral">{m.name}</Badge>
            ))}
          </div>
        </section>
      ) : null}
      
      {showAdd && <EmployeeDialog pending={create.isPending} onClose={() => setShowAdd(false)} onSubmit={submitCreate} />}
      {editEmployee && (
        <EmployeeDialog 
          pending={update.isPending} 
          initialData={editEmployee} 
          onClose={() => setEditEmployee(null)} 
          onSubmit={submitEdit} 
        />
      )}
    </div>
  );
}

function EmployeeDialog({ onClose, onSubmit, pending, initialData }: { onClose: () => void; onSubmit: (data: any) => void; pending: boolean; initialData?: Employee }) {
  const [form, setForm] = useState({
    name: initialData?.name || '',
    clerkUserId: initialData?.clerkUserId || '',
    role: initialData?.role || 'cleaner',
    phone: initialData?.phone || '',
    active: 'true'
  });
  
  return (
    <div className="modal-scrim">
      <form className="modal panel small-modal" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">System User</span><h3>{initialData ? 'Edit Employee' : 'Add Employee'}</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-add-team"><X size={17} /></button>
        </div>
        <div className="form-stack">
          <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-team-name" /></label>
          <label>Clerk User ID (for auth linkage)<input value={form.clerkUserId} onChange={(e) => setForm({ ...form, clerkUserId: e.target.value })} placeholder="user_2X..." /></label>
          <label>System Role
            <select required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as EmployeeInputRole })}>
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="cleaner">Cleaner</option>
            </select>
          </label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-team-phone" /></label>
          <label>Active
            <select required value={form.active} onChange={(e) => setForm({ ...form, active: e.target.value })}>
              <option value="true">Active (Has access)</option>
              <option value="false">Inactive (Revoked)</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-add-team">Cancel</button>
          <button className="button button-primary" disabled={pending} data-testid="button-submit-add-team">{pending ? 'Saving…' : 'Save Employee'}</button>
        </div>
      </form>
    </div>
  );
}
