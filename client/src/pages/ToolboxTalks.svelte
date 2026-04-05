<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../lib/api';
	import { user } from '../lib/stores';

	// ── Types ──────────────────────────────────────────────────────
	interface Talk {
		id: number;
		job_id: number;
		job_name: string;
		job_number: string;
		scheduled_date: string;
		topic: string;
		osha_standard: string | null;
		generated_content: string | null;
		presented_by: number | null;
		presenter_first_name: string | null;
		presenter_last_name: string | null;
		status: string;
		duration: number;
		notes: string | null;
		completed_at: string | null;
		attendee_count: number;
		signed_count: number;
		attendees?: Attendee[];
	}

	interface Attendee {
		id: number;
		employee_id: number;
		first_name: string;
		last_name: string;
		classification: string | null;
		photo_url: string | null;
		signed_at: string | null;
		signed_by_name: string | null;
		signature_hash: string | null;
	}

	interface OshaTopic {
		topic: string;
		oshaStandard: string;
		category: string;
	}

	interface CrewMember {
		id: number;
		first_name: string;
		last_name: string;
		classification: string | null;
	}

	// ── State ──────────────────────────────────────────────────────
	let talks: Talk[] = [];
	let stats: any = { total: 0, draft: 0, scheduled: 0, presented: 0, completed: 0 };
	let selectedTalk: Talk | null = null;
	let jobs: any[] = [];
	let employees: any[] = [];
	let oshaTopics: OshaTopic[] = [];
	let crewPreview: CrewMember[] = [];
	let crewSource: string = '';

	let filterStatus: string = 'all';
	let filterJobId: string = '';

	let showCreateModal: boolean = false;
	let creating: boolean = false;
	let generating: boolean = false;
	let createForm = {
		jobId: '',
		scheduledDate: new Date().toISOString().split('T')[0],
		topic: '',
		presentedBy: '',
		duration: 15,
		notes: ''
	};
	let topicCategoryFilter: string = 'all';

	let editingContent: boolean = false;
	let editedContent: string = '';

	let loading: boolean = false;
	let error: string | null = null;

	// ── Helpers ────────────────────────────────────────────────────
	function formatDate(d: string | null) {
		if (!d) return '';
		return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function formatDateShort(d: string | null) {
		if (!d) return '';
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function presenterName(talk: Talk) {
		if (talk.presenter_first_name && talk.presenter_last_name) {
			return `${talk.presenter_first_name} ${talk.presenter_last_name}`;
		}
		return '—';
	}

	function statusColor(status: string) {
		switch (status) {
			case 'completed': return 'oklch(0.72 0.19 142)';   // green
			case 'presented': return 'oklch(0.70 0.15 250)';   // blue
			case 'scheduled': return 'oklch(0.75 0.18 80)';    // amber
			case 'draft':     return 'oklch(0.65 0.02 250)';   // gray
			default:          return 'oklch(0.65 0.02 250)';
		}
	}

	function statusLabel(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

	function getJobName(jobId: number) {
		const j = jobs.find(j => j.id === jobId);
		return j ? j.name : '';
	}
	function getJobNumber(jobId: number) {
		const j = jobs.find(j => j.id === jobId);
		return j ? j.job_number : '';
	}

	function getAvailableEmployees() {
		const ids = selectedTalk?.attendees?.map(a => a.employee_id) || [];
		return employees.filter(e => !ids.includes(e.id) && e.status === 'active');
	}

	// ── Data loading ──────────────────────────────────────────────
	async function loadData() {
		loading = true;
		error = null;
		try {
			const [talksRes, statsRes, jobsRes, empsRes, topicsRes] = await Promise.all([
				api.get('/toolbox-talks/'),
				api.get('/toolbox-talks/stats/summary'),
				api.get('/jobs'),
				api.get('/employees'),
				api.get('/toolbox-talks/topics')
			]);
			talks = talksRes || [];
			stats = statsRes || { total: 0, draft: 0, scheduled: 0, presented: 0, completed: 0 };
			jobs = (jobsRes || []).filter((j: any) => j.status === 'active');
			employees = (empsRes || []).filter((e: any) => e.status === 'active');
			oshaTopics = topicsRes || [];
		} catch (e) {
			error = 'Failed to load data';
			console.error(e);
		} finally {
			loading = false;
		}
	}

	// ── Filtered + sorted talks ───────────────────────────────────
	$: filteredTalks = talks
		.filter(t => {
			if (filterStatus !== 'all' && t.status !== filterStatus) return false;
			if (filterJobId && String(t.job_id) !== filterJobId) return false;
			return true;
		})
		.sort((a, b) => new Date(b.scheduled_date).getTime() - new Date(a.scheduled_date).getTime());

	// ── Filtered topics for create modal ──────────────────────────
	$: filteredTopics = topicCategoryFilter === 'all'
		? oshaTopics
		: oshaTopics.filter(t => t.category === topicCategoryFilter);

	$: topicCategories = [...new Set(oshaTopics.map(t => t.category))];

	$: selectedTopicInfo = oshaTopics.find(t => t.topic === createForm.topic) || null;

	// ── Select talk ───────────────────────────────────────────────
	async function selectTalk(talk: Talk) {
		try {
			const detail = await api.get(`/toolbox-talks/${talk.id}`);
			selectedTalk = detail;
			editingContent = false;
			editedContent = detail.generated_content || '';
		} catch (e) {
			error = 'Failed to load talk details';
		}
	}

	// ── Create talk ───────────────────────────────────────────────
	async function openCreateModal() {
		createForm = {
			jobId: '',
			scheduledDate: new Date().toISOString().split('T')[0],
			topic: '',
			presentedBy: '',
			duration: 15,
			notes: ''
		};
		crewPreview = [];
		crewSource = '';
		topicCategoryFilter = 'all';
		showCreateModal = true;
	}

	async function loadCrewPreview() {
		if (!createForm.jobId) { crewPreview = []; crewSource = ''; return; }
		try {
			const res = await api.get(`/toolbox-talks/crew/${createForm.jobId}?date=${createForm.scheduledDate}`);
			crewPreview = res.crew || [];
			crewSource = res.source || '';
		} catch { crewPreview = []; crewSource = ''; }
	}

	$: if (createForm.jobId || createForm.scheduledDate) { loadCrewPreview(); }

	async function createTalk() {
		if (!createForm.jobId || !createForm.scheduledDate || !createForm.topic || !createForm.presentedBy) {
			error = 'Please fill in all required fields';
			return;
		}
		creating = true;
		try {
			await api.post('/toolbox-talks/', {
				jobId: createForm.jobId,
				scheduledDate: createForm.scheduledDate,
				topic: createForm.topic,
				presentedBy: createForm.presentedBy,
				duration: createForm.duration,
				notes: createForm.notes
			});
			showCreateModal = false;
			await loadData();
		} catch (e) {
			error = 'Failed to create talk';
		} finally {
			creating = false;
		}
	}

	// ── Generate content ──────────────────────────────────────────
	async function generateContent() {
		if (!selectedTalk) return;
		generating = true;
		try {
			const updated = await api.post(`/toolbox-talks/${selectedTalk.id}/generate`, {});
			selectedTalk = updated;
			editedContent = updated.generated_content || '';
			talks = talks.map(t => t.id === updated.id ? { ...t, ...updated } : t);
		} catch (e) {
			error = 'Failed to generate content';
		} finally {
			generating = false;
		}
	}

	// ── Save content edit ─────────────────────────────────────────
	async function saveContentEdit() {
		if (!selectedTalk) return;
		try {
			const updated = await api.put(`/toolbox-talks/${selectedTalk.id}`, { generated_content: editedContent });
			selectedTalk = updated;
			talks = talks.map(t => t.id === updated.id ? { ...t, ...updated } : t);
			editingContent = false;
		} catch (e) {
			error = 'Failed to save content';
		}
	}

	// ── Attendee actions ──────────────────────────────────────────
	async function autoPopulateAttendees() {
		if (!selectedTalk) return;
		try {
			const updated = await api.post(`/toolbox-talks/${selectedTalk.id}/attendees/batch`, {});
			selectedTalk = updated;
			talks = talks.map(t => t.id === updated.id ? { ...t, attendee_count: updated.attendees?.length || t.attendee_count } : t);
		} catch (e) {
			error = 'Failed to auto-populate attendees';
		}
	}

	async function addAttendee(empId: number) {
		if (!selectedTalk) return;
		try {
			const updated = await api.post(`/toolbox-talks/${selectedTalk.id}/attendees`, { employeeId: empId });
			selectedTalk = updated;
			talks = talks.map(t => t.id === updated.id ? { ...t, attendee_count: updated.attendees?.length || t.attendee_count } : t);
		} catch (e) {
			error = 'Failed to add attendee';
		}
	}

	async function removeAttendee(attendeeId: number) {
		if (!selectedTalk) return;
		try {
			const updated = await api.del(`/toolbox-talks/${selectedTalk.id}/attendees/${attendeeId}`);
			selectedTalk = updated;
			talks = talks.map(t => t.id === updated.id ? { ...t, attendee_count: updated.attendees?.length || t.attendee_count } : t);
		} catch (e) {
			error = 'Failed to remove attendee';
		}
	}

	async function signAttendee(attendeeId: number) {
		if (!selectedTalk) return;
		try {
			const updated = await api.put(`/toolbox-talks/${selectedTalk.id}/attendees/${attendeeId}/sign`, {});
			selectedTalk = updated;
			// Refresh stats if auto-completed
			if (updated.status === 'completed') {
				stats = await api.get('/toolbox-talks/stats/summary');
				talks = talks.map(t => t.id === updated.id ? { ...t, ...updated, signed_count: (updated.attendees || []).filter((a: Attendee) => a.signed_at).length } : t);
			} else {
				talks = talks.map(t => t.id === updated.id ? { ...t, signed_count: (updated.attendees || []).filter((a: Attendee) => a.signed_at).length } : t);
			}
		} catch (e) {
			error = 'Failed to sign attendee';
		}
	}

	// ── Update status ─────────────────────────────────────────────
	async function updateStatus(newStatus: string) {
		if (!selectedTalk) return;
		try {
			const updated = await api.put(`/toolbox-talks/${selectedTalk.id}`, { status: newStatus });
			selectedTalk = updated;
			talks = talks.map(t => t.id === updated.id ? { ...t, ...updated } : t);
			stats = await api.get('/toolbox-talks/stats/summary');
		} catch (e) {
			error = 'Failed to update status';
		}
	}

	// ── Delete talk ───────────────────────────────────────────────
	async function deleteTalk() {
		if (!selectedTalk || !confirm('Delete this toolbox talk? This cannot be undone.')) return;
		try {
			await api.del(`/toolbox-talks/${selectedTalk.id}`);
			talks = talks.filter(t => t.id !== selectedTalk!.id);
			selectedTalk = null;
			stats = await api.get('/toolbox-talks/stats/summary');
		} catch (e) {
			error = 'Failed to delete talk';
		}
	}

	// ── Export ─────────────────────────────────────────────────────
	function exportTalk() {
		if (!selectedTalk) return;
		window.open(`/api/toolbox-talks/${selectedTalk.id}/export`, '_blank');
	}

	function handleAttendeeSelect(e: Event) {
		const target = e.target as HTMLSelectElement;
		if (target?.value) {
			addAttendee(parseInt(target.value));
			target.value = '';
		}
	}

	onMount(loadData);
</script>

<div class="tt-container">
	<!-- Header -->
	<div class="tt-header">
		<h1 class="tt-title">Toolbox Talks</h1>
		<button class="tt-btn-create" on:click={openCreateModal}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
			New Talk
		</button>
	</div>

	<!-- Error banner -->
	{#if error}
		<div class="tt-error">
			<span>{error}</span>
			<button on:click={() => (error = null)}>×</button>
		</div>
	{/if}

	<!-- Status pills -->
	<div class="tt-status-row">
		<button class="tt-pill" class:tt-pill-active={filterStatus === 'all'} on:click={() => (filterStatus = 'all')}>
			All <span class="tt-pill-count">{stats.total || 0}</span>
		</button>
		<button class="tt-pill" class:tt-pill-active={filterStatus === 'scheduled'} on:click={() => (filterStatus = filterStatus === 'scheduled' ? 'all' : 'scheduled')}>
			<span class="tt-dot" style="background: oklch(0.75 0.18 80);"></span> Scheduled <span class="tt-pill-count">{stats.scheduled || 0}</span>
		</button>
		<button class="tt-pill" class:tt-pill-active={filterStatus === 'presented'} on:click={() => (filterStatus = filterStatus === 'presented' ? 'all' : 'presented')}>
			<span class="tt-dot" style="background: oklch(0.70 0.15 250);"></span> Presented <span class="tt-pill-count">{stats.presented || 0}</span>
		</button>
		<button class="tt-pill" class:tt-pill-active={filterStatus === 'completed'} on:click={() => (filterStatus = filterStatus === 'completed' ? 'all' : 'completed')}>
			<span class="tt-dot" style="background: oklch(0.72 0.19 142);"></span> Completed <span class="tt-pill-count">{stats.completed || 0}</span>
		</button>
		<button class="tt-pill" class:tt-pill-active={filterStatus === 'draft'} on:click={() => (filterStatus = filterStatus === 'draft' ? 'all' : 'draft')}>
			<span class="tt-dot" style="background: oklch(0.65 0.02 250);"></span> Draft <span class="tt-pill-count">{stats.draft || 0}</span>
		</button>

		<!-- Job filter -->
		<select class="tt-job-filter" bind:value={filterJobId}>
			<option value="">All Jobs</option>
			{#each jobs as job (job.id)}
				<option value={String(job.id)}>{job.job_number} — {job.name}</option>
			{/each}
		</select>
	</div>

	<!-- Split layout -->
	<div class="tt-split">
		<!-- List panel -->
		<div class="tt-list-panel">
			{#if loading}
				<div class="tt-empty"><span class="loading loading-spinner loading-sm"></span> Loading…</div>
			{:else if filteredTalks.length === 0}
				<div class="tt-empty">No toolbox talks found</div>
			{:else}
				{#each filteredTalks as talk (talk.id)}
					<button
						class="tt-list-item"
						class:tt-list-item-active={selectedTalk?.id === talk.id}
						on:click={() => selectTalk(talk)}
					>
						<div class="tt-list-top">
							<span class="tt-list-topic">{talk.topic}</span>
							<span class="tt-status-badge" style="--badge-color: {statusColor(talk.status)}">
								{statusLabel(talk.status)}
							</span>
						</div>
						<div class="tt-list-meta">
							<span class="tt-list-job">{talk.job_number || ''}</span>
							<span class="tt-list-date">{formatDateShort(talk.scheduled_date)}</span>
							<span class="tt-list-presenter">{presenterName(talk)}</span>
							<span class="tt-list-sigs">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
								{talk.signed_count || 0}/{talk.attendee_count || 0}
							</span>
						</div>
					</button>
				{/each}
			{/if}
		</div>

		<!-- Detail panel -->
		<div class="tt-detail-panel">
			{#if selectedTalk}
				<!-- Detail header -->
				<div class="tt-detail-header">
					<div class="tt-detail-header-left">
						<h2 class="tt-detail-topic">{selectedTalk.topic}</h2>
						{#if selectedTalk.osha_standard}
							<span class="tt-osha-badge">{selectedTalk.osha_standard}</span>
						{/if}
					</div>
					<button class="tt-close" on:click={() => (selectedTalk = null)}>×</button>
				</div>

				<!-- Meta grid -->
				<div class="tt-meta-grid">
					<div class="tt-meta-item">
						<span class="tt-meta-label">Job</span>
						<span class="tt-meta-value">{getJobNumber(selectedTalk.job_id)} — {getJobName(selectedTalk.job_id)}</span>
					</div>
					<div class="tt-meta-item">
						<span class="tt-meta-label">Date</span>
						<span class="tt-meta-value">{formatDate(selectedTalk.scheduled_date)}</span>
					</div>
					<div class="tt-meta-item">
						<span class="tt-meta-label">Presenter</span>
						<span class="tt-meta-value">{presenterName(selectedTalk)}</span>
					</div>
					<div class="tt-meta-item">
						<span class="tt-meta-label">Duration</span>
						<span class="tt-meta-value">{selectedTalk.duration} min</span>
					</div>
					<div class="tt-meta-item">
						<span class="tt-meta-label">Status</span>
						<span class="tt-status-badge" style="--badge-color: {statusColor(selectedTalk.status)}">
							{statusLabel(selectedTalk.status)}
						</span>
					</div>
					{#if selectedTalk.completed_at}
						<div class="tt-meta-item">
							<span class="tt-meta-label">Completed</span>
							<span class="tt-meta-value">{formatDate(selectedTalk.completed_at)}</span>
						</div>
					{/if}
				</div>

				<!-- Talk content -->
				<div class="tt-section">
					<div class="tt-section-head">
						<h3>Talk Content</h3>
						<div class="tt-section-actions">
							{#if selectedTalk.generated_content && !editingContent}
								<button class="tt-link-btn" on:click={() => { editingContent = true; editedContent = selectedTalk?.generated_content || ''; }}>Edit</button>
								<button class="tt-link-btn" on:click={generateContent} disabled={generating}>
									{generating ? 'Generating…' : 'Regenerate'}
								</button>
							{/if}
						</div>
					</div>

					{#if !selectedTalk.generated_content && !generating}
						<div class="tt-empty-content">
							<div class="tt-sparkle-icon">
								<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.15 250)" stroke-width="1.5">
									<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>
								</svg>
							</div>
							<p>Generate an AI-powered safety talk</p>
							<button class="tt-btn-generate" on:click={generateContent} disabled={generating}>
								{generating ? 'Generating…' : 'Generate Talk Content'}
							</button>
						</div>
					{:else if generating}
						<div class="tt-empty-content">
							<span class="loading loading-spinner loading-md"></span>
							<p>Generating OSHA-compliant talk content…</p>
						</div>
					{:else if editingContent}
						<textarea class="tt-content-edit" bind:value={editedContent}></textarea>
						<div class="tt-edit-actions">
							<button class="tt-btn-save" on:click={saveContentEdit}>Save</button>
							<button class="tt-btn-cancel" on:click={() => (editingContent = false)}>Cancel</button>
						</div>
					{:else}
						<div class="tt-content-body">{selectedTalk.generated_content}</div>
					{/if}
				</div>

				<!-- Attendees -->
				<div class="tt-section">
					<div class="tt-section-head">
						<h3>Attendees ({(selectedTalk.attendees || []).filter(a => a.signed_at).length}/{(selectedTalk.attendees || []).length})</h3>
						<button class="tt-link-btn" on:click={autoPopulateAttendees}>Auto-populate</button>
					</div>

					{#if selectedTalk.attendees && selectedTalk.attendees.length > 0}
						<div class="tt-attendee-list">
							{#each selectedTalk.attendees as att (att.id)}
								<div class="tt-attendee-row">
									<div class="tt-att-left">
										<div class="tt-att-avatar">
											{#if att.photo_url}
												<img src={att.photo_url} alt="" />
											{:else}
												<span>{att.first_name?.[0]}{att.last_name?.[0]}</span>
											{/if}
										</div>
										<div class="tt-att-info">
											<div class="tt-att-name">{att.first_name} {att.last_name}</div>
											{#if att.classification}
												<div class="tt-att-class">{att.classification}</div>
											{/if}
										</div>
									</div>
									<div class="tt-att-right">
										{#if att.signed_at}
											<span class="tt-signed-tag" title={att.signature_hash ? `Hash: ${att.signature_hash}` : ''}>
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
												Signed
											</span>
										{:else}
											<button class="tt-btn-sign" on:click={() => signAttendee(att.id)}>Sign</button>
										{/if}
										<button class="tt-btn-x" on:click={() => removeAttendee(att.id)}>×</button>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="tt-muted">No attendees yet — use auto-populate or add manually.</p>
					{/if}

					{#if getAvailableEmployees().length > 0}
						<select class="tt-add-attendee" on:change={handleAttendeeSelect}>
							<option value="">+ Add Attendee</option>
							{#each getAvailableEmployees() as emp (emp.id)}
								<option value={emp.id}>{emp.first_name} {emp.last_name}</option>
							{/each}
						</select>
					{/if}
				</div>

				<!-- Actions bar -->
				<div class="tt-action-bar">
					{#if selectedTalk.status === 'draft'}
						<button class="tt-btn-primary" on:click={() => updateStatus('scheduled')}>Schedule</button>
					{/if}
					{#if selectedTalk.status === 'scheduled'}
						<button class="tt-btn-primary" on:click={() => updateStatus('presented')}>Mark Presented</button>
					{/if}
					{#if selectedTalk.status === 'presented'}
						<button class="tt-btn-primary" on:click={() => updateStatus('completed')}>Complete</button>
					{/if}
					<button class="tt-btn-outline" on:click={exportTalk}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
						Export PDF
					</button>
					{#if $user?.role === 'super_admin' || $user?.role === 'admin'}
						<button class="tt-btn-danger" on:click={deleteTalk}>Delete</button>
					{/if}
				</div>
			{:else}
				<div class="tt-empty-detail">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="oklch(0.75 0 0)" stroke-width="1">
						<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
						<path d="M9 12l2 2 4-4" stroke-width="1.5"/>
					</svg>
					<p>Select a talk to view details</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Create Modal -->
{#if showCreateModal}
	<div class="tt-overlay" on:click={() => (showCreateModal = false)}>
		<div class="tt-modal" on:click|stopPropagation>
			<div class="tt-modal-head">
				<h2>New Toolbox Talk</h2>
				<button class="tt-close" on:click={() => (showCreateModal = false)}>×</button>
			</div>

			<div class="tt-modal-body">
				<!-- Job -->
				<label class="tt-field">
					<span class="tt-label">Job *</span>
					<select bind:value={createForm.jobId}>
						<option value="">Select job…</option>
						{#each jobs as job (job.id)}
							<option value={String(job.id)}>{job.job_number} — {job.name}</option>
						{/each}
					</select>
				</label>

				<!-- Crew preview -->
				{#if crewPreview.length > 0}
					<div class="tt-crew-preview">
						<span class="tt-crew-source">Crew from {crewSource} ({crewPreview.length})</span>
						<div class="tt-crew-chips">
							{#each crewPreview.slice(0, 8) as c (c.id)}
								<span class="tt-crew-chip">{c.first_name} {c.last_name?.[0]}.</span>
							{/each}
							{#if crewPreview.length > 8}
								<span class="tt-crew-chip">+{crewPreview.length - 8} more</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Date + Duration row -->
				<div class="tt-form-row">
					<label class="tt-field" style="flex:2">
						<span class="tt-label">Date *</span>
						<input type="date" bind:value={createForm.scheduledDate} />
					</label>
					<label class="tt-field" style="flex:1">
						<span class="tt-label">Duration (min)</span>
						<input type="number" bind:value={createForm.duration} min="5" step="5" />
					</label>
				</div>

				<!-- Topic -->
				<div class="tt-field">
					<span class="tt-label">Topic *</span>
					<div class="tt-topic-cats">
						<button class="tt-cat-pill" class:tt-cat-active={topicCategoryFilter === 'all'} on:click={() => (topicCategoryFilter = 'all')}>All</button>
						{#each topicCategories as cat}
							<button class="tt-cat-pill" class:tt-cat-active={topicCategoryFilter === cat} on:click={() => (topicCategoryFilter = cat)}>{cat}</button>
						{/each}
					</div>
					<select bind:value={createForm.topic}>
						<option value="">Select topic…</option>
						{#each filteredTopics as t (t.topic)}
							<option value={t.topic}>{t.topic}</option>
						{/each}
					</select>
					{#if selectedTopicInfo}
						<div class="tt-osha-ref">OSHA: {selectedTopicInfo.oshaStandard}</div>
					{/if}
				</div>

				<!-- Presenter -->
				<label class="tt-field">
					<span class="tt-label">Presenter *</span>
					<select bind:value={createForm.presentedBy}>
						<option value="">Select presenter…</option>
						{#each employees as emp (emp.id)}
							<option value={String(emp.id)}>{emp.first_name} {emp.last_name}</option>
						{/each}
					</select>
				</label>

				<!-- Notes -->
				<label class="tt-field">
					<span class="tt-label">Notes</span>
					<textarea bind:value={createForm.notes} placeholder="Optional notes…" rows="2"></textarea>
				</label>
			</div>

			<div class="tt-modal-foot">
				<button class="tt-btn-cancel" on:click={() => (showCreateModal = false)}>Cancel</button>
				<button class="tt-btn-primary" on:click={createTalk} disabled={creating}>
					{creating ? 'Creating…' : 'Create Talk'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Layout ──────────────────────────────────────────────── */
	.tt-container { max-width: 100%; }

	.tt-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 20px;
	}
	.tt-title {
		font-size: 22px; font-weight: 700; color: oklch(0.15 0 0);
		margin: 0; letter-spacing: -0.02em;
	}

	.tt-btn-create {
		display: inline-flex; align-items: center; gap: 6px;
		background: oklch(0.55 0.15 250); color: white;
		border: none; border-radius: 10px; padding: 10px 18px;
		font-size: 13px; font-weight: 600; cursor: pointer;
		transition: background 0.15s;
	}
	.tt-btn-create:hover { background: oklch(0.50 0.15 250); }

	/* ── Error ───────────────────────────────────────────────── */
	.tt-error {
		background: oklch(0.55 0.22 25); color: white;
		padding: 10px 16px; border-radius: 10px; margin-bottom: 16px;
		display: flex; justify-content: space-between; align-items: center; font-size: 13px;
	}
	.tt-error button { background: none; border: none; color: white; font-size: 18px; cursor: pointer; }

	/* ── Status pills ────────────────────────────────────────── */
	.tt-status-row {
		display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.tt-pill {
		display: inline-flex; align-items: center; gap: 5px;
		background: white; border: 1px solid oklch(0.90 0 0);
		border-radius: 100px; padding: 6px 14px;
		font-size: 12px; font-weight: 500; color: oklch(0.45 0 0);
		cursor: pointer; transition: all 0.15s;
	}
	.tt-pill:hover { border-color: oklch(0.75 0 0); }
	.tt-pill-active {
		background: oklch(0.95 0.03 250); border-color: oklch(0.55 0.15 250);
		color: oklch(0.40 0.15 250); font-weight: 600;
	}
	.tt-pill-count { opacity: 0.6; }
	.tt-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

	.tt-job-filter {
		margin-left: auto;
		border: 1px solid oklch(0.90 0 0); border-radius: 8px;
		padding: 6px 10px; font-size: 12px; background: white;
		color: oklch(0.30 0 0);
	}
	.tt-job-filter:focus { outline: none; border-color: oklch(0.55 0.15 250); }

	/* ── Split layout ────────────────────────────────────────── */
	.tt-split {
		display: grid; grid-template-columns: 380px 1fr; gap: 20px;
		min-height: calc(100vh - 240px);
	}
	@media (max-width: 960px) {
		.tt-split { grid-template-columns: 1fr; }
	}

	/* ── List panel ──────────────────────────────────────────── */
	.tt-list-panel {
		background: white; border: 1px solid oklch(0.92 0 0);
		border-radius: 14px; overflow-y: auto; max-height: calc(100vh - 240px);
	}
	.tt-list-item {
		display: block; width: 100%; text-align: left;
		padding: 14px 18px; border: none; background: none;
		border-bottom: 1px solid oklch(0.95 0 0);
		cursor: pointer; transition: background 0.12s;
	}
	.tt-list-item:hover { background: oklch(0.98 0 0); }
	.tt-list-item-active {
		background: oklch(0.96 0.02 250);
		border-left: 3px solid oklch(0.55 0.15 250);
	}
	.tt-list-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
	.tt-list-topic { font-size: 13px; font-weight: 600; color: oklch(0.20 0 0); line-height: 1.3; }
	.tt-list-meta { display: flex; gap: 12px; font-size: 11px; color: oklch(0.55 0 0); align-items: center; }
	.tt-list-job {
		background: oklch(0.95 0 0); padding: 1px 7px; border-radius: 4px;
		font-weight: 600; font-size: 10px; color: oklch(0.40 0 0);
	}
	.tt-list-sigs { display: inline-flex; align-items: center; gap: 3px; }

	/* ── Status badge (glass) ────────────────────────────────── */
	.tt-status-badge {
		display: inline-flex; align-items: center;
		background: color-mix(in oklch, var(--badge-color) 15%, transparent);
		color: var(--badge-color);
		border: 1px solid color-mix(in oklch, var(--badge-color) 25%, transparent);
		border-radius: 100px; padding: 2px 10px;
		font-size: 11px; font-weight: 600; white-space: nowrap;
		backdrop-filter: blur(16px);
	}

	/* ── Detail panel ────────────────────────────────────────── */
	.tt-detail-panel {
		background: white; border: 1px solid oklch(0.92 0 0);
		border-radius: 14px; padding: 24px; overflow-y: auto;
		max-height: calc(100vh - 240px);
	}
	.tt-detail-header {
		display: flex; justify-content: space-between; align-items: flex-start;
		margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid oklch(0.94 0 0);
	}
	.tt-detail-header-left { flex: 1; }
	.tt-detail-topic { margin: 0 0 8px; font-size: 20px; font-weight: 700; color: oklch(0.15 0 0); }
	.tt-osha-badge {
		display: inline-block; background: oklch(0.96 0.04 80);
		color: oklch(0.40 0.12 80); border: 1px solid oklch(0.88 0.06 80);
		border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 600;
	}
	.tt-close {
		background: none; border: none; font-size: 24px; color: oklch(0.65 0 0);
		cursor: pointer; width: 32px; height: 32px; line-height: 32px; text-align: center;
	}
	.tt-close:hover { color: oklch(0.30 0 0); }

	/* ── Meta grid ───────────────────────────────────────────── */
	.tt-meta-grid {
		display: grid; grid-template-columns: 1fr 1fr;
		gap: 12px 24px; background: oklch(0.98 0 0);
		border-radius: 10px; padding: 16px; margin-bottom: 24px;
	}
	.tt-meta-item { display: flex; flex-direction: column; gap: 2px; }
	.tt-meta-label { font-size: 11px; font-weight: 500; color: oklch(0.60 0 0); text-transform: uppercase; letter-spacing: 0.04em; }
	.tt-meta-value { font-size: 13px; font-weight: 500; color: oklch(0.20 0 0); }

	/* ── Sections ────────────────────────────────────────────── */
	.tt-section { margin-bottom: 24px; }
	.tt-section-head {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 12px;
	}
	.tt-section-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: oklch(0.25 0 0); }
	.tt-section-actions { display: flex; gap: 8px; }
	.tt-link-btn {
		background: none; border: none; color: oklch(0.55 0.15 250);
		font-size: 12px; font-weight: 500; cursor: pointer; padding: 2px 6px;
	}
	.tt-link-btn:hover { text-decoration: underline; }
	.tt-link-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ── Content area ────────────────────────────────────────── */
	.tt-empty-content {
		text-align: center; padding: 32px 16px;
		background: oklch(0.98 0 0); border-radius: 10px;
	}
	.tt-sparkle-icon { margin-bottom: 8px; }
	.tt-empty-content p { margin: 0 0 16px; color: oklch(0.55 0 0); font-size: 13px; }
	.tt-btn-generate {
		background: oklch(0.55 0.15 250); color: white;
		border: none; border-radius: 8px; padding: 10px 20px;
		font-size: 13px; font-weight: 600; cursor: pointer;
	}
	.tt-btn-generate:hover { background: oklch(0.50 0.15 250); }
	.tt-btn-generate:disabled { opacity: 0.5; cursor: not-allowed; }

	.tt-content-body {
		background: oklch(0.98 0 0); border: 1px solid oklch(0.93 0 0);
		border-radius: 10px; padding: 16px; font-size: 13px; line-height: 1.7;
		color: oklch(0.25 0 0); white-space: pre-wrap; word-break: break-word;
		max-height: 360px; overflow-y: auto;
	}
	.tt-content-edit {
		width: 100%; min-height: 200px; border: 1px solid oklch(0.88 0 0);
		border-radius: 10px; padding: 14px; font-size: 13px; line-height: 1.6;
		font-family: inherit; resize: vertical; color: oklch(0.20 0 0);
	}
	.tt-content-edit:focus { outline: none; border-color: oklch(0.55 0.15 250); box-shadow: 0 0 0 3px oklch(0.55 0.15 250 / 0.12); }
	.tt-edit-actions { display: flex; gap: 8px; margin-top: 10px; }

	/* ── Attendees ────────────────────────────────────────────── */
	.tt-attendee-list {
		border: 1px solid oklch(0.93 0 0); border-radius: 10px;
		overflow: hidden; margin-bottom: 10px;
	}
	.tt-attendee-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 10px 14px; border-bottom: 1px solid oklch(0.95 0 0);
		transition: background 0.12s;
	}
	.tt-attendee-row:last-child { border-bottom: none; }
	.tt-attendee-row:hover { background: oklch(0.98 0 0); }
	.tt-att-left { display: flex; align-items: center; gap: 10px; }
	.tt-att-avatar {
		width: 34px; height: 34px; border-radius: 50%; background: oklch(0.92 0 0);
		display: flex; align-items: center; justify-content: center;
		font-size: 11px; font-weight: 600; color: oklch(0.55 0 0);
		overflow: hidden; flex-shrink: 0;
	}
	.tt-att-avatar img { width: 100%; height: 100%; object-fit: cover; }
	.tt-att-name { font-size: 13px; font-weight: 500; color: oklch(0.20 0 0); }
	.tt-att-class { font-size: 11px; color: oklch(0.55 0 0); }
	.tt-att-right { display: flex; align-items: center; gap: 8px; }
	.tt-signed-tag {
		display: inline-flex; align-items: center; gap: 4px;
		color: oklch(0.50 0.16 142); font-size: 11px; font-weight: 600;
		cursor: help;
	}
	.tt-btn-sign {
		background: oklch(0.50 0.16 142); color: white;
		border: none; border-radius: 6px; padding: 4px 14px;
		font-size: 11px; font-weight: 600; cursor: pointer;
	}
	.tt-btn-sign:hover { background: oklch(0.45 0.16 142); }
	.tt-btn-x {
		background: none; border: none; color: oklch(0.72 0 0);
		font-size: 18px; cursor: pointer; padding: 0; width: 24px; height: 24px;
		display: flex; align-items: center; justify-content: center;
	}
	.tt-btn-x:hover { color: oklch(0.55 0.22 25); }
	.tt-muted { font-size: 13px; color: oklch(0.60 0 0); text-align: center; padding: 16px; }

	.tt-add-attendee {
		width: 100%; border: 1px solid oklch(0.92 0 0);
		border-radius: 8px; padding: 8px 10px; font-size: 12px;
		background: white; color: oklch(0.40 0 0);
	}

	/* ── Action bar ──────────────────────────────────────────── */
	.tt-action-bar {
		display: flex; gap: 10px; padding-top: 16px;
		border-top: 1px solid oklch(0.94 0 0); flex-wrap: wrap;
	}
	.tt-btn-primary {
		background: oklch(0.55 0.15 250); color: white;
		border: none; border-radius: 8px; padding: 9px 18px;
		font-size: 13px; font-weight: 600; cursor: pointer;
	}
	.tt-btn-primary:hover { background: oklch(0.50 0.15 250); }
	.tt-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.tt-btn-outline {
		display: inline-flex; align-items: center; gap: 6px;
		background: white; color: oklch(0.35 0 0);
		border: 1px solid oklch(0.88 0 0); border-radius: 8px;
		padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer;
	}
	.tt-btn-outline:hover { background: oklch(0.98 0 0); }
	.tt-btn-danger {
		background: oklch(0.55 0.22 25); color: white;
		border: none; border-radius: 8px; padding: 8px 16px;
		font-size: 13px; font-weight: 500; cursor: pointer;
	}
	.tt-btn-danger:hover { background: oklch(0.50 0.22 25); }
	.tt-btn-save {
		background: oklch(0.50 0.16 142); color: white;
		border: none; border-radius: 8px; padding: 8px 16px;
		font-size: 13px; font-weight: 600; cursor: pointer;
	}
	.tt-btn-cancel {
		background: oklch(0.93 0 0); color: oklch(0.35 0 0);
		border: none; border-radius: 8px; padding: 8px 16px;
		font-size: 13px; font-weight: 500; cursor: pointer;
	}

	/* ── Empty detail ────────────────────────────────────────── */
	.tt-empty-detail {
		display: flex; flex-direction: column; align-items: center;
		justify-content: center; min-height: 400px; gap: 12px;
	}
	.tt-empty-detail p { margin: 0; color: oklch(0.60 0 0); font-size: 14px; }
	.tt-empty { padding: 40px 16px; text-align: center; color: oklch(0.60 0 0); font-size: 13px; }

	/* ── Modal ────────────────────────────────────────────────── */
	.tt-overlay {
		position: fixed; inset: 0; background: oklch(0.15 0 0 / 0.45);
		display: flex; align-items: center; justify-content: center; z-index: 1000;
		backdrop-filter: blur(4px);
	}
	.tt-modal {
		background: white; border-radius: 16px; width: 92%; max-width: 540px;
		max-height: 90vh; display: flex; flex-direction: column;
		box-shadow: 0 24px 64px oklch(0.15 0 0 / 0.25);
	}
	.tt-modal-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 20px 24px; border-bottom: 1px solid oklch(0.93 0 0);
	}
	.tt-modal-head h2 { margin: 0; font-size: 17px; font-weight: 700; color: oklch(0.15 0 0); }
	.tt-modal-body { flex: 1; overflow-y: auto; padding: 20px 24px; }
	.tt-modal-foot {
		display: flex; gap: 10px; justify-content: flex-end;
		padding: 16px 24px; border-top: 1px solid oklch(0.93 0 0);
	}

	/* ── Form fields ─────────────────────────────────────────── */
	.tt-field { display: flex; flex-direction: column; margin-bottom: 16px; }
	.tt-label { font-size: 12px; font-weight: 600; color: oklch(0.45 0 0); margin-bottom: 5px; }
	.tt-field select,
	.tt-field input,
	.tt-field textarea {
		border: 1px solid oklch(0.90 0 0); border-radius: 8px;
		padding: 9px 12px; font-size: 13px; font-family: inherit;
		color: oklch(0.20 0 0); background: white;
	}
	.tt-field select:focus,
	.tt-field input:focus,
	.tt-field textarea:focus {
		outline: none; border-color: oklch(0.55 0.15 250);
		box-shadow: 0 0 0 3px oklch(0.55 0.15 250 / 0.12);
	}
	.tt-form-row { display: flex; gap: 12px; }

	/* ── Topic category pills ────────────────────────────────── */
	.tt-topic-cats { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
	.tt-cat-pill {
		background: oklch(0.96 0 0); border: 1px solid oklch(0.90 0 0);
		border-radius: 100px; padding: 3px 12px; font-size: 11px;
		font-weight: 500; color: oklch(0.45 0 0); cursor: pointer;
		transition: all 0.12s;
	}
	.tt-cat-pill:hover { border-color: oklch(0.75 0 0); }
	.tt-cat-active {
		background: oklch(0.50 0.15 250); color: white;
		border-color: oklch(0.50 0.15 250);
	}
	.tt-osha-ref {
		margin-top: 6px; font-size: 11px; color: oklch(0.50 0.10 80);
		font-weight: 500;
	}

	/* ── Crew preview ────────────────────────────────────────── */
	.tt-crew-preview {
		background: oklch(0.97 0.02 142); border: 1px solid oklch(0.90 0.04 142);
		border-radius: 10px; padding: 10px 14px; margin-bottom: 16px;
	}
	.tt-crew-source { font-size: 11px; font-weight: 600; color: oklch(0.45 0.10 142); display: block; margin-bottom: 6px; }
	.tt-crew-chips { display: flex; flex-wrap: wrap; gap: 4px; }
	.tt-crew-chip {
		background: white; border: 1px solid oklch(0.88 0.04 142);
		border-radius: 100px; padding: 2px 10px; font-size: 11px;
		color: oklch(0.35 0 0); font-weight: 500;
	}
</style>
