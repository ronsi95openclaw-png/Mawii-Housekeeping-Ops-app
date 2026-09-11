import { useState } from 'react';
import { Bell, Home, Check } from 'lucide-react';
import { PageIntro, Badge } from '@/lib/shared';

export function Settings() {
  const [saved, setSaved] = useState(false);
  const [prefs, setPrefs] = useState({ morning: true, attention: true, proof: true, weekly: false });
  const [company, setCompany] = useState(() => {
    const defaults = { name: 'Mawii Property Care', phone: '+1 (214) 650-4326', serviceArea: 'DFW area', website: '' };
    try {
      const stored = window.localStorage.getItem('mawii-company-settings');
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch {
      return defaults;
    }
  });
  
  const toggle = (key: keyof typeof prefs) => { setPrefs((v) => ({ ...v, [key]: !v[key] })); setSaved(false); };
  
  const saveCompany = () => {
    window.localStorage.setItem('mawii-company-settings', JSON.stringify(company));
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  };
  
  const services = [
    { name: 'Standard cleaning', rows: ['1 bed / 1 bath · 2 hr · $70', '2 bed / 2 bath · 3 hr · $105', '3 bed / 3 bath · 4 hr · $140'] },
    { name: 'Deep cleaning', rows: ['1 bed / 1 bath · 3 hr · $105', '2 bed / 2 bath · 4 hr · $140', '3 bed / 3 bath · 5 hr · $175'] },
    { name: 'Move In/Out cleaning', rows: ['1 bed / 1 bath · 4.5 hr · $157.59', '2 bed / 2 bath · 5.5 hr · $192.50', '3 bed / 3 bath · 6.5 hr · $227.50'] },
  ];
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="Control room" title="Settings" body="Set the defaults that keep a small team in sync." />
      
      <div className="settings-layout">
        <section className="panel settings-card">
          <div className="section-heading"><div><span className="eyebrow">Notifications</span><h3>Keep the right people posted</h3></div><Bell size={18} className="muted-icon" /></div>
          <div className="setting-list">
            {[{ key: 'morning', title: 'Morning dispatch', body: 'A 7:00 AM recap of today’s jobs and assignments.' }, { key: 'attention', title: 'Attention alerts', body: 'Tell owners when a job needs a decision or is running late.' }, { key: 'proof', title: 'Proof trail updates', body: 'Notify the desk when photos or checklists are added.' }, { key: 'weekly', title: 'Weekly wrap', body: 'A Friday summary of completed jobs and open follow-ups.' }].map((item) => (
              <div className="setting-row" key={item.key}>
                <div><strong>{item.title}</strong><span>{item.body}</span></div>
                <button className={`toggle ${prefs[item.key as keyof typeof prefs] ? 'toggle-on' : ''}`} onClick={() => toggle(item.key as keyof typeof prefs)} aria-pressed={prefs[item.key as keyof typeof prefs]} data-testid={`button-toggle-${item.key}`}><i /></button>
              </div>
            ))}
          </div>
        </section>
        
        <section className="panel settings-card">
          <div className="section-heading"><div><span className="eyebrow">Company profile</span><h3>How your team shows up</h3></div><Home size={18} className="muted-icon" /></div>
          <div className="company-lockup">
            <img src="/mawii-logo.jpeg" alt="Mawii Property Care logo" />
            <div>
              <strong>{company.name}</strong>
              <span>Clean spaces. Better places.</span>
              {company.website ? <a href={/^https?:\/\//.test(company.website) ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer noopener" className="text-link" data-testid="link-company-website">{company.website.replace(/^https?:\/\//, '')}</a> : null}
            </div>
          </div>
          <div className="form-stack">
            <label>Company name<input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} data-testid="input-company-name" /></label>
            <label>Primary dispatch phone<input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} data-testid="input-company-phone" /></label>
            <label>Service area<input value={company.serviceArea} onChange={(e) => setCompany({ ...company, serviceArea: e.target.value })} data-testid="input-company-area" /></label>
            <label>Website<input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} placeholder="mawiipropertycare.com" data-testid="input-company-website" /></label>
          </div>
          <button className="button button-primary save-button" onClick={saveCompany} data-testid="button-save-settings">{saved ? <><Check size={15} />Saved</> : 'Save company settings'}</button>
        </section>
      </div>
      
      <section className="panel service-catalog">
        <div className="section-heading">
          <div><span className="eyebrow">Service structure</span><h3>Mawii pricing and crew standards</h3></div>
          <Badge tone="blue">$35 / hour</Badge>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <article key={service.name}>
              <strong>{service.name}</strong>
              {service.rows.map((row) => <span key={row}>{row}</span>)}
              <small>Each additional room adds 30 minutes.</small>
            </article>
          ))}
        </div>
        <div className="service-notes">
          <div><strong>Add-ons · +30 minutes each</strong><span>Laundry · Inside Oven · Inside Fridge · Inside Cabinets</span></div>
          <div><strong>Contractor standards</strong><span>Bring cleaning supplies and a vacuum. Wear all-black attire or solid scrubs. Maintain a professional and respectful presence.</span></div>
        </div>
      </section>
    </div>
  );
}
