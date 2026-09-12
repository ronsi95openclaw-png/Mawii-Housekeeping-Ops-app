import { useState } from 'react';
import { Bell, Home, Check } from 'lucide-react';
import { ADD_ON_MINUTES, ADD_ON_OPTIONS, ADD_ON_PRICE, HOURLY_RATE, money } from '@/lib/pricing';
import { PageIntro, Badge } from '@/lib/shared';

export function Settings() {
  const [saved, setSaved] = useState(false);
  const [company, setCompany] = useState(() => {
    const defaults = { name: 'Mawii Property Care', phone: '+1 (214) 650-4326', serviceArea: 'DFW area', website: '' };
    try {
      const stored = window.localStorage.getItem('mawii-company-settings');
      return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    } catch {
      return defaults;
    }
  });
  
  const saveCompany = () => {
    window.localStorage.setItem('mawii-company-settings', JSON.stringify(company));
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  };
  
  const services = [
    { name: 'Standard cleaning', rows: ['1 bed / 1 bath · 2 hr · $70', '2 bed / 2 bath · 3 hr · $105', '3 bed / 3 bath · 4 hr · $140'] },
    { name: 'Deep cleaning', rows: ['1 bed / 1 bath · 3 hr · $105', '2 bed / 2 bath · 4 hr · $140', '3 bed / 3 bath · 5 hr · $175'] },
    { name: 'Move In/Out cleaning', rows: ['1 bed / 1 bath · 4.5 hr · $157.50', '2 bed / 2 bath · 5.5 hr · $192.50', '3 bed / 3 bath · 6.5 hr · $227.50'] },
  ];
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="Control room" title="Settings" body="Set the defaults that keep a small team in sync." />
      
      <div className="settings-layout">
        <section className="panel settings-card">
          <div className="section-heading"><div><span className="eyebrow">Notifications</span><h3>Keep the right people posted</h3></div><Bell size={18} className="muted-icon" /></div>
          <p className="muted-copy">Job messages and new assignments already raise a notification on the bell, for owners and cleaners alike. Phone alerts when the app is closed are not built yet, so nothing here is adjustable.</p>
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
          <Badge tone="blue">{money(HOURLY_RATE)} / hour</Badge>
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
          <div><strong>Add-ons · +{ADD_ON_MINUTES} minutes · {money(ADD_ON_PRICE)} each</strong><span>{ADD_ON_OPTIONS.join(' · ')}</span></div>
          <div><strong>Contractor standards</strong><span>Bring cleaning supplies and a vacuum. Wear all-black attire or solid scrubs. Maintain a professional and respectful presence.</span></div>
        </div>
      </section>
    </div>
  );
}
