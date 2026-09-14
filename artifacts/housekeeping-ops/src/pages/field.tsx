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
  useListProofPhotos,
  useCompleteAssignedJob,
  useListJobMessages, useSendFieldJobMessage, getListJobMessagesQueryKey,
  useListNotifications, getListNotificationsQueryKey
} from '@workspace/api-client-react';
import type { Job, JobAssignment } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock3, Check, Camera, Coffee, AlertTriangle, ChevronRight, X, Image as ImageIcon, Map as MapIcon } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Badge, formatDate, formatTime, statusTone, statusLabel, AddressLink } from '@/lib/shared';

type CleanerAction = 'accept' | 'decline' | 'clock-in' | 'clock-out' | 'break' | 'correction' | 'checklist' | 'message' | 'complete' | 'incident';
type ActionFeedback = { action: CleanerAction; kind: 'success' | 'error'; message: string };

function assignmentStateLabel(jobStatus: string | undefined, assignmentStatus: string | undefined, hasActiveEntry: boolean) {
  if (jobStatus === 'completed') return { label: 'Completed', tone: 'green' as const };
  if (jobStatus === 'in_progress' || hasActiveEntry) return { label: 'In progress', tone: 'orange' as const };
  if (assignmentStatus === 'accepted') return { label: 'Accepted', tone: 'green' as const };
  if (assignmentStatus === 'declined') return { label: 'Declined', tone: 'red' as const };
  return { label: 'Pending', tone: 'neutral' as const };
}

function FieldJobRow({ assignment, onSelect, unread }: { assignment: JobAssignment; onSelect: (jobId: number, assignmentId: number, status: JobAssignment['status']) => void; unread: boolean }) {
  const { data: job, isLoading } = useGetJob(assignment.jobId, { query: { queryKey: getGetJobQueryKey(assignment.jobId) } });

  return (
    <button className="job-list-row" onClick={() => onSelect(assignment.jobId, assignment.id, assignment.status)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', height: 'auto', padding: '16px' }}>
      <div className="job-list-main">
        <div className="job-title-line">
          <strong>{isLoading ? 'Loading...' : (job?.clientName || 'Job')}</strong>
          {unread ? <span className="unread-flag" data-testid={`unread-job-${assignment.jobId}`}>New message</span> : null}
          <Badge tone={assignmentStateLabel(job?.status, assignment.status, false).tone}>{assignmentStateLabel(job?.status, assignment.status, false).label}</Badge>
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
  const notifications = useListNotifications({ limit: 30 }, { query: { queryKey: getListNotificationsQueryKey({ limit: 30 }), refetchInterval: 30_000 } });
  const [selected, setSelected] = useState<{ jobId: number; assignmentId: number; status: JobAssignment['status'] } | null>(null);

  const jobsWithUnreadMessages = new Set(
    (notifications.data || []).filter((item) => item.kind === 'message' && !item.readAt && item.jobId).map((item) => item.jobId),
  );

  if (jobs.isLoading) return <LoadingState label="Loading assignments" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;

  const assignments = jobs.data || [];
  
  if (selected) {
    return <FieldJobDetail jobId={selected.jobId} assignmentId={selected.assignmentId} initialAssignmentStatus={selected.status} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="content-stack">
      <PageIntro eyebrow="On the ground" title="My Jobs" body="Your assignments for today and upcoming." />
      
      {assignments.length ? (
        <div className="job-list">
          {assignments.map((assignment) => (
            <FieldJobRow key={assignment.id} assignment={assignment} unread={jobsWithUnreadMessages.has(assignment.jobId)} onSelect={(jobId, assignmentId, status) => setSelected({ jobId, assignmentId, status })} />
          ))}
        </div>
      ) : (
        <EmptyState title="No assignments" body="You don't have any jobs assigned to you right now." />
      )}
    </div>
  );
}

function FieldJobDetail({ jobId, assignmentId, initialAssignmentStatus, onBack }: { jobId: number; assignmentId: number; initialAssignmentStatus: JobAssignment['status']; onBack: () => void }) {
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
  const completeJob = useCompleteAssignedJob();
  const messages = useListJobMessages(jobId, { query: { enabled: !!jobId, queryKey: getListJobMessagesQueryKey(jobId), refetchInterval: 15_000 } });
  const sendMessage = useSendFieldJobMessage();
  
  const photos = useListProofPhotos(jobId, { query: { enabled: !!jobId, queryKey: ['proofPhotos', jobId] } });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<'before' | 'after' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const [incidentText, setIncidentText] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionMins, setCorrectionMins] = useState(0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [message, setMessage] = useState('');
  const [pendingActions, setPendingActions] = useState<Partial<Record<CleanerAction, boolean>>>({});
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [pendingChecklistId, setPendingChecklistId] = useState<number | null>(null);

  const setActionPending = (action: CleanerAction, pending: boolean) => {
    setPendingActions((current) => ({ ...current, [action]: pending }));
  };

  const showActionFeedback = (action: CleanerAction, kind: ActionFeedback['kind'], message: string, retry?: () => void) => {
    setActionFeedback({ action, kind, message });
    setRetryAction(kind === 'error' ? retry || null : null);
  };

  if (isLoading) return <LoadingState label="Loading job details" />;
  if (isError || !job) return <ErrorState onRetry={() => void refetch()} />;

  const handleRespond = (decision: 'accept' | 'decline') => {
    if (pendingActions[decision]) return;
    setActionPending(decision, true);
    setActionFeedback(null);
    respond.mutate({ id: assignmentId, decision }, {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() });
        await refetch();
        setActionPending(decision, false);
        showActionFeedback(decision, 'success', decision === 'accept' ? 'Job accepted.' : 'Job declined.');
      },
      onError: () => {
        setActionPending(decision, false);
        showActionFeedback(decision, 'error', `Could not ${decision} this job.`, () => handleRespond(decision));
      },
    });
  };

  const handleClockIn = () => {
    if (pendingActions['clock-in']) return;
    setActionPending('clock-in', true);
    setActionFeedback(null);
    clockIn.mutate({ jobId }, {
      onSuccess: async () => {
        await activeEntries.refetch();
        await refetch();
        setActionPending('clock-in', false);
        showActionFeedback('clock-in', 'success', 'You are clocked in.');
      },
      onError: () => {
        setActionPending('clock-in', false);
        showActionFeedback('clock-in', 'error', 'Could not clock in.', handleClockIn);
      },
    });
  };
  
  const handleClockOut = () => {
    if (!activeEntry) return;
    if (pendingActions['clock-out']) return;
    setActionPending('clock-out', true);
    setActionFeedback(null);
    clockOut.mutate({ id: activeEntry.id }, {
      onSuccess: async () => {
        await activeEntries.refetch();
        await refetch();
        setActionPending('clock-out', false);
        showActionFeedback('clock-out', 'success', 'You are clocked out.');
      },
      onError: () => {
        setActionPending('clock-out', false);
        showActionFeedback('clock-out', 'error', 'Could not clock out.', handleClockOut);
      },
    });
  };
  
  const handleBreak = () => {
    if (!activeEntry) return;
    if (pendingActions.break) return;
    setActionPending('break', true);
    setActionFeedback(null);
    breakTime.mutate({ id: activeEntry.id, data: { minutes: 15 } }, {
      onSuccess: async () => {
        await activeEntries.refetch();
        setActionPending('break', false);
        showActionFeedback('break', 'success', '15-minute break recorded.');
      },
      onError: () => {
        setActionPending('break', false);
        showActionFeedback('break', 'error', 'Could not record the break.', handleBreak);
      },
    });
  };
  
  const handleCorrection = () => {
    if (!activeEntry || !correctionMins || !correctionReason.trim() || pendingActions.correction) return;
    setActionPending('correction', true);
    setActionFeedback(null);
    correction.mutate({ id: activeEntry.id, data: { minutes: correctionMins, reason: correctionReason.trim() } }, {
      onSuccess: async () => {
        await activeEntries.refetch();
        setActionPending('correction', false);
        setShowCorrection(false);
        setCorrectionMins(0);
        setCorrectionReason('');
        showActionFeedback('correction', 'success', 'Time correction sent for review.');
      },
      onError: () => {
        setActionPending('correction', false);
        showActionFeedback('correction', 'error', 'Could not send the time correction.', handleCorrection);
      },
    });
  };

  const handleChecklist = (itemId: number, completed: boolean) => {
    if (pendingChecklistId !== null) return;
    setPendingChecklistId(itemId);
    setActionFeedback(null);
    checklist.mutate({ id: job.id, data: { itemId, completed } }, {
      onSuccess: async () => {
        await refetch();
        setPendingChecklistId(null);
        showActionFeedback('checklist', 'success', completed ? 'Checklist item completed.' : 'Checklist item reopened.');
      },
      onError: () => {
        setPendingChecklistId(null);
        showActionFeedback('checklist', 'error', 'Could not update that checklist item.', () => handleChecklist(itemId, completed));
      },
    });
  };

  const handleIncident = () => {
    if (!incidentText.trim()) return;
    reportIncident.mutate({ jobId, data: { description: incidentText, severity: incidentSeverity } }, { onSuccess: () => {
      setIncidentText('');
      setIncidentSeverity('medium');
    }});
  };

  const incompleteChecklistItems = (job.checklist || []).filter((item) => !item.completed);
  const hasBefore = Boolean(photos.data?.some((photo) => photo.kind === 'before'));
  const hasAfter = Boolean(photos.data?.some((photo) => photo.kind === 'after'));
  const completionBlockers = [
    ...(incompleteChecklistItems.length
      ? [`Complete ${incompleteChecklistItems.length} checklist item${incompleteChecklistItems.length === 1 ? '' : 's'}: ${incompleteChecklistItems.map((item) => item.label).join(', ')}`]
      : []),
    ...(!hasBefore ? ['Upload a Before proof photo'] : []),
    ...(!hasAfter ? ['Upload an After proof photo'] : []),
    ...(activeEntry ? ['Clock out before completing the job'] : []),
  ];
  const isChecklistComplete = incompleteChecklistItems.length === 0;
  const canComplete = job.status !== 'completed' && completionBlockers.length === 0 && !pendingActions.complete;

  const handleComplete = () => {
    if (!canComplete) return;
    setActionPending('complete', true);
    setActionFeedback(null);
    setRetryAction(null);
    completeJob.mutate({ jobId }, {
      onSuccess: async () => {
        await refetch();
        await qc.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        await qc.invalidateQueries({ queryKey: getListAssignedJobsQueryKey() });
        setActionPending('complete', false);
        showActionFeedback('complete', 'success', 'Job completed successfully.');
      },
      onError: () => {
        setActionPending('complete', false);
        showActionFeedback('complete', 'error', 'Mawii could not close this job.', handleComplete);
      },
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'before' | 'after') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setUploadKind(kind);
    setUploadError(null);
    setUploadFeedback(null);
    try {
      const { uploadURL, objectPath } = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type }
      });

      const upload = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      // Without this check a failed upload still registered the photo, so the job looked
      // documented while the file was never stored.
      if (!upload.ok) throw new Error(`Upload failed with status ${upload.status}`);

      await registerPhoto.mutateAsync({
        jobId, data: { kind, objectPath, contentType: file.type, byteSize: file.size }
      });

      await refetch();
      await photos.refetch();
      setUploadFeedback(`${kind === 'before' ? 'Before' : 'After'} photo saved to job.`);
    } catch (err) {
      console.error(err);
      setUploadError('That photo did not upload. Check your signal and try again.');
    } finally {
      setIsUploading(false);
      setUploadKind(null);
      e.target.value = '';
    }
  };

  return (
    <div className="content-stack animate-rise">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button className="icon-button" onClick={onBack} aria-label="Back to my jobs"><ChevronRight size={17} style={{ transform: 'rotate(180deg)' }}/></button>
        <h2 style={{ fontSize: '20px', margin: 0 }}>Job #{String(job.id).padStart(4, '0')}</h2>
      </div>

      <section className="panel job-detail">
        <div className="detail-top">
          <div>
            <h2>{job.clientName}</h2>
            <p><AddressLink address={job.address} /></p>
          </div>
          <Badge tone={statusTone(job.status || initialAssignmentStatus)}>{statusLabel(job.status || initialAssignmentStatus)}</Badge>
        </div>

        {actionFeedback ? (
          <div className={`action-feedback action-feedback-${actionFeedback.kind}`} role={actionFeedback.kind === 'error' ? 'alert' : 'status'}>
            <span>{actionFeedback.message}</span>
            {actionFeedback.kind === 'error' && retryAction ? <button type="button" className="text-button" onClick={retryAction}>Retry</button> : null}
          </div>
        ) : null}
        
        <div className="detail-stat-row">
          <div><span>Window</span><strong>{formatTime(job.startTime)} – {formatTime(job.endTime)}</strong></div>
          <div><span>Service</span><strong>{job.serviceType}</strong></div>
          {/* Names only. The checklist tells the crew to complete the selected add-ons, so
              they have to know which ones — what the client paid is not their business. */}
          {job.addOns?.length ? <div><span>Add-ons</span><strong>{job.addOns.join(', ')}</strong></div> : null}
        </div>

        {job.notes && (
          <div className="message-box" style={{ marginBottom: '16px', background: 'hsl(var(--secondary))' }}>
            <strong>Access & cleaner notes</strong>
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
              <button className="button button-primary" onClick={handleClockOut} disabled={Boolean(pendingActions['clock-out'])}><Check size={15}/> {pendingActions['clock-out'] ? 'Clocking out...' : 'Clock out'}</button>
              <button className="button button-secondary" onClick={handleBreak} disabled={Boolean(pendingActions.break)}><Coffee size={15}/> {pendingActions.break ? 'Recording...' : '15m Break'}</button>
              <button className="button button-secondary" style={{ gridColumn: 'span 2' }} onClick={() => setShowCorrection(!showCorrection)}>Request Correction</button>
            </div>
          ) : (
            <button className="button button-primary" style={{ width: '100%' }} onClick={handleClockIn} disabled={Boolean(pendingActions['clock-in'])}><Clock3 size={15}/> {pendingActions['clock-in'] ? 'Clocking in...' : 'Clock in'}</button>
          )}

          {showCorrection && activeEntry && (
            <div className="correction-form">
              <label>Minutes
                <input type="number" inputMode="numeric" placeholder="e.g. 15" value={correctionMins || ''} onChange={(e) => setCorrectionMins(Number(e.target.value))} />
              </label>
              <label className="correction-reason">Reason
                <input value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} placeholder="What needs correcting?" />
              </label>
              {correctionMins ? <p className="muted-copy correction-preview">Requested adjustment: {correctionMins > 0 ? '+' : ''}{correctionMins} minutes.</p> : null}
              {activeEntry.correctionStatus ? <p className="muted-copy correction-preview">Current correction status: {activeEntry.correctionStatus}.</p> : null}
              <button className="button button-secondary" onClick={handleCorrection} disabled={!correctionMins || !correctionReason.trim() || Boolean(pendingActions.correction)}>{pendingActions.correction ? 'Sending...' : 'Send request'}</button>
            </div>
          )}
        </div>

        <div className="team-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <button className="button button-secondary" onClick={() => handleRespond('accept')} disabled={Boolean(pendingActions.accept)}>{pendingActions.accept ? 'Accepting...' : 'Accept job'}</button>
          <button className="button button-secondary" onClick={() => handleRespond('decline')} disabled={Boolean(pendingActions.decline)} style={{ color: 'hsl(var(--destructive))' }}>{pendingActions.decline ? 'Declining...' : 'Decline'}</button>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Tasks</span><h3>Checklist</h3></div>
          </div>
          <div className="checklist">
            {job.checklist?.map((item) => (
              <label className={`check-row ${item.completed ? 'check-complete' : ''}`} key={item.id}>
                <input type="checkbox" checked={item.completed} disabled={pendingChecklistId === item.id} onChange={(e) => handleChecklist(item.id, e.target.checked)} />
                <span>{item.label}</span>
                {item.completed && <Check size={15} />}
              </label>
            ))}
          </div>
        </div>

        <div className="detail-section proof-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Proof</span><h3>Photos</h3></div>
            {isUploading && <span className="upload-status" role="status">Uploading {uploadKind} photo...</span>}
          </div>
          {uploadError ? <p className="form-error" data-testid="text-upload-error">{uploadError}</p> : null}
          {uploadFeedback ? <p className="upload-success" role="status">{uploadFeedback}</p> : null}
          
          <div className="proof-upload-actions">
            <label className="proof-upload-button">
              <Camera size={18}/> <span>Before photo</span>
              <small>{uploadKind === 'before' ? 'Uploading...' : hasBefore ? 'Add another' : 'Required before service'}</small>
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, 'before')} disabled={isUploading} />
            </label>
            <label className="proof-upload-button">
              <Camera size={18}/> <span>After photo</span>
              <small>{uploadKind === 'after' ? 'Uploading...' : hasAfter ? 'Add another' : 'Required after service'}</small>
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

        <div className="detail-section">
          <div className="detail-section-head">
            <div><span className="eyebrow">Team thread</span><h3>Internal job chat</h3></div>
          </div>
          {messages.data?.length ? (
            <div style={{ display: 'grid', gap: '8px', marginBottom: '10px' }}>
              {messages.data.filter((item) => item.audience === 'employee').map((item) => (
                <div key={item.id} style={{ padding: '8px', borderRadius: '7px', background: 'hsl(var(--secondary))', fontSize: '11px' }}>
                  <div>{item.body}</div>
                  <small className="muted-copy">{formatTime(item.createdAt.split('T')[1] || item.createdAt)} · Internal</small>
                </div>
              ))}
            </div>
          ) : <p className="muted-copy">No internal messages yet.</p>}
          <div className="message-input">
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message the operations desk" />
            <button
              disabled={!message.trim() || sendMessage.isPending}
              onClick={() => sendMessage.mutate({ jobId, data: { body: message.trim(), audience: 'employee', recipient: 'operations' } }, {
                onSuccess: () => {
                  setMessage('');
                  void qc.invalidateQueries({ queryKey: getListJobMessagesQueryKey(jobId) });
                },
              })}
            ><Check size={15} /></button>
          </div>
        </div>

        <div className="detail-section" style={{ padding: '16px', background: 'hsl(var(--secondary))', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ marginBottom: '12px' }}>
            <strong>Complete Assignment</strong>
          </div>
          {!canComplete && (
            <div className="completion-blockers">
              {completionBlockers.map((blocker) => <span key={blocker}>• {blocker}</span>)}
            </div>
          )}
          <button 
            className="button button-primary" 
            style={{ width: '100%', height: '36px' }} 
            disabled={!canComplete || Boolean(pendingActions.complete) || job.status === 'completed'}
            onClick={handleComplete}
          >
            {job.status === 'completed' ? 'Job Completed' : pendingActions.complete ? 'Completing...' : 'Complete Job'}
          </button>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '10px' }}>
              Severity
              <select value={incidentSeverity} onChange={(e) => setIncidentSeverity(e.target.value as typeof incidentSeverity)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <span className="message-note" style={{ marginTop: '8px' }}>
              <AlertTriangle size={13} /> {reportIncident.isSuccess ? 'Reported successfully' : 'Incidents alert dispatch immediately.'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
