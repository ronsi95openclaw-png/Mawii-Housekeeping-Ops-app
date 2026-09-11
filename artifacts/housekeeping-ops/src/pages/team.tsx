import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useListEmployees, useCreateEmployee, useUpdateEmployee,
  getListEmployeesQueryKey, useListTeam
} from '@workspace/api-client-react';
import type { Employee, EmployeeInputRole } from '@workspace/api-client-react';
import { Plus, X, Phone, Edit2, ShieldAlert, RotateCcw } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Avatar, Badge } from '@/lib/shared';

// The Team page is the only place a revoked person can be restored, so it asks for them.
// Job assignment pickers call useListEmployees() without params and stay active-only.
const TEAM_LIST_PARAMS = { includeInactive: 'true' } as const;

export function Team() {
  const employees = useListEmployees(TEAM_LIST_PARAMS, { query: { queryKey: getListEmployeesQueryKey(TEAM_LIST_PARAMS) } });
  const create = useCreateEmployee();
  const update = useUpdateEmployee();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [issuedToken, setIssuedToken] = useState<{ name: string; token: string } | null>(null);
  
  const legacyTeam = useListTeam();

  if (employees.isLoading) return <LoadingState label="Loading the crew" />;
  if (employees.isError) return <ErrorState onRetry={() => void employees.refetch()} />;
  
  const submitCreate = (data: any) => {
    create.mutate({ data }, { onSuccess: (employee) => {
      setShowAdd(false);
      if (employee.bindingToken) setIssuedToken({ name: employee.name, token: employee.bindingToken });
      void queryClient.invalidateQueries({ queryKey: ['listEmployees'] });
    } });
  };

  const submitEdit = (data: any) => {
    if (!editEmployee) return;
    update.mutate({ id: editEmployee.id, data }, { onSuccess: () => { setEditEmployee(null); void queryClient.invalidateQueries({ queryKey: ['listEmployees'] }); } });
  };
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="System access & roles" title="Team & Employees" body="Manage user access, roles, and cleaner profiles." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-team-member"><Plus size={16} />Add user</button>} />
      
      {employees.data?.length ? (
        <div className="team-grid">
          {employees.data.map((emp) => (
            <article className={`panel team-card ${emp.active === 'false' ? 'team-card-revoked' : ''}`} key={emp.id} data-testid={`team-card-${emp.id}`}>
              <div className="team-card-head">
                <Avatar member={{ name: emp.name }} size="lg" />
                <Badge tone={emp.active === 'false' ? 'neutral' : emp.role === 'owner' ? 'red' : emp.role === 'manager' ? 'orange' : 'green'}>{emp.active === 'false' ? 'No access' : emp.role}</Badge>
              </div>
              <h3>{emp.name}</h3>
              <span className="team-role">{emp.active === 'false' ? `Access revoked · was ${emp.role}` : emp.clerkUserId.startsWith('pending-') ? 'Waiting to sign in' : 'Account active'}</span>
              <div className="team-contact">
                <span><Phone size={14} />{emp.phone || 'No phone'}</span>
                <div className="team-actions">
                  {emp.active === 'false' ? (
                    <button className="button button-primary" onClick={() => update.mutate({ id: emp.id, data: { active: 'true' } }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['listEmployees'] }) })} data-testid={`button-restore-${emp.id}`}><RotateCcw size={14} />Restore access</button>
                  ) : (
                    <button className="button button-secondary" onClick={() => setEditEmployee(emp)}><Edit2 size={14} />Edit</button>
                  )}
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
      {issuedToken && (
        <div className="modal-scrim">
          <div className="modal panel small-modal">
            <div className="modal-head"><div><span className="eyebrow">One-time handoff</span><h3>Onboard {issuedToken.name}</h3></div><button className="icon-button" onClick={() => setIssuedToken(null)}><X size={17} /></button></div>
            <p className="muted-copy">Send this code to them privately. They sign up, paste it on the connect screen, and get the position you chose. It expires in 7 days, works once, and is shown only now.</p>
            <code style={{ display: 'block', padding: '12px', wordBreak: 'break-all', background: 'hsl(var(--secondary))', borderRadius: '8px', fontSize: '11px' }}>{issuedToken.token}</code>
            <div className="modal-actions"><button className="button button-primary" onClick={() => setIssuedToken(null)}>I’ve saved the code</button></div>
          </div>
        </div>
      )}
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
    active: initialData?.active || 'true'
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
           {!initialData && <p className="muted-copy">Save this profile and Mawii gives you a one-time code. Send it to them; they sign up, paste the code, and land in the app with the position you chose here.</p>}
           {initialData && <label>Clerk User ID (for auth linkage)<input value={form.clerkUserId} onChange={(e) => setForm({ ...form, clerkUserId: e.target.value })} placeholder="user_2X..." /></label>}
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
