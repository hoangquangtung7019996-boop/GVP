// UIStatusManager.js - Status display and progress tracking
// Dependencies: StateManager

window.UIStatusManager = class UIStatusManager {
    constructor(stateManager, shadowRoot) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
    }

    createStatusDisplay() {
        const container = document.createElement('div');
        container.className = 'gvp-status-container';
        container.id = 'gvp-status-display';
        container.style.display = 'none';
        container.style.flexDirection = 'row';
        container.style.gap = '6px';
        container.style.alignItems = 'center';

        const statusBadge = document.createElement('div');
        statusBadge.className = 'gvp-status-badge idle';
        statusBadge.id = 'gvp-status-badge';
        statusBadge.style.padding = '4px 8px';
        statusBadge.style.fontSize = '11px';
        statusBadge.style.whiteSpace = 'nowrap';
        statusBadge.innerHTML = '<span class="gvp-status-icon">⏸</span><span class="gvp-status-text">Idle</span>';

        const modeIndicator = document.createElement('div');
        modeIndicator.className = 'gvp-mode-indicator normal';
        modeIndicator.id = 'gvp-mode-indicator';
        modeIndicator.style.padding = '4px 8px';
        modeIndicator.style.fontSize = '11px';
        modeIndicator.style.whiteSpace = 'nowrap';
        modeIndicator.innerHTML = '🎬 Normal';

        const retryCounter = document.createElement('div');
        retryCounter.className = 'gvp-retry-counter';
        retryCounter.id = 'gvp-retry-counter';
        retryCounter.style.display = 'none';
        retryCounter.style.padding = '4px 8px';
        retryCounter.style.fontSize = '11px';
        retryCounter.innerHTML = '<span>🔄</span><span class="count">0</span><span>/</span><span class="max">3</span>';

        container.appendChild(statusBadge);
        container.appendChild(modeIndicator);
        container.appendChild(retryCounter);

        // Store references for later updates
        container._progressContainer = null;
        container._moderationRow = null;
        container._infoRow = null;

        return container;
    }

    updateGenerationStatus(status, data = {}) {
        const statusContainer = this.shadowRoot.getElementById('gvp-status-display');
        const statusBadge = this.shadowRoot.getElementById('gvp-status-badge');
        const genBtn = this.shadowRoot.getElementById('gvp-gen-btn');

        if (!statusContainer || !statusBadge) return;

        statusContainer.style.display = 'flex';
        statusBadge.className = `gvp-status-badge ${status}`;

        // Update generation indicator state in header
        const isGenerating = status === 'generating' || status === 'retrying';
        if (window.gvpUIManager && typeof window.gvpUIManager.updateGenerationButtonState === 'function') {
            window.gvpUIManager.updateGenerationButtonState(isGenerating);
        }

        switch (status) {
            case 'idle':
                statusBadge.innerHTML = '<span class="gvp-status-icon">⏸</span><span class="gvp-status-text">Idle</span>';
                this.hideRetryCounter();
                this.hideModerationReason();
                break;

            case 'generating':
                statusBadge.innerHTML = '<span class="gvp-status-icon">🎬</span><span class="gvp-status-text">Generating</span>';
                this.hideModerationReason();
                break;

            case 'moderated':
                statusBadge.innerHTML = '<span class="gvp-status-icon">⚠️</span><span class="gvp-status-text">Moderated</span>';
                progressBar.className = 'gvp-progress-bar moderated';
                progressBar.style.width = '50%';
                if (data.reason) this.showModerationReason(data.reason);
                break;

            case 'retrying':
                statusBadge.innerHTML = '<span class="gvp-status-icon">🔄</span><span class="gvp-status-text">Retrying</span>';
                progressBar.className = 'gvp-progress-bar retrying';
                progressBar.style.width = '25%';
                if (data.retryCount !== undefined && data.maxRetries !== undefined) {
                    this.showRetryCounter(data.retryCount, data.maxRetries);
                }
                break;

            case 'completed':
                statusBadge.innerHTML = '<span class="gvp-status-icon">✅</span><span class="gvp-status-text">Completed</span>';
                progressBar.className = 'gvp-progress-bar completed';
                progressBar.style.width = '100%';
                setTimeout(() => this.updateGenerationStatus('idle'), 3000);
                break;

            case 'failed':
                statusBadge.innerHTML = '<span class="gvp-status-icon">❌</span><span class="gvp-status-text">Failed</span>';
                progressBar.className = 'gvp-progress-bar failed';
                progressBar.style.width = '100%';
                if (data.reason) this.showModerationReason(data.reason);
                setTimeout(() => this.updateGenerationStatus('idle'), 5000);
                break;
        }

        if (data.generationId && this.stateManager.getState().settings.debugMode) {
            const infoRow = this.shadowRoot.getElementById('gvp-generation-info');
            const genIdSpan = this.shadowRoot.getElementById('gvp-gen-id');
            if (infoRow && genIdSpan) {
                infoRow.style.display = 'flex';
                genIdSpan.textContent = data.generationId.substring(0, 16) + '...';
            }
        }

        window.Logger.info('Status', `Status updated to: ${status}`);
    }

    showRetryCounter(current, max) {
        const retryCounter = this.shadowRoot.getElementById('gvp-retry-counter');
        if (retryCounter) {
            retryCounter.style.display = 'flex';
            const countSpan = retryCounter.querySelector('.count');
            const maxSpan = retryCounter.querySelector('.max');
            if (countSpan) countSpan.textContent = current;
            if (maxSpan) maxSpan.textContent = max;
        }
    }

    hideRetryCounter() {
        const retryCounter = this.shadowRoot.getElementById('gvp-retry-counter');
        if (retryCounter) retryCounter.style.display = 'none';
    }

    showModerationReason(reason) {
        const moderationRow = this.shadowRoot.getElementById('gvp-moderation-row');
        const moderationReason = this.shadowRoot.getElementById('gvp-moderation-reason');

        if (moderationRow && moderationReason) {
            moderationRow.style.display = 'flex';
            moderationReason.setAttribute('data-reason', reason);
            const displayReason = reason.length > 40 ? reason.substring(0, 40) + '...' : reason;
            moderationReason.innerHTML = `<span>⚠️</span><span>${displayReason}</span>`;
        }
    }

    hideModerationReason() {
        const moderationRow = this.shadowRoot.getElementById('gvp-moderation-row');
        if (moderationRow) moderationRow.style.display = 'none';
    }

    updateModeIndicator() {
        const modeIndicator = this.shadowRoot.getElementById('gvp-mode-indicator');
        const state = this.stateManager.getState();

        if (modeIndicator) {
            if (state.generation.useSpicy) {
                modeIndicator.className = 'gvp-mode-indicator spicy';
                modeIndicator.innerHTML = '🌶️ Spicy';
            } else {
                modeIndicator.className = 'gvp-mode-indicator normal';
                modeIndicator.innerHTML = '🎬 Normal';
            }
        }
    }

    updateProgressBar(progress) {
        const progressBar = this.shadowRoot.getElementById('gvp-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }
    }

    updateSpicyModeButton(isActive) {
        const spicyBtn = this.shadowRoot.getElementById('gvp-spicy-btn');
        if (spicyBtn) {
            if (isActive) {
                spicyBtn.classList.add('active');
            } else {
                spicyBtn.classList.remove('active');
            }
        }
    }
};
