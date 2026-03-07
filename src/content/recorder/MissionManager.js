/**
 * MissionManager.js
 * Orchestrates the mission state machine and data capture
 */

export class MissionManager {
    constructor(scenarios, onUpdate) {
        this.scenarios = scenarios;
        this.scenarioKeys = Object.keys(scenarios);
        this.onUpdate = onUpdate; // Callback for UI updates

        this.state = {
            active: false,
            currentScenarioIdx: 0,
            currentStepIdx: 0,
            currentStepData: null,
            capturedData: {}, // Final output object
            history: [] // Interaction log
        };

        // Initialize capture storage
        this.scenarioKeys.forEach(key => {
            if (key === 'image_with_edits__carousel_browse') {
                this.state.capturedData.carouselScenario = [];
            } else {
                this.state.capturedData[key] = [];
            }
        });
    }

    start() {
        this.state.active = true;
        this.state.currentScenarioIdx = 0;
        this.state.currentStepIdx = 0;
        this.state.history = [];
        this._emitUpdate();
        console.log('[GVP Recorder] Mission Started');
    }

    stop() {
        this.state.active = false;
        this._emitUpdate();
        this._exportData();
    }

    getCurrentStep() {
        if (!this.state.active) return null;
        const scenarioKey = this.scenarioKeys[this.state.currentScenarioIdx];
        const scenario = this.scenarios[scenarioKey];
        if (!scenario) return null;

        return {
            scenario: scenario,
            step: scenario.steps[this.state.currentStepIdx],
            stepIdx: this.state.currentStepIdx,
            totalSteps: scenario.steps.length,
            scenarioIdx: this.state.currentScenarioIdx,
            totalScenarios: this.scenarioKeys.length
        };
    }

    captureInteraction(event) {
        if (!this.state.active) return;

        const current = this.getCurrentStep();
        if (!current || current.step.noCapture) return;

        const el = event.target;
        const closestInteractive = el.closest('button, [role="button"], [role="menuitem"], input, textarea, a, [contenteditable="true"]') || el;

        const record = {
            stepNumber: current.stepIdx + 1,
            instruction: current.step.instruct,
            timestamp: new Date().toISOString(),
            target: {
                tag: closestInteractive.tagName.toLowerCase(),
                id: closestInteractive.id,
                classes: [...closestInteractive.classList].join('.'),
                ariaLabel: closestInteractive.getAttribute('aria-label'),
                role: closestInteractive.getAttribute('role'),
                text: closestInteractive.innerText?.substring(0, 100).replace(/\n/g, ' '),
                outerHTML: closestInteractive.outerHTML.substring(0, 5000), // Truncate
                path: this._generatePath(closestInteractive)
            },
            pageContext: {
                url: window.location.href,
                mode: this._detectMediaMode()
            }
        };

        this.state.currentStepData = record;
        this._emitUpdate();

        // Prevent default only if we want to block execution? 
        // No, we want the user to perform the action naturally.
        // But we might want to highlight it.
    }

    confirmStep() {
        const current = this.getCurrentStep();
        if (!current) return;

        // Save data if captured (or if it was a noCapture step)
        const scenarioKey = this.scenarioKeys[this.state.currentScenarioIdx];
        const storageKey = scenarioKey === 'image_with_edits__carousel_browse' ? 'carouselScenario' : scenarioKey;

        if (!current.step.noCapture && this.state.currentStepData) {
            this.state.capturedData[storageKey].push(this.state.currentStepData);
        } else if (current.step.noCapture) {
            this.state.capturedData[storageKey].push({
                stepNumber: current.stepIdx + 1,
                instruction: current.step.instruct,
                skipped: true
            });
        }

        this.state.currentStepData = null;
        this._advance();
    }

    retryStep() {
        this.state.currentStepData = null;
        this._emitUpdate();
    }

    skipScenario() {
        this.state.currentStepIdx = 0;
        this.state.currentStepData = null;
        this.state.currentScenarioIdx++;

        if (this.state.currentScenarioIdx >= this.scenarioKeys.length) {
            this.stop(); // Done
        } else {
            this._emitUpdate();
        }
    }

    _advance() {
        const current = this.getCurrentStep();
        if (this.state.currentStepIdx + 1 < current.scenario.steps.length) {
            this.state.currentStepIdx++;
        } else {
            // Scenario complete
            this.state.currentStepIdx = 0;
            this.state.currentScenarioIdx++;
        }

        if (this.state.currentScenarioIdx >= this.scenarioKeys.length) {
            this.stop();
        } else {
            this._emitUpdate();
        }
    }

    _generatePath(el) {
        const path = [];
        let current = el;
        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector += `#${current.id}`;
                path.unshift(selector);
                break;
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    _detectMediaMode() {
        const switcher = document.querySelector('[aria-label="Media type selection"]');
        if (!switcher) return 'none';
        const active = switcher.querySelector('.bg-button-filled span.sr-only');
        return active ? active.textContent.trim().toLowerCase() : 'unknown';
    }

    _emitUpdate() {
        if (this.onUpdate) this.onUpdate({ ...this.state, current: this.getCurrentStep() });
    }

    _exportData() {
        const json = JSON.stringify(this.state.capturedData, null, 2);
        console.log('[GVP Recorder] Final Data:', this.state.capturedData);

        try {
            // Use GM_setClipboard if available, otherwise prompt
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(json);
                alert('Mission Complete! Data copied to clipboard.');
            } else {
                navigator.clipboard.writeText(json).then(() => {
                    alert('Mission Complete! Data copied to clipboard.');
                });
            }
        } catch (e) {
            console.error('Clipboard failed', e);
        }
    }
}
