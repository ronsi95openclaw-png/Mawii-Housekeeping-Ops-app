import { useState, useEffect, useRef } from 'react';
import { 
  useListAssignedJobs, useRespondToAssignment, useClockInToJob, 
  useClockOutTimeEntry, useAddTimeBreak, useRequestTimeCorrection,
  getListAssignedJobsQueryKey,
  useRegisterProofPhoto,
  useRequestUploadUrl,
  useUpdateJobChecklist,
  useCreateIncident,
  useGetJob,
  getGetJobQueryKey,
  useGetActiveTimeEntries,
  useListProofPhotos
} from '@workspace/api-client-react';
import type { Job, JobAssignment } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock3, Check, Camera, Coffee, AlertTriangle, ChevronRight, X, Image as ImageIcon } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Badge, formatDate, formatTime, statusTone, statusLabel } from '@/lib/shared';

function FieldJobRow({ assignment, onSelect }: { assignment: JobAssignment; onSelect: (jobId: number, assignmentId: number) => void }) {
  const { data: job, isLoading } = useGetJob(assignment.jobId, { query: { queryKey: getGetJobQueryKey(assignment.jobId) } });

  return (
    <button className="job-list-row" onClick={() => onSelect(assignment.jobId, assignment.id)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', height: 'auto', padding: '16px' }}>
      <div className="job-list-main">
        <div className="job-title-line">
          <strong>{isLoading ? 'Loading...' : (job?.clientName || 'Job')}</strong>
          <Badge tone={statusTone(job?.status || assignment.status)}>{statusLabel(job?.status || assignment.status)}</Badge>
        </div>
        <span><MapPin size={13} /> {job?.address || '—'}</span>
        <small>{job?.serviceType} · {formatDate(job?.scheduledDate)}</small>
      </div>
      <ChevronRight size={18} className="row-chevron" />
    </button>
  );
}

export function Field() {
  const jobs = useListAssignedJobs();
  const [selected, setSelected] = useState<{ jobId: number; assignmentId: number } | null>(null);

  if (jobs.isLoading) return <LoadingState label="Loading assignments" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;

  const assignments = jobs.data || [];
  
  if (selected) {
    return <FieldJobDetail jobId={selected.jobId} assignmentId={selected.assignmentId} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="content-stack">
      <PageIntro eyebrow="On the ground" title="My Jobs" body="Your assignments for today and upcoming." />
      
      {assignments.length ? (
        <div className="job-list">
          {assignments.map((assignment) => (
            <FieldJobRow key={assignment.id} assignment={assignment} onSelect={(jobId, assignmentId) => setSelected({ jobId, assignmentId })} />
          ))}
        </div>
      ) : (
        <EmptyState title="No assignments" body="You don't have any jobs assigned to you right now." />
      )}
    </div>
  );
}

function FieldJobDetail({ jobId, assignmentId, onBack }: { jobId: number; assignmentId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: job, isLoading, isError, refetch } = useGetJob(jobId, { query: { queryKey: getGetJobQueryKey(jobId) } });
  
  const activeEntries = useGetActiveTimeEntries({ jobId }, { query: { queryKey: ['activeTimeEntries', jobId] } });
  const activeEntry = activeEntries.data?.[0];

  const clockIn = useClockInToJob();
  const clockOut = useClockOutTimeEntry();
  const breakTime = useAddTimeBreak();
  const correction = useRequestTimeCorrection();

  const checklist = useUpdateJobChecklist();
  const requestUpload = useRequestUploadUrl();
  const registerPhoto = useRegisterProofPhoto();
  const respond = useRespondToAssignment();
  const reportIncident = useCreateIncident();
  
  const photos = useListProofPhotos(jobId, { query: { enabled: !!jobId, queryKey: ['proofPhotos', jobId] } });

  const [isUploading, setIsUploading] = useState(false);
  const [incidentText, setIncidentText] = useState('');
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionMins, setCorrectionMins] = useState(0);

  if (isLoading) return <LoadingState label="Loading job details" />;
  if (isError || !job) return <ErrorState onRetry={() => void refetch()} />;

  const handleRespond = (decision: 'accept' | 'decline') => {
    respond.mutate({ id: assignmentId, decision }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() }) });
  };

  const handleClockIn = () => clockIn.mutate({ jobId }, { onSuccess: () => void activeEntries.refetch() });
  
  const handleClockOut = () => {
    if (!activeEntry) return;
    clockOut.mutate({ id: activeEntry.id }, { onSuccess: () => void activeEntries.refetch() });
  };
  
  const handleBreak = () => {
    if (!activeEntry) return;
    breakTime.mutate({ id: activeEntry.id, data: { minutes: 15 } }, { onSuccess: () => void activeEntries.refetch() });
  };
  
  const handleCorrection = () => {
    if (!activeEntry || !correctionMins) return;
    correction.mutate({ id: activeEntry.id, data: { minutes: correctionMins, reason: 'Field request' } }, { 
      onSuccess: () => {
        setShowCorrection(false);
        void activeEntries.refetch();
      }
    });
  };

  const handleIncident = () => {
    if (!incidentText.trim()) return;
    reportIncident.mutate({ jobId, data: { description: incidentText } }, { onSuccess: () => setIncidentText('') });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'before' | 'after') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type }
      });
      
      await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      
      await registerPhoto.mutateAsync({
        jobId, data: { kind, objectPath, contentType: file.type, byteSize: file.size }
      });
      
      void refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="content-stack animate-rise">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button className="icon-button" onClick={onBack}><ChevronRight size={17} style={{ transform: 'rotate(180deg)' }}/></button>
        <h2 style={{ fontSize: '20px', margin: 0 }}>Job #{String(job.id).padStart(4, '0')}</h2>
      </div>

      <section className="panel job-detail">
        <div className="detail-top">
          <div>
            <h2>{job.clientName}</h2>
            <p><MapPin size={14} />{job.address}</p>
          </div>
          <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
        </div>
        
        <div className="detail-stat-row">
          <div><span>Window</span><strong>{formatTime(job.startTime)} – {formatTime(job.endTime)}</strong></div>
          <div><span>Service</span><strong>{job.serviceType}</strong></div>
        </div>

        {job.notes && (
          <div className="message-box" style={{ marginBottom: '16px', background: 'hsl(var(--secondary))' }}>
            <strong>Notes</strong>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'hsl(var(--muted-foreground))' }}>{job.notes}</p>
          </div>
        )}
        
        <div className="detail-section" style={{ padding: '16px', background: 'hsl(var(--secondary))', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <strong>Clock Status</strong>
            {activeEntry ? (
              <Badge tone="green">Clocked In: {formatTime(activeEntry.clockIn.split('T')[1])}</Badge>
            ) : (
              <Badge tone="neutral">Not clocked in</Badge>
            )}
          </div>
          
          {activeEntry ? (
            <div className="team-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button className="button button-primary" onClick={handleClockOut} disabled={clockOut.isPending}><Check size={15}/> Clock out</button>
              <button className="button button-secondary" onClick={handleBreak} disabled={breakTime.isPending}><Coffee size={15}/> 15m Break</button>
              <button className="button button-secondary" style={{ gridColumn: 'span 2' }} onClick={() => setShowCorrection(!showCorrection)}>Request Correction</button>
            </div>
          ) : (
            <button className="button button-primary" style={{ width: '100%' }} onClick={handleClockIn} disabled={clockIn.isPending}><Clock3 size={15}/> Clock in</button>
          )}

          {showCorrection && activeEntry && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <input type="number" placeholder="Mins" style={{ width: '80px', padding: '6px', fontSize: '12px', border: '1px solid hsl(var(--border))', borderRadius: '4px' }} value={correctionMins || ''} onChange={(e) => setCorrectionMins(Number(e.target.value))} />
              <button className="button button-secondary" onClick={handleCorrection} disabled={correction.isPending}>Submit Request</button>
            </div>
          )}
        </div>

        <div className="team-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <button className="button button-secondary" onClick={() => handleRespond('accept')} disabled={respond.isPending}>Accept job</button>
          <button className="button button-secondary" onClick={() => handleRespond('decline')} disabled={respond.isPending} style={{ color: 'hsl(var(--destructive))' }}>Decline</button>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Tasks</span><h3>Checklist</h3></div>
          </div>
          <div className="checklist">
            {job.checklist?.map((item) => (
              <label className={`check-row ${item.completed ? 'check-complete' : ''}`} key={item.id}>
                <input type="checkbox" checked={item.completed} onChange={(e) => checklist.mutate({ id: job.id, data: { itemId: item.id, completed: e.target.checked } }, { onSuccess: () => void qc.setQueryData(getGetJobQueryKey(job.id), (old: any) => old ? { ...old, checklist: old.checklist.map((c: any) => c.id === item.id ? { ...c, completed: e.target.checked } : c) } : old) })} />
                <span>{item.label}</span>
                {item.completed && <Check size={15} />}
              </label>
            ))}
          </div>
        </div>

        <div className="detail-section proof-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Proof</span><h3>Photos</h3></div>
            {isUploading && <span style={{ fontSize: '10px', color: 'hsl(var(--primary))' }}>Uploading...</span>}
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            <label className="button button-secondary" style={{ cursor: 'pointer', textAlign: 'center' }}>
              <Camera size={14}/> Before
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, 'before')} disabled={isUploading} />
            </label>
            <label className="button button-secondary" style={{ cursor: 'pointer', textAlign: 'center' }}>
              <Camera size={14}/> After
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, 'after')} disabled={isUploading} />
            </label>
          </div>

          {photos.data?.length ? (
            <div className="photo-grid">
              {photos.data.map((photo) => (
                <div key={photo.id} style={{ position: 'relative' }}>
                  <img src={`/api/storage${photo.objectPath}`} alt={photo.kind} />
                  <span style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '9px', padding: '2px 4px', borderRadius: '4px' }}>{photo.kind}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="proof-empty"><ImageIcon size={17} /><span>Take photos before and after service.</span></div>
          )}
        </div>

        <div className="detail-section" style={{ borderBottom: 0 }}>
          <div className="detail-section-head">
            <div><span className="eyebrow">Issues</span><h3>Report Incident</h3></div>
          </div>
          <div className="message-box" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="message-input" style={{ margin: 0 }}>
              <input value={incidentText} onChange={(e) => setIncidentText(e.target.value)} placeholder="Describe the issue..." />
              <button disabled={!incidentText.trim() || reportIncident.isPending} onClick={handleIncident}><AlertTriangle size={15} /></button>
            </div>
            <span className="message-note" style={{ marginTop: '8px' }}>
              <AlertTriangle size={13} /> {reportIncident.isSuccess ? 'Reported successfully' : 'Incidents alert dispatch immediately.'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
