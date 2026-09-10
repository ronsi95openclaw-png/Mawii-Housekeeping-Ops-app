import { useState, useMemo, FormEvent } from 'react';
import { 
  useListServicePlans, useCreateServicePlan, useUpdateServicePlan, 
  usePauseServicePlan, useResumeServicePlan, useGenerateServiceOccurrences, 
  useSkipOccurrence, useUpdateOccurrence, useListServicePlanOccurrences,
  getListServicePlansQueryKey, useListCustomers, useListCustomerAddresses
} from '@workspace/api-client-react';
import type { ServicePlan, Customer, Address } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Repeat, Plus, Pause, Play, Calendar, MapPin, X, ArrowRight, FastForward } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Badge, formatDate, statusLabel } from '@/lib/shared';

export function Recurring() {
  const queryClient = useQueryClient();
  const plans = useListServicePlans();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<ServicePlan | null>(null);

  if (plans.isLoading) return <LoadingState label="Loading service plans" />;
  if (plans.isError) return <ErrorState onRetry={() => void plans.refetch()} />;

  const planList = plans.data || [];

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Service contracts" title="Recurring plans" body="Manage ongoing commitments and automate the schedule." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-create-plan"><Plus size={16} />New plan</button>} />
      
      <section className="panel jobs-toolbar">
        <div className="filter-tabs">
          <span className="eyebrow" style={{ alignSelf: 'center', padding: '0 8px' }}>Active plans: {planList.filter(p => !p.pausedAt).length}</span>
        </div>
      </section>

      {planList.length ? (
        <div className="jobs-layout">
          <section className="job-list" data-testid="plan-list">
            {planList.map((plan) => (
              <button className={`job-list-row ${selectedPlan?.id === plan.id ? 'job-selected' : ''}`} key={plan.id} onClick={() => setSelectedPlan(plan)} data-testid={`button-plan-row-${plan.id}`}>
                <span className={`job-status-bar ${plan.pausedAt ? 'bar-attention' : 'bar-completed'}`} />
                <div className="job-list-main">
                  <div className="job-title-line">
                    <strong>{plan.serviceType}</strong>
                    <Badge tone={plan.pausedAt ? 'red' : 'green'}>{plan.pausedAt ? 'Paused' : 'Active'}</Badge>
                  </div>
                  <span><Repeat size={13} /> {plan.frequency.replace('_', ' ')}</span>
                  <small>Next: {formatDate(plan.nextOccurrence)}</small>
                </div>
              </button>
            ))}
          </section>
          {selectedPlan ? (
            <PlanDetail plan={selectedPlan} />
          ) : (
            <div className="panel detail-placeholder dot-grid">
              <Repeat size={28} />
              <strong>Select a plan</strong>
              <span>Review schedule, pause service, or generate upcoming jobs.</span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No recurring plans" body="Create a service plan to generate ongoing appointments automatically." action={<button className="button button-secondary" onClick={() => setShowCreate(true)}>Create plan</button>} />
      )}

      {showCreate && (
        <CreatePlanDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function CreatePlanDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const createPlan = useCreateServicePlan();
  const customers = useListCustomers();
  const [form, setForm] = useState({ customerId: '', addressId: '', serviceType: 'Standard cleaning', frequency: 'biweekly', nextOccurrence: new Date().toISOString().slice(0, 10), intervalWeeks: 2 });
  
  const selectedCustomerId = Number(form.customerId);
  const addresses = useListCustomerAddresses(selectedCustomerId, { query: { enabled: !!selectedCustomerId, queryKey: ['addresses', selectedCustomerId] } });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    createPlan.mutate({
      data: {
        customerId: Number(form.customerId),
        addressId: Number(form.addressId),
        serviceType: form.serviceType,
        frequency: form.frequency,
        nextOccurrence: form.nextOccurrence,
        intervalWeeks: form.frequency === 'every_n_weeks' ? form.intervalWeeks : undefined
      }
    }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() });
        onClose();
      }
    });
  };

  return (
    <div className="modal-scrim">
      <form className="modal panel small-modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <div><span className="eyebrow">Service Contract</span><h3>New recurring plan</h3></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="form-stack">
          <label>Customer
            <select required value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value, addressId: '' })}>
              <option value="">Select customer</option>
              {(customers.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {form.customerId && (
            <label>Service Address
              <select required value={form.addressId} onChange={(e) => setForm({ ...form, addressId: e.target.value })}>
                <option value="">Select property</option>
                {(addresses.data || []).map(a => <option key={a.id} value={a.id}>{a.line1}</option>)}
              </select>
            </label>
          )}
          <label>Service Type
            <select required value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })}>
              <option>Standard cleaning</option>
              <option>Deep cleaning</option>
              <option>Move In/Out cleaning</option>
            </select>
          </label>
          <label>Frequency
            <select required value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="every_n_weeks">Every N Weeks</option>
            </select>
          </label>
          {form.frequency === 'every_n_weeks' && (
            <label>Interval (weeks)
              <input type="number" min="1" max="52" value={form.intervalWeeks} onChange={(e) => setForm({ ...form, intervalWeeks: Number(e.target.value) })} />
            </label>
          )}
          <label>Next Occurrence
            <input type="date" required value={form.nextOccurrence} onChange={(e) => setForm({ ...form, nextOccurrence: e.target.value })} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={createPlan.isPending}>{createPlan.isPending ? 'Saving…' : 'Create plan'}<ArrowRight size={15} /></button>
        </div>
      </form>
    </div>
  );
}

function PlanDetail({ plan }: { plan: ServicePlan }) {
  const queryClient = useQueryClient();
  const pause = usePauseServicePlan();
  const resume = useResumeServicePlan();
  const generate = useGenerateServiceOccurrences();
  const occurrences = useListServicePlanOccurrences(plan.id, { query: { enabled: !!plan.id, queryKey: ['occurrences', plan.id] } });
  const skipOccurrence = useSkipOccurrence();
  const updateOccurrence = useUpdateOccurrence();
  const updatePlan = useUpdateServicePlan();

  const handleTogglePause = () => {
    if (plan.pausedAt) {
      resume.mutate({ id: plan.id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() }) });
    } else {
      pause.mutate({ id: plan.id }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() }) });
    }
  };

  const handleGenerate = () => {
    generate.mutate({ id: plan.id, data: { count: 3 } }, { onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() });
      void queryClient.invalidateQueries({ queryKey: ['occurrences', plan.id] });
    }});
  };

  const handleSkip = (id: number) => {
    skipOccurrence.mutate({ id, data: { reason: 'Client requested skip' } }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['occurrences', plan.id] }) });
  };

  return (
    <section className="panel job-detail" data-testid={`plan-detail-${plan.id}`}>
      <div className="detail-top">
        <div>
          <span className="eyebrow">Plan #{String(plan.id).padStart(4, '0')}</span>
          <h2>{plan.serviceType}</h2>
        </div>
        <Badge tone={plan.pausedAt ? 'red' : 'green'}>{plan.pausedAt ? 'Paused' : 'Active'}</Badge>
      </div>
      <div className="detail-stat-row">
        <div>
          <span>Frequency</span>
          <select style={{ border: 0, padding: 0, fontSize: '10px', background: 'transparent' }} value={plan.frequency} onChange={(e) => updatePlan.mutate({ id: plan.id, data: { frequency: e.target.value } }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() }) })}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="every_n_weeks">Every N Weeks</option>
          </select>
        </div>
        <div>
          <span>Next date</span>
          <input type="date" style={{ border: 0, padding: 0, fontSize: '10px', background: 'transparent' }} value={plan.nextOccurrence.split('T')[0]} onChange={(e) => updatePlan.mutate({ id: plan.id, data: { nextOccurrence: e.target.value } }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListServicePlansQueryKey() }) })} />
        </div>
      </div>
      
      <div className="detail-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Schedule</span><h3>Occurrences</h3></div>
        </div>
        <div className="checklist" style={{ marginTop: '12px' }}>
          {!occurrences.data?.length ? (
            <span className="muted-copy">No occurrences generated yet.</span>
          ) : (
            occurrences.data.map(occ => (
              <div className="check-row" key={occ.id} style={{ display: 'flex', justifyContent: 'space-between', cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={14} className="muted-icon" />
                  <input type="date" style={{ border: '1px solid hsl(var(--border))', borderRadius: '4px', padding: '2px 4px', fontSize: '10px', width: 'auto' }} value={occ.occurrenceDate.split('T')[0]} onChange={(e) => updateOccurrence.mutate({ id: occ.id, data: { occurrenceDate: e.target.value } }, { onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['occurrences', plan.id] }) })} />
                  <Badge tone={occ.status === 'skipped' ? 'neutral' : occ.status === 'completed' ? 'green' : 'orange'}>{statusLabel(occ.status)}</Badge>
                </div>
                {occ.status === 'scheduled' && (
                  <button className="text-button" onClick={() => handleSkip(occ.id)}>Skip</button>
                )}
                {occ.status === 'skipped' && <span className="muted-copy" style={{ fontSize: '9px' }}>{occ.skippedReason}</span>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="detail-section proof-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Operations</span><h3>Plan Controls</h3></div>
        </div>
        <div className="team-actions" style={{ marginTop: '10px' }}>
          <button className="button button-secondary" onClick={handleTogglePause} disabled={pause.isPending || resume.isPending}>
            {plan.pausedAt ? <><Play size={14} /> Resume service</> : <><Pause size={14} /> Pause service</>}
          </button>
          <button className="button button-secondary" onClick={handleGenerate} disabled={generate.isPending || !!plan.pausedAt}>
            <FastForward size={14} /> Generate upcoming (3)
          </button>
        </div>
      </div>
    </section>
  );
}
