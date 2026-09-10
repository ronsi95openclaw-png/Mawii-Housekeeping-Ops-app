import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListTeam, useCreateTeamMember, getListTeamQueryKey } from '@workspace/api-client-react';
import { Plus, X, Phone, MessageSquare } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Avatar, Badge, statusTone, statusLabel, whatsappUrl } from '@/lib/shared';

export function Team() {
  const team = useListTeam();
  const create = useCreateTeamMember();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  
  const available = (team.data || []).filter((m) => m.status === 'available').length;
  
  if (team.isLoading) return <LoadingState label="Loading the crew" />;
  if (team.isError) return <ErrorState onRetry={() => void team.refetch()} />;
  
  const submit = (data: { name: string; role: string; phone: string }) => {
    create.mutate({ data }, { onSuccess: () => { setShowAdd(false); void queryClient.invalidateQueries({ queryKey: getListTeamQueryKey() }); } });
  };
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="People on the ground" title="Team" body="Know who is ready, assigned, and taking a well-earned day off." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-team-member"><Plus size={16} />Add teammate</button>} />
      
      <section className="team-summary">
        <div className="team-summary-copy">
          <span className="eyebrow">Crew pulse</span>
          <strong>{available} ready to work</strong>
          <span>{(team.data || []).length} people in your roster</span>
        </div>
        <div className="availability-bars">
          {(team.data || []).map((member) => <span key={member.id} className={`availability-bar ${member.status}`} title={`${member.name}: ${member.status}`} />)}
        </div>
      </section>
      
      {team.data?.length ? (
        <div className="team-grid">
          {team.data.map((member) => (
            <article className="panel team-card" key={member.id} data-testid={`team-card-${member.id}`}>
              <div className="team-card-head">
                <Avatar member={member} size="lg" />
                <Badge tone={statusTone(member.status)}>{statusLabel(member.status)}</Badge>
              </div>
              <h3>{member.name}</h3>
              <span className="team-role">{member.role}</span>
              <div className="team-contact">
                <span><Phone size={14} />{member.phone}</span>
                <div className="team-actions">
                  <a href={whatsappUrl(member.phone)} target="_blank" rel="noreferrer" className="button button-secondary" data-testid={`button-whatsapp-member-${member.id}`}><MessageSquare size={14} />WhatsApp</a>
                  <a href={`tel:${member.phone}`} className="button button-secondary" data-testid={`button-call-member-${member.id}`}><Phone size={14} />Call</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="Your roster is empty" body="Add your first teammate to start assigning work." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-first-team-member"><Plus size={15} />Add teammate</button>} />
      )}
      
      {showAdd && <AddTeamDialog pending={create.isPending} onClose={() => setShowAdd(false)} onSubmit={submit} />}
    </div>
  );
}

function AddTeamDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: { name: string; role: string; phone: string }) => void; pending: boolean }) {
  const [form, setForm] = useState({ name: '', role: '', phone: '' });
  return (
    <div className="modal-scrim">
      <form className="modal panel small-modal" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Crew roster</span><h3>Add teammate</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-add-team"><X size={17} /></button>
        </div>
        <div className="form-stack">
          <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-team-name" /></label>
          <label>Role<input required placeholder="Lead cleaner" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="input-team-role" /></label>
          <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-team-phone" /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-add-team">Cancel</button>
          <button className="button button-primary" disabled={pending} data-testid="button-submit-add-team">{pending ? 'Adding…' : 'Add to roster'}</button>
        </div>
      </form>
    </div>
  );
}
