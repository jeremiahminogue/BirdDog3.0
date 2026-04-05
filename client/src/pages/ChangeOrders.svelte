<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '../lib/stores';
	import { api } from '../lib/api';

	// State
	let viewMode: string = 'pipeline'; // 'pipeline' or 'list'
	let stats: any = {
		total: 0,
		draft: 0,
		submitted: 0,
		assigned: 0,
		estimated: 0,
		approved: 0,
		rejected: 0,
		totalEstimatedCost: 0,
		priorities: { low: 0, normal: 0, high: 0, urgent: 0 }
	};
	let orders: any[] = [];
	let jobs: any[] = [];
	let estimators: any[] = [];
	let selectedOrder: any = null;
	let selectedOrderFull: any = null;
	let showCreateModal: boolean = false;
	let showDeleteConfirm: boolean = false;
	let deleteTarget: any = null;
	let loading: boolean = true;
	let error: string | null = null;

	// Form state for create modal
	let createForm: any = {
		jobId: '',
		title: '',
		description: '',
		locationDesc: '',
		requestedBy: $user?.id || '',
		priority: 'normal',
		dueDate: '',
		notes: ''
	};

	let nextCorNumber: string = '';

	// Detail panel editing state
	let detailEditing: any = {
		notes: false,
		estimate: false,
		assign: false
	};

	let estimateForm: any = {
		cost: '',
		hours: '',
		notes: ''
	};

	let assignForm: any = {
		estimatorId: ''
	};

	let photoForm: any = {
		photoUrl: '',
		caption: ''
	};

	// Sorting
	let sortCol: string = 'request_number';
	let sortAsc: boolean = true;

	function toggleSort(col: string) {
		if (sortCol === col) { sortAsc = !sortAsc; }
		else { sortCol = col; sortAsc = true; }
	}

	// Helper functions
	function formatDate(dateStr: string | null) {
		if (!dateStr) return '';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' } as any);
	}

	function statusColor(status: string) {
		const colors: Record<string, string> = {
			draft: '#8e8e93',
			submitted: '#007aff',
			assigned: '#5856d6',
			estimated: '#ff9500',
			approved: '#34c759',
			rejected: '#ff3b30'
		};
		return colors[status] || '#8e8e93';
	}

	function priorityColor(priority: string) {
		const colors: Record<string, string> = {
			low: '#8e8e93',
			normal: '#007aff',
			high: '#ff9500',
			urgent: '#ff3b30'
		};
		return colors[priority] || '#007aff';
	}

	function timeAgo(dateStr: string | null) {
		if (!dateStr) return '';
		const date = new Date(dateStr);
		const now = new Date();
		const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

		let interval = seconds / 31536000;
		if (interval > 1) return Math.floor(interval) + ' year' + (Math.floor(interval) > 1 ? 's' : '') + ' ago';

		interval = seconds / 2592000;
		if (interval > 1) return Math.floor(interval) + ' month' + (Math.floor(interval) > 1 ? 's' : '') + ' ago';

		interval = seconds / 86400;
		if (interval > 1) return Math.floor(interval) + ' day' + (Math.floor(interval) > 1 ? 's' : '') + ' ago';

		interval = seconds / 3600;
		if (interval > 1) return Math.floor(interval) + ' hour' + (Math.floor(interval) > 1 ? 's' : '') + ' ago';

		interval = seconds / 60;
		if (interval > 1) return Math.floor(interval) + ' minute' + (Math.floor(interval) > 1 ? 's' : '') + ' ago';

		return 'just now';
	}

	// API calls
	async function loadStats() {
		try {
			const response = await api.get('/change-orders/stats/summary');
			stats = response;
		} catch (err) {
			error = 'Failed to load stats';
			console.error(err);
		}
	}

	async function loadOrders() {
		try {
			loading = true;
			const response = await api.get('/change-orders/');
			orders = response;
		} catch (err) {
			error = 'Failed to load change orders';
			console.error(err);
		} finally {
			loading = false;
		}
	}

	async function loadJobs() {
		try {
			const response = await api.get('/jobs');
			jobs = response;
		} catch (err) {
			console.error('Failed to load jobs', err);
		}
	}

	async function loadEstimators() {
		try {
			const response = await api.get('/change-orders/estimators');
			estimators = response;
		} catch (err) {
			console.error('Failed to load estimators', err);
		}
	}

	async function fetchNextCorNumber() {
		if (!createForm.jobId) {
			nextCorNumber = '';
			return;
		}
		try {
			const response = await api.get(`/change-orders/next-number/${createForm.jobId}`);
			nextCorNumber = response.requestNumber;
		} catch (err) {
			console.error('Failed to fetch next COR number', err);
		}
	}

	async function selectOrder(order: any) {
		selectedOrder = order;
		try {
			const response = await api.get(`/change-orders/${order.id}`);
			selectedOrderFull = response;
			detailEditing = { notes: false, estimate: false, assign: false };
			estimateForm = { cost: '', hours: '', notes: '' };
			assignForm = { estimatorId: '' };
			photoForm = { photoUrl: '', caption: '' };
		} catch (err) {
			error = 'Failed to load change order details';
			console.error(err);
		}
	}

	async function createOrder() {
		if (!createForm.jobId || !createForm.title) {
			error = 'Job and Title are required';
			return;
		}
		try {
			const payload = {
				jobId: createForm.jobId,
				title: createForm.title,
				description: createForm.description,
				locationDesc: createForm.locationDesc,
				requestedBy: createForm.requestedBy,
				priority: createForm.priority,
				dueDate: createForm.dueDate || null,
				notes: createForm.notes
			};
			await api.post('/change-orders/', payload);
			showCreateModal = false;
			resetCreateForm();
			await loadOrders();
			await loadStats();
		} catch (err) {
			error = 'Failed to create change order';
			console.error(err);
		}
	}

	async function updateOrderStatus(newStatus: string) {
		if (!selectedOrderFull) return;
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, { status: newStatus });
			await loadOrders();
			await loadStats();
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
		} catch (err) {
			error = 'Failed to update status';
			console.error(err);
		}
	}

	async function assignToEstimator() {
		if (!selectedOrderFull || !assignForm.estimatorId) {
			error = 'Please select an estimator';
			return;
		}
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, {
				status: 'assigned',
				assignedTo: assignForm.estimatorId
			});
			await loadOrders();
			await loadStats();
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
			detailEditing.assign = false;
		} catch (err) {
			error = 'Failed to assign estimator';
			console.error(err);
		}
	}

	async function submitEstimate() {
		if (!selectedOrderFull || !estimateForm.cost) {
			error = 'Cost is required';
			return;
		}
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, {
				status: 'estimated',
				estimatedCost: parseFloat(estimateForm.cost),
				estimatedHours: estimateForm.hours ? parseFloat(estimateForm.hours) : null,
				estimateNotes: estimateForm.notes
			});
			await loadOrders();
			await loadStats();
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
			detailEditing.estimate = false;
		} catch (err) {
			error = 'Failed to submit estimate';
			console.error(err);
		}
	}

	async function approveOrder() {
		if (!selectedOrderFull) return;
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, { status: 'approved' });
			await loadOrders();
			await loadStats();
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
		} catch (err) {
			error = 'Failed to approve order';
			console.error(err);
		}
	}

	async function rejectOrder() {
		if (!selectedOrderFull) return;
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, { status: 'rejected' });
			await loadOrders();
			await loadStats();
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
		} catch (err) {
			error = 'Failed to reject order';
			console.error(err);
		}
	}

	async function updateNotes(newNotes: string) {
		if (!selectedOrderFull) return;
		try {
			await api.put(`/change-orders/${selectedOrderFull.id}`, { notes: newNotes });
			selectedOrderFull.notes = newNotes;
			detailEditing.notes = false;
		} catch (err) {
			error = 'Failed to update notes';
			console.error(err);
		}
	}

	async function addPhoto() {
		if (!selectedOrderFull || !photoForm.photoUrl) {
			error = 'Photo URL is required';
			return;
		}
		try {
			await api.post(`/change-orders/${selectedOrderFull.id}/photos`, {
				photoUrl: photoForm.photoUrl,
				caption: photoForm.caption
			});
			photoForm = { photoUrl: '', caption: '' };
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
		} catch (err) {
			error = 'Failed to add photo';
			console.error(err);
		}
	}

	async function deletePhoto(photoId: number) {
		if (!selectedOrderFull) return;
		try {
			await api.del(`/change-orders/${selectedOrderFull.id}/photos/${photoId}`);
			await selectOrder(orders.find((o) => o.id === selectedOrderFull.id));
		} catch (err) {
			error = 'Failed to delete photo';
			console.error(err);
		}
	}

	async function deleteOrder() {
		if (!deleteTarget) return;
		try {
			await api.del(`/change-orders/${deleteTarget.id}`);
			await loadOrders();
			await loadStats();
			selectedOrder = null;
			selectedOrderFull = null;
			showDeleteConfirm = false;
			deleteTarget = null;
		} catch (err) {
			error = 'Failed to delete change order';
			console.error(err);
		}
	}

	function resetCreateForm() {
		createForm = {
			jobId: '',
			title: '',
			description: '',
			locationDesc: '',
			requestedBy: $user?.id || '',
			priority: 'normal',
			dueDate: '',
			notes: ''
		};
		nextCorNumber = '';
	}

	function closeDetailPanel() {
		selectedOrder = null;
		selectedOrderFull = null;
	}

	// Computed helpers
	function getOrdersByStatus(status: string) {
		return orders.filter((o) => o.status === status);
	}

	function getPendingCount() {
		return (stats.submitted || 0) + (stats.assigned || 0);
	}

	function formatCurrency(value: number) {
		if (!value) return '$0.00';
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0
		}).format(value);
	}

	// Sorted orders reactive statement
	$: sortedOrders = (() => {
		const dir = sortAsc ? 1 : -1;
		return [...orders].sort((a, b) => {
			let va: any, vb: any;
			switch (sortCol) {
				case 'request_number':
					va = a.request_number || ''; vb = b.request_number || '';
					break;
				case 'title':
					va = (a.title || '').toLowerCase(); vb = (b.title || '').toLowerCase();
					break;
				case 'job_number':
					va = (a.job_number || '').toLowerCase(); vb = (b.job_number || '').toLowerCase();
					break;
				case 'status':
					va = a.status || ''; vb = b.status || '';
					break;
				case 'priority':
					const priorityOrder = { low: 1, normal: 2, high: 3, urgent: 4 };
					va = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
					vb = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
					break;
				case 'requested_by_first':
					va = `${a.requested_by_first || ''} ${a.requested_by_last || ''}`.toLowerCase();
					vb = `${b.requested_by_first || ''} ${b.requested_by_last || ''}`.toLowerCase();
					break;
				case 'assigned_to_first':
					va = `${a.assigned_to_first || ''} ${a.assigned_to_last || ''}`.toLowerCase();
					vb = `${b.assigned_to_first || ''} ${b.assigned_to_last || ''}`.toLowerCase();
					break;
				case 'estimated_cost':
					va = a.estimated_cost || 0; vb = b.estimated_cost || 0;
					break;
				case 'created_at':
					va = new Date(a.created_at || 0).getTime();
					vb = new Date(b.created_at || 0).getTime();
					break;
				default:
					return 0;
			}
			if (va < vb) return -1 * dir;
			if (va > vb) return 1 * dir;
			return 0;
		});
	})();

	// Lifecycle
	onMount(async () => {
		await Promise.all([loadStats(), loadOrders(), loadJobs(), loadEstimators()]);
	});
</script>

<div class="co-container">
	<!-- Header -->
	<div class="co-header">
		<h1 class="co-title">Change Orders</h1>
		<button class="co-btn-primary" on:click={() => (showCreateModal = true)}>New Request</button>
	</div>

	<!-- Stats Row -->
	<div class="co-stats-row">
		<div class="co-stat">
			<div class="co-stat-label">Total CORs</div>
			<div class="co-stat-value">{stats.total}</div>
		</div>
		<div class="co-stat">
			<div class="co-stat-label">Pending</div>
			<div class="co-stat-value">{getPendingCount()}</div>
		</div>
		<div class="co-stat">
			<div class="co-stat-label">Est. Cost</div>
			<div class="co-stat-value">{formatCurrency(stats.totalEstimatedCost)}</div>
		</div>
		<div class="co-stat {stats.priorities.urgent > 0 ? 'co-stat-urgent' : ''}">
			<div class="co-stat-label">Urgent</div>
			<div class="co-stat-value">{stats.priorities.urgent}</div>
		</div>
	</div>

	<!-- View Toggle -->
	<div class="co-view-toggle">
		<button
			class="co-toggle-btn {viewMode === 'pipeline' ? 'co-toggle-active' : ''}"
			on:click={() => (viewMode = 'pipeline')}
		>
			Pipeline
		</button>
		<button
			class="co-toggle-btn {viewMode === 'list' ? 'co-toggle-active' : ''}"
			on:click={() => (viewMode = 'list')}
		>
			List
		</button>
	</div>

	<!-- Error Banner -->
	{#if error}
		<div class="co-error-banner">
			<div>{error}</div>
			<button class="co-close-btn" on:click={() => (error = null)}>×</button>
		</div>
	{/if}

	<!-- Pipeline View -->
	{#if viewMode === 'pipeline'}
		<div class="co-pipeline">
			{#each ['draft', 'submitted', 'assigned', 'estimated', 'approved', 'rejected'] as status}
				<div class="co-column">
					<div class="co-column-header">
						<h3 class="co-column-title">{status.charAt(0).toUpperCase() + status.slice(1)}</h3>
						<span class="co-column-count">{getOrdersByStatus(status).length}</span>
					</div>
					<div class="co-column-cards">
						{#each getOrdersByStatus(status) as order (order.id)}
							<div
								class="co-card"
								on:click={() => selectOrder(order)}
								role="button"
								tabindex="0"
								on:keydown={(e) => {
									if (e.key === 'Enter') selectOrder(order);
								}}
							>
								<div class="co-card-header">
									<div class="co-card-number">{order.request_number}</div>
									<div
										class="co-card-priority-dot"
										style="background-color: {priorityColor(order.priority)}"
										title={order.priority}
									/>
								</div>
								<div class="co-card-title">{order.title}</div>
								<div class="co-card-job">{order.job_name}</div>
								<div class="co-card-footer">
									<div class="co-card-requested">
										{order.requested_by_first} {order.requested_by_last}
									</div>
									{#if order.photo_count > 0}
										<div class="co-card-photos">{order.photo_count} photo{order.photo_count > 1 ? 's' : ''}</div>
									{/if}
									<div class="co-card-time">{timeAgo(order.created_at)}</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- List View -->
		<div class="co-list-view">
			<table class="co-table">
				<thead>
					<tr>
						<th class="co-sort" on:click={() => toggleSort('request_number')}>COR# {#if sortCol === 'request_number'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('title')}>Title {#if sortCol === 'title'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('job_number')}>Job {#if sortCol === 'job_number'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('status')}>Status {#if sortCol === 'status'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('priority')}>Priority {#if sortCol === 'priority'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('requested_by_first')}>Requested By {#if sortCol === 'requested_by_first'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('assigned_to_first')}>Assigned To {#if sortCol === 'assigned_to_first'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th class="co-sort" on:click={() => toggleSort('estimated_cost')}>Est. Cost {#if sortCol === 'estimated_cost'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
						<th>Photos</th>
						<th class="co-sort" on:click={() => toggleSort('created_at')}>Created {#if sortCol === 'created_at'}<span class="co-arrow">{sortAsc ? "↑" : "↓"}</span>{/if}</th>
					</tr>
				</thead>
				<tbody>
					{#each sortedOrders as order (order.id)}
						<tr
							class="co-table-row"
							on:click={() => selectOrder(order)}
							role="button"
							tabindex="0"
							on:keydown={(e) => {
								if (e.key === 'Enter') selectOrder(order);
							}}
						>
							<td class="co-table-number">{order.request_number}</td>
							<td class="co-table-title">{order.title}</td>
							<td class="co-table-job">{order.job_number}</td>
							<td>
								<span class="co-status-pill" style="background-color: {statusColor(order.status)}">
									{order.status.charAt(0).toUpperCase() + order.status.slice(1)}
								</span>
							</td>
							<td>
								<span class="co-priority-pill" style="color: {priorityColor(order.priority)}">
									{order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
								</span>
							</td>
							<td>{order.requested_by_first} {order.requested_by_last}</td>
							<td>{order.assigned_to_first ? `${order.assigned_to_first} ${order.assigned_to_last}` : '—'}</td>
							<td>{order.estimated_cost ? formatCurrency(order.estimated_cost) : '—'}</td>
							<td class="co-table-photos">{order.photo_count}</td>
							<td class="co-table-date">{formatDate(order.created_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Detail Panel -->
	{#if selectedOrderFull}
		<div class="co-detail-overlay" on:click={closeDetailPanel} role="presentation" />
		<div class="co-detail-panel">
			<div class="co-detail-header">
				<div class="co-detail-top-row">
					<div>
						<div class="co-detail-number">{selectedOrderFull.request_number}</div>
						<h2 class="co-detail-title">{selectedOrderFull.title}</h2>
					</div>
					<button class="co-close-detail" on:click={closeDetailPanel}>×</button>
				</div>
				<div class="co-detail-pills">
					<span class="co-status-pill" style="background-color: {statusColor(selectedOrderFull.status)}">
						{selectedOrderFull.status.charAt(0).toUpperCase() + selectedOrderFull.status.slice(1)}
					</span>
					<span class="co-priority-pill" style="color: {priorityColor(selectedOrderFull.priority)}">
						{selectedOrderFull.priority.charAt(0).toUpperCase() + selectedOrderFull.priority.slice(1)}
					</span>
				</div>
			</div>

			<div class="co-detail-body">
				<!-- Job Info -->
				<div class="co-detail-section">
					<h3 class="co-section-title">Job</h3>
					<div class="co-section-content">
						<div>{selectedOrderFull.job_name}</div>
						<div class="co-text-secondary">{selectedOrderFull.job_number}</div>
					</div>
				</div>

				<!-- Location -->
				{#if selectedOrderFull.location_description}
					<div class="co-detail-section">
						<h3 class="co-section-title">Location</h3>
						<div class="co-section-content">{selectedOrderFull.location_description}</div>
					</div>
				{/if}

				<!-- Description -->
				{#if selectedOrderFull.description}
					<div class="co-detail-section">
						<h3 class="co-section-title">What Changed</h3>
						<div class="co-section-content">{selectedOrderFull.description}</div>
					</div>
				{/if}

				<!-- Requested By -->
				<div class="co-detail-section">
					<h3 class="co-section-title">Requested By</h3>
					<div class="co-section-content">
						<div>
							{selectedOrderFull.requested_by_first} {selectedOrderFull.requested_by_last}
						</div>
						<div class="co-text-secondary">{formatDate(selectedOrderFull.created_at)}</div>
					</div>
				</div>

				<!-- Due Date -->
				{#if selectedOrderFull.due_date}
					<div class="co-detail-section">
						<h3 class="co-section-title">Due Date</h3>
						<div class="co-section-content">{formatDate(selectedOrderFull.due_date)}</div>
					</div>
				{/if}

				<!-- Workflow Actions -->
				<div class="co-detail-section co-actions-section">
					{#if selectedOrderFull.status === 'draft'}
						<button class="co-btn-primary co-btn-full" on:click={() => updateOrderStatus('submitted')}>
							Submit Request
						</button>
					{:else if selectedOrderFull.status === 'submitted'}
						{#if !detailEditing.assign}
							<button class="co-btn-secondary co-btn-full" on:click={() => (detailEditing.assign = true)}>
								Assign to Estimator
							</button>
						{:else}
							<div class="co-form-group">
								<label class="co-label">Estimator</label>
								<select class="co-input" bind:value={assignForm.estimatorId}>
									<option value="">Select estimator...</option>
									{#each estimators as est}
										<option value={est.id}>{est.first_name} {est.last_name}</option>
									{/each}
								</select>
								<div class="co-form-actions">
									<button class="co-btn-primary" on:click={assignToEstimator}>Assign</button>
									<button class="co-btn-secondary" on:click={() => (detailEditing.assign = false)}>Cancel</button>
								</div>
							</div>
						{/if}
					{:else if selectedOrderFull.status === 'assigned'}
						<div class="co-assigned-info">
							<div class="co-text-secondary">Assigned to</div>
							<div class="co-assigned-name">
								{selectedOrderFull.assigned_to_first} {selectedOrderFull.assigned_to_last}
							</div>
						</div>
						{#if !detailEditing.estimate}
							<button class="co-btn-primary co-btn-full" on:click={() => (detailEditing.estimate = true)}>
								Add Estimate
							</button>
						{:else}
							<div class="co-form-group">
								<label class="co-label">Estimated Cost</label>
								<input type="number" class="co-input" placeholder="0.00" bind:value={estimateForm.cost} />
								<label class="co-label">Estimated Hours</label>
								<input type="number" class="co-input" placeholder="0" bind:value={estimateForm.hours} />
								<label class="co-label">Notes</label>
								<textarea class="co-input" placeholder="Estimation notes..." bind:value={estimateForm.notes} />
								<div class="co-form-actions">
									<button class="co-btn-primary" on:click={submitEstimate}>Submit Estimate</button>
									<button class="co-btn-secondary" on:click={() => (detailEditing.estimate = false)}>Cancel</button>
								</div>
							</div>
						{/if}
					{:else if selectedOrderFull.status === 'estimated'}
						<div class="co-estimate-summary">
							<div class="co-estimate-row">
								<div class="co-text-secondary">Estimated Cost</div>
								<div class="co-estimate-value">{formatCurrency(selectedOrderFull.estimated_cost)}</div>
							</div>
							{#if selectedOrderFull.estimated_hours}
								<div class="co-estimate-row">
									<div class="co-text-secondary">Estimated Hours</div>
									<div class="co-estimate-value">{selectedOrderFull.estimated_hours} hrs</div>
								</div>
							{/if}
							{#if selectedOrderFull.estimate_notes}
								<div class="co-estimate-row">
									<div class="co-text-secondary">Notes</div>
									<div>{selectedOrderFull.estimate_notes}</div>
								</div>
							{/if}
						</div>
						<div class="co-form-actions">
							<button class="co-btn-success co-btn-full" on:click={approveOrder}>Approve</button>
							<button class="co-btn-danger co-btn-full" on:click={rejectOrder}>Reject</button>
						</div>
					{:else if selectedOrderFull.status === 'approved'}
						<div class="co-approved-banner">
							<div class="co-banner-icon">✓</div>
							<div>
								<div class="co-banner-title">Approved</div>
								<div class="co-text-secondary">Approved by {selectedOrderFull.assigned_by_name}</div>
							</div>
						</div>
					{:else if selectedOrderFull.status === 'rejected'}
						<div class="co-rejected-banner">
							<div class="co-banner-icon">!</div>
							<div>
								<div class="co-banner-title">Rejected</div>
								<div class="co-text-secondary">Rejected by {selectedOrderFull.assigned_by_name}</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- Photos Section -->
				<div class="co-detail-section">
					<h3 class="co-section-title">Photos</h3>
					{#if selectedOrderFull.photos && selectedOrderFull.photos.length > 0}
						<div class="co-photos-grid">
							{#each selectedOrderFull.photos as photo (photo.id)}
								<div class="co-photo-item">
									<div class="co-photo-placeholder">
										<div class="co-photo-icon">📷</div>
									</div>
									<div class="co-photo-caption">{photo.caption}</div>
									<button
										class="co-photo-delete"
										on:click={() => deletePhoto(photo.id)}
										title="Delete photo"
									>
										×
									</button>
								</div>
							{/each}
						</div>
					{/if}
					<div class="co-form-group">
						<label class="co-label">Add Photo</label>
						<input
							type="text"
							class="co-input"
							placeholder="Photo URL"
							bind:value={photoForm.photoUrl}
						/>
						<input
							type="text"
							class="co-input"
							placeholder="Caption (optional)"
							bind:value={photoForm.caption}
						/>
						<button class="co-btn-secondary co-btn-full" on:click={addPhoto}>Add Photo</button>
					</div>
				</div>

				<!-- Notes Section -->
				<div class="co-detail-section">
					<h3 class="co-section-title">Notes</h3>
					{#if !detailEditing.notes}
						<div
							class="co-notes-display"
							on:click={() => (detailEditing.notes = true)}
							role="button"
							tabindex="0"
							on:keydown={(e) => {
								if (e.key === 'Enter') detailEditing.notes = true;
							}}
						>
							{selectedOrderFull.notes || 'Click to add notes...'}
						</div>
					{:else}
						<textarea
							class="co-input"
							placeholder="Enter notes..."
							bind:value={selectedOrderFull.notes}
						/>
						<div class="co-form-actions">
							<button class="co-btn-primary" on:click={() => updateNotes(selectedOrderFull.notes)}>
								Save
							</button>
							<button class="co-btn-secondary" on:click={() => (detailEditing.notes = false)}>Cancel</button>
						</div>
					{/if}
				</div>

				<!-- Delete Action -->
				<div class="co-detail-section">
					<button
						class="co-btn-danger co-btn-full"
						on:click={() => {
							deleteTarget = selectedOrderFull;
							showDeleteConfirm = true;
						}}
					>
						Delete Request
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Create Modal -->
	{#if showCreateModal}
		<div class="co-modal-overlay" on:click={() => (showCreateModal = false)} role="presentation" />
		<div class="co-modal">
			<div class="co-modal-header">
				<h2 class="co-modal-title">New Change Order Request</h2>
				<button class="co-close-modal" on:click={() => (showCreateModal = false)}>×</button>
			</div>

			<div class="co-modal-body">
				<div class="co-form-group">
					<label class="co-label">Job</label>
					<select
						class="co-input"
						bind:value={createForm.jobId}
						on:change={fetchNextCorNumber}
					>
						<option value="">Select a job...</option>
						{#each jobs as job}
							<option value={job.id}>{job.name} ({job.number})</option>
						{/each}
					</select>
				</div>

				{#if nextCorNumber}
					<div class="co-form-group">
						<label class="co-label">COR#</label>
						<div class="co-input-readonly">{nextCorNumber}</div>
					</div>
				{/if}

				<div class="co-form-group">
					<label class="co-label">Title</label>
					<input
						type="text"
						class="co-input"
						placeholder="e.g., Add outlet in break room"
						bind:value={createForm.title}
					/>
				</div>

				<div class="co-form-group">
					<label class="co-label">Description</label>
					<textarea
						class="co-input"
						placeholder="What changed? Describe the scope of work..."
						bind:value={createForm.description}
					/>
				</div>

				<div class="co-form-group">
					<label class="co-label">Location</label>
					<input
						type="text"
						class="co-input"
						placeholder="e.g., Building A, 2nd Floor, Break Room"
						bind:value={createForm.locationDesc}
					/>
				</div>

				<div class="co-form-group">
					<label class="co-label">Requested By</label>
					<select class="co-input" bind:value={createForm.requestedBy}>
						<option value="">Select employee...</option>
						{#each estimators as emp}
							<option value={emp.id}>{emp.first_name} {emp.last_name}</option>
						{/each}
					</select>
				</div>

				<div class="co-form-group">
					<label class="co-label">Priority</label>
					<select class="co-input" bind:value={createForm.priority}>
						<option value="low">Low</option>
						<option value="normal">Normal</option>
						<option value="high">High</option>
						<option value="urgent">Urgent</option>
					</select>
				</div>

				<div class="co-form-group">
					<label class="co-label">Due Date (optional)</label>
					<input type="date" class="co-input" bind:value={createForm.dueDate} />
				</div>

				<div class="co-form-group">
					<label class="co-label">Notes (optional)</label>
					<textarea
						class="co-input"
						placeholder="Any additional notes..."
						bind:value={createForm.notes}
					/>
				</div>
			</div>

			<div class="co-modal-footer">
				<button class="co-btn-secondary" on:click={() => (showCreateModal = false)}>Cancel</button>
				<button class="co-btn-primary" on:click={createOrder}>Create Request</button>
			</div>
		</div>
	{/if}

	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm && deleteTarget}
		<div class="co-modal-overlay" on:click={() => (showDeleteConfirm = false)} role="presentation" />
		<div class="co-modal co-modal-small">
			<div class="co-modal-header">
				<h2 class="co-modal-title">Delete Request</h2>
				<button class="co-close-modal" on:click={() => (showDeleteConfirm = false)}>×</button>
			</div>

			<div class="co-modal-body">
				<p class="co-confirm-text">
					Are you sure you want to delete <strong>{deleteTarget.request_number} - {deleteTarget.title}</strong>? This cannot be undone.
				</p>
			</div>

			<div class="co-modal-footer">
				<button class="co-btn-secondary" on:click={() => (showDeleteConfirm = false)}>Cancel</button>
				<button class="co-btn-danger" on:click={deleteOrder}>Delete</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.co-container {
		width: 100%;
		max-width: 100%;
	}

	/* Header */
	.co-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}

	.co-title {
		font-size: 22px;
		font-weight: 700;
		color: #1d1d1f;
		letter-spacing: -0.02em;
		margin: 0;
		letter-spacing: -0.3px;
	}

	/* Buttons */
	.co-btn-primary,
	.co-btn-secondary,
	.co-btn-success,
	.co-btn-danger {
		padding: 10px 20px;
		border: none;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		outline: none;
	}

	.co-btn-primary {
		background-color: #007aff;
		color: white;
	}

	.co-btn-primary:hover {
		background-color: #0051d5;
	}

	.co-btn-primary:active {
		background-color: #0041b3;
	}

	.co-btn-secondary {
		background-color: #e5e5ea;
		color: #000;
	}

	.co-btn-secondary:hover {
		background-color: #d1d1d6;
	}

	.co-btn-success {
		background-color: #34c759;
		color: white;
	}

	.co-btn-success:hover {
		background-color: #25a135;
	}

	.co-btn-danger {
		background-color: #ff3b30;
		color: white;
	}

	.co-btn-danger:hover {
		background-color: #d73223;
	}

	.co-btn-full {
		width: 100%;
	}

	.co-close-btn,
	.co-close-detail,
	.co-close-modal {
		background: none;
		border: none;
		font-size: 28px;
		color: #999;
		cursor: pointer;
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
	}

	.co-close-btn:hover,
	.co-close-detail:hover,
	.co-close-modal:hover {
		color: #666;
	}

	/* Stats Row */
	.co-stats-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 16px;
		margin-bottom: 24px;
	}

	.co-stat {
		background-color: white;
		padding: 16px;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.co-stat-label {
		font-size: 13px;
		color: #8e8e93;
		font-weight: 500;
		margin-bottom: 8px;
	}

	.co-stat-value {
		font-size: 28px;
		font-weight: 600;
		color: #000;
	}

	.co-stat-urgent .co-stat-value {
		color: #ff3b30;
	}

	/* View Toggle */
	.co-view-toggle {
		display: flex;
		gap: 8px;
		margin-bottom: 24px;
	}

	.co-toggle-btn {
		padding: 8px 16px;
		border: 1px solid #e5e5ea;
		background-color: white;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		color: #8e8e93;
		cursor: pointer;
		transition: all 0.2s;
	}

	.co-toggle-btn.co-toggle-active {
		background-color: #007aff;
		color: white;
		border-color: #007aff;
	}

	/* Error Banner */
	.co-error-banner {
		background-color: #ff3b30;
		color: white;
		padding: 12px 16px;
		border-radius: 8px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
		font-size: 14px;
	}

	/* Pipeline View */
	.co-pipeline {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 16px;
		overflow-x: auto;
	}

	.co-column {
		background-color: #f5f5f7;
		border-radius: 10px;
		padding: 12px;
		min-height: 400px;
		display: flex;
		flex-direction: column;
	}

	.co-column-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 1px solid #e5e5ea;
	}

	.co-column-title {
		font-size: 14px;
		font-weight: 600;
		color: #000;
		margin: 0;
	}

	.co-column-count {
		background-color: #e5e5ea;
		color: #666;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 12px;
		font-weight: 500;
	}

	.co-column-cards {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	/* Cards */
	.co-card {
		background-color: white;
		padding: 12px;
		border-radius: 10px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		cursor: pointer;
		transition: all 0.2s;
	}

	.co-card:hover {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		transform: translateY(-2px);
	}

	.co-card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 8px;
	}

	.co-card-number {
		font-size: 13px;
		font-weight: 600;
		color: #007aff;
	}

	.co-card-priority-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.co-card-title {
		font-size: 14px;
		font-weight: 500;
		color: #000;
		margin-bottom: 4px;
		line-height: 1.3;
	}

	.co-card-job {
		font-size: 12px;
		color: #8e8e93;
		margin-bottom: 8px;
	}

	.co-card-footer {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}

	.co-card-requested {
		color: #666;
		font-weight: 500;
	}

	.co-card-photos {
		color: #8e8e93;
	}

	.co-card-time {
		color: #c7c7cc;
		font-size: 11px;
	}

	/* List View */
	.co-list-view {
		background-color: white;
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.co-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}

	.co-table thead {
		background-color: #f5f5f7;
		border-bottom: 1px solid #e5e5ea;
	}

	.co-table th {
		padding: 12px;
		text-align: left;
		font-weight: 600;
		color: #666;
		font-size: 13px;
	}

	.co-table-row {
		cursor: pointer;
		border-bottom: 1px solid #f0f0f0;
		transition: background-color 0.2s;
	}

	.co-table-row:hover {
		background-color: #fafafa;
	}

	.co-table td {
		padding: 12px;
		color: #000;
	}

	.co-table-number {
		color: #007aff;
		font-weight: 500;
	}

	.co-table-title {
		font-weight: 500;
	}

	.co-table-job {
		color: #8e8e93;
	}

	.co-table-photos {
		text-align: center;
	}

	.co-table-date {
		color: #8e8e93;
	}

	.co-status-pill {
		display: inline-block;
		padding: 4px 10px;
		border-radius: 12px;
		color: white;
		font-size: 12px;
		font-weight: 500;
	}

	.co-priority-pill {
		display: inline-block;
		font-size: 12px;
		font-weight: 500;
	}

	/* Sortable Headers */
	.co-sort {
		cursor: pointer;
		user-select: none;
		transition: color 0.15s;
	}

	.co-sort:hover {
		color: #1d1d1f;
	}

	.co-arrow {
		display: inline-block;
		font-size: 0.625rem;
		margin-left: 2px;
		opacity: 0.5;
	}

	/* Detail Panel */
	.co-detail-overlay {
		position: fixed;
		inset: 0;
		background-color: rgba(0, 0, 0, 0.3);
		z-index: 98;
	}

	.co-detail-panel {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: 400px;
		background-color: white;
		z-index: 99;
		display: flex;
		flex-direction: column;
		box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
		animation: slideInRight 0.3s ease;
	}

	@keyframes slideInRight {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.co-detail-header {
		padding: 20px;
		border-bottom: 1px solid #f0f0f0;
		background-color: #fafafa;
	}

	.co-detail-top-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 12px;
	}

	.co-detail-number {
		font-size: 12px;
		color: #007aff;
		font-weight: 600;
		margin-bottom: 4px;
	}

	.co-detail-title {
		font-size: 18px;
		font-weight: 600;
		color: #000;
		margin: 0;
	}

	.co-detail-pills {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.co-detail-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
	}

	.co-detail-section {
		margin-bottom: 24px;
	}

	.co-section-title {
		font-size: 13px;
		font-weight: 600;
		color: #8e8e93;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin: 0 0 8px 0;
	}

	.co-section-content {
		font-size: 14px;
		color: #000;
		line-height: 1.5;
	}

	.co-text-secondary {
		color: #8e8e93;
		font-size: 13px;
	}

	.co-actions-section {
		margin-top: 32px;
		padding-top: 20px;
		border-top: 1px solid #f0f0f0;
	}

	.co-assigned-info {
		background-color: #f5f5f7;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 12px;
	}

	.co-assigned-name {
		font-size: 15px;
		font-weight: 600;
		color: #000;
	}

	.co-estimate-summary {
		background-color: #f5f5f7;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 16px;
	}

	.co-estimate-row {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		font-size: 14px;
		border-bottom: 1px solid #e5e5ea;
	}

	.co-estimate-row:last-child {
		border-bottom: none;
	}

	.co-estimate-value {
		font-weight: 600;
		color: #000;
	}

	.co-approved-banner,
	.co-rejected-banner {
		display: flex;
		gap: 12px;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 16px;
		align-items: center;
	}

	.co-approved-banner {
		background-color: #d1fae5;
	}

	.co-rejected-banner {
		background-color: #fee2e2;
	}

	.co-banner-icon {
		font-size: 20px;
		font-weight: bold;
	}

	.co-approved-banner .co-banner-icon {
		color: #059669;
	}

	.co-rejected-banner .co-banner-icon {
		color: #dc2626;
	}

	.co-banner-title {
		font-weight: 600;
		font-size: 14px;
		color: #000;
	}

	/* Photos */
	.co-photos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
		gap: 12px;
		margin-bottom: 16px;
	}

	.co-photo-item {
		position: relative;
	}

	.co-photo-placeholder {
		width: 100%;
		aspect-ratio: 1;
		background-color: #f0f0f0;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e5e5ea;
	}

	.co-photo-icon {
		font-size: 28px;
	}

	.co-photo-caption {
		font-size: 11px;
		color: #8e8e93;
		margin-top: 4px;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.co-photo-delete {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background-color: #ff3b30;
		color: white;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		transition: all 0.2s;
	}

	.co-photo-delete:hover {
		background-color: #cc2924;
		transform: scale(1.1);
	}

	/* Notes */
	.co-notes-display {
		background-color: #f5f5f7;
		padding: 12px;
		border-radius: 8px;
		min-height: 44px;
		display: flex;
		align-items: center;
		cursor: pointer;
		color: #8e8e93;
		transition: background-color 0.2s;
	}

	.co-notes-display:hover {
		background-color: #e5e5ea;
	}

	/* Forms */
	.co-form-group {
		margin-bottom: 16px;
	}

	.co-label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		color: #000;
		margin-bottom: 8px;
	}

	.co-input,
	textarea.co-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid #e5e5ea;
		border-radius: 8px;
		font-size: 14px;
		color: #000;
		background-color: white;
		transition: border-color 0.2s;
		font-family: inherit;
	}

	.co-input:focus,
	textarea.co-input:focus {
		outline: none;
		border-color: #007aff;
		box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
	}

	textarea.co-input {
		resize: vertical;
		min-height: 80px;
	}

	.co-input-readonly {
		padding: 10px 12px;
		background-color: #f5f5f7;
		border: 1px solid #e5e5ea;
		border-radius: 8px;
		font-size: 14px;
		color: #666;
	}

	.co-form-actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}

	.co-form-actions button {
		flex: 1;
	}

	/* Modals */
	.co-modal-overlay {
		position: fixed;
		inset: 0;
		background-color: rgba(0, 0, 0, 0.4);
		z-index: 100;
	}

	.co-modal {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		background-color: white;
		border-radius: 12px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.16);
		z-index: 101;
		width: 90%;
		max-width: 500px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
	}

	.co-modal-small {
		max-width: 360px;
	}

	.co-modal-header {
		padding: 20px;
		border-bottom: 1px solid #f0f0f0;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.co-modal-title {
		font-size: 18px;
		font-weight: 600;
		color: #000;
		margin: 0;
	}

	.co-modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
	}

	.co-modal-footer {
		padding: 16px 20px;
		border-top: 1px solid #f0f0f0;
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	.co-confirm-text {
		font-size: 14px;
		color: #000;
		line-height: 1.6;
		margin: 0;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.co-pipeline {
			grid-template-columns: 1fr;
		}

		.co-detail-panel {
			width: 100%;
		}

		.co-modal {
			max-width: calc(100% - 32px);
		}
	}

	@media (max-width: 640px) {
		.co-title {
			font-size: 18px;
		}

		.co-stats-row {
			grid-template-columns: repeat(2, 1fr);
			gap: 12px;
		}

		.co-header {
			flex-direction: column;
			gap: 12px;
			align-items: flex-start;
		}

		.co-btn-primary,
		.co-btn-secondary {
			padding: 8px 16px;
			font-size: 14px;
		}

		.co-detail-panel {
			animation: slideInUp 0.3s ease;
		}

		@keyframes slideInUp {
			from {
				transform: translateY(100%);
			}
			to {
				transform: translateY(0);
			}
		}
	}
</style>
