import { useState, useMemo, useEffect, FormEvent } from 'react';
import { useListCustomers, useCreateCustomer, useListCustomerAddresses, useCreateCustomerAddress, getListCustomersQueryKey, getListCustomerAddressesQueryKey, useListJobs } from '@workspace/api-client-react';
import type { Customer } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Plus, MapPin, UserRound, Phone, Mail, X, ArrowRight, BookOpen } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Avatar } from '@/lib/shared';

export function Customers() {
  const queryClient = useQueryClient();
  const customers = useListCustomers();
  const createCustomer = useCreateCustomer();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // Below this width the two-column layout stacks, which hides the detail under a
  // full-height list — so it opens as a dialog instead, the same as Jobs.
  const [asOverlay, setAsOverlay] = useState(() => window.matchMedia('(max-width: 1050px)').matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1050px)');
    const sync = (event: MediaQueryListEvent) => setAsOverlay(event.matches);
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  const filtered = (customers.data || []).filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    (c.phone && c.phone.includes(search)) || 
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  );

  if (customers.isLoading) return <LoadingState label="Loading clients" />;
  if (customers.isError) return <ErrorState onRetry={() => void customers.refetch()} />;

  const submitCreate = (data: { name: string; phone: string; email: string; notes: string }) => {
    createCustomer.mutate({ data }, { 
      onSuccess: (newCust) => { 
        setShowCreate(false); 
        void queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() }); 
        setSelectedCustomer(newCust);
      } 
    });
  };

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Client directory" title="Customers" body="Durable contact records and service history." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-create-customer"><Plus size={16} />Add customer</button>} />
      
      <section className="panel jobs-toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or email" data-testid="input-search-customers" />
        </div>
        <span className="job-total mono">{filtered.length} clients</span>
      </section>

      {filtered.length ? (
        <div className="jobs-layout">
          <section className="job-list" data-testid="customer-list">
            {filtered.map((customer) => (
              <button className={`job-list-row ${selectedCustomer?.id === customer.id ? 'job-selected' : ''}`} key={customer.id} onClick={() => setSelectedCustomer(customer)} data-testid={`button-customer-row-${customer.id}`}>
                <div className="job-list-main">
                  <div className="job-title-line">
                    <Avatar member={customer} size="sm" />
                    <strong>{customer.name}</strong>
                  </div>
                  <span><Phone size={13} />{customer.phone || 'No phone'}</span>
                  <small><Mail size={11} /> {customer.email || 'No email'}</small>
                </div>
              </button>
            ))}
          </section>
          {selectedCustomer ? (
            asOverlay ? (
              <div className="modal-scrim" onClick={() => setSelectedCustomer(null)}>
                <div className="detail-overlay" onClick={(event) => event.stopPropagation()}>
                  <button className="icon-button detail-overlay-close" onClick={() => setSelectedCustomer(null)} aria-label="Close client" data-testid="button-close-customer-detail"><X size={17} /></button>
                  <CustomerDetail customer={selectedCustomer} />
                </div>
              </div>
            ) : <CustomerDetail customer={selectedCustomer} />
          ) : (
            <div className="panel detail-placeholder dot-grid">
              <UserRound size={28} />
              <strong>Select a client</strong>
              <span>Open a customer profile to view their properties and service history.</span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No clients found" body="Try adjusting your search or add a new customer." action={<button className="button button-secondary" onClick={() => setSearch('')} data-testid="button-clear-search">Clear search</button>} />
      )}

      {showCreate && (
        <CreateCustomerDialog pending={createCustomer.isPending} onClose={() => setShowCreate(false)} onSubmit={submitCreate} />
      )}
    </div>
  );
}

function CreateCustomerDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: any) => void; pending: boolean }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  
  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal panel small-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Client profile</span><h3>Add customer</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-create"><X size={17} /></button>
        </div>
        <div className="form-stack">
          <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-customer-name" /></label>
          <label>Phone number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-customer-phone" /></label>
          <label>Email address<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-customer-email" /></label>
          <label>Private notes<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferences or details" data-testid="input-customer-notes" /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-create">Cancel</button>
          <button className="button button-primary" disabled={pending} data-testid="button-submit-create">{pending ? 'Adding…' : 'Save customer'}<ArrowRight size={15} /></button>
        </div>
      </form>
    </div>
  );
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const queryClient = useQueryClient();
  const addresses = useListCustomerAddresses(customer.id);
  const createAddress = useCreateCustomerAddress();
  const [showAddAddress, setShowAddAddress] = useState(false);
  const jobs = useListJobs();

  const customerJobs = (jobs.data || []).filter(j => j.clientName.toLowerCase() === customer.name.toLowerCase() || (customer.phone && j.clientPhone === customer.phone));

  const submitAddress = (data: any) => {
    createAddress.mutate({ id: customer.id, data }, {
      onSuccess: () => {
        setShowAddAddress(false);
        void queryClient.invalidateQueries({ queryKey: getListCustomerAddressesQueryKey(customer.id) });
      }
    });
  };

  return (
    <section className="panel job-detail" data-testid={`customer-detail-${customer.id}`}>
      <div className="detail-top">
        <div>
          <span className="eyebrow">Customer #{String(customer.id).padStart(4, '0')}</span>
          <h2>{customer.name}</h2>
        </div>
      </div>
      <div className="detail-stat-row">
        <div><span>Phone</span><strong>{customer.phone || 'Not provided'}</strong></div>
        <div><span>Email</span><strong>{customer.email || 'Not provided'}</strong></div>
      </div>
      
      {customer.notes && (
        <div className="detail-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Context</span><h3>Notes</h3></div>
          </div>
          <p className="muted-copy">{customer.notes}</p>
        </div>
      )}

      <div className="detail-section proof-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Locations</span><h3>Properties</h3></div>
          <button className="text-button" onClick={() => setShowAddAddress(true)} data-testid="button-add-address">Add address</button>
        </div>
        
        {addresses.isLoading ? (
          <span className="muted-copy">Loading properties...</span>
        ) : addresses.data?.length ? (
          <div className="checklist">
            {addresses.data.map(addr => (
              <div className="check-row" style={{ alignItems: 'flex-start', cursor: 'default' }} key={addr.id}>
                <MapPin size={15} style={{ marginTop: '2px' }} className="muted-icon" />
                <div>
                  <strong>{addr.label || 'Property'}</strong>
                  <span style={{ display: 'block', color: 'hsl(var(--muted-foreground))', fontSize: '10px' }}>
                    {addr.line1} {addr.line2 ? `, ${addr.line2}` : ''}<br />
                    {addr.city}, {addr.state} {addr.postalCode}
                  </span>
                  {addr.accessNotes && <small style={{ display: 'block', marginTop: '4px', fontSize: '9px', color: 'hsl(var(--primary))' }}><BookOpen size={11} style={{ display: 'inline', marginRight: '4px' }}/>{addr.accessNotes}</small>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="proof-empty">
            <MapPin size={17} />
            <span>No properties on file. Add one to schedule services.</span>
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Records</span><h3>Service History</h3></div>
        </div>
        {!customerJobs.length ? (
          <span className="muted-copy">No jobs on record for this customer.</span>
        ) : (
          <div className="checklist" style={{ marginTop: '12px' }}>
            {customerJobs.slice(0, 5).map(job => (
              <div className="check-row" key={job.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', cursor: 'default' }}>
                <div>
                  <strong>{job.serviceType}</strong>
                  <span style={{ display: 'block', color: 'hsl(var(--muted-foreground))', fontSize: '9px', marginTop: '2px' }}>
                    {job.address}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', fontSize: '10px' }}>{new Date(job.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span style={{ display: 'block', color: 'hsl(var(--primary))', fontSize: '9px', textTransform: 'capitalize', marginTop: '2px' }}>{job.status.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
            {customerJobs.length > 5 && <span className="muted-copy" style={{ display: 'block', textAlign: 'center', marginTop: '12px' }}>+{customerJobs.length - 5} more jobs</span>}
          </div>
        )}
      </div>

      {showAddAddress && (
        <CreateAddressDialog pending={createAddress.isPending} onClose={() => setShowAddAddress(false)} onSubmit={submitAddress} />
      )}
    </section>
  );
}

function CreateAddressDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: any) => void; pending: boolean }) {
  const [form, setForm] = useState({ label: '', line1: '', line2: '', city: '', state: 'TX', postalCode: '', accessNotes: '' });
  
  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal panel" onClick={(e) => e.stopPropagation()} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Property</span><h3>Add service address</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-address"><X size={17} /></button>
        </div>
        <div className="form-grid">
          <label className="span-2">Label (e.g. Home, Office)<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Home" data-testid="input-address-label" /></label>
          <label className="span-2">Address Line 1<input required value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} data-testid="input-address-line1" /></label>
          <label className="span-2">Address Line 2<input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} data-testid="input-address-line2" /></label>
          <label>City<input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="input-address-city" /></label>
          <label>State<input required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} data-testid="input-address-state" /></label>
          <label>Postal Code<input required value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} data-testid="input-address-zip" /></label>
          <label className="span-2">Access Notes<textarea rows={2} value={form.accessNotes} onChange={(e) => setForm({ ...form, accessNotes: e.target.value })} placeholder="Gate codes, parking info..." data-testid="input-address-notes" /></label>
        </div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={pending}>{pending ? 'Saving…' : 'Save address'}</button>
        </div>
      </form>
    </div>
  );
}
