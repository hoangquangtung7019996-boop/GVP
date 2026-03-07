/**
 * RecorderUI.js
 * Visual interface for the Mission Recorder
 */

export class RecorderUI {
    constructor(missionManager) {
        this.manager = missionManager;
        this.root = null;
        this.init();
    }

    init() {
        this.root = document.createElement('div');
        this.root.id = 'gvp-recorder-ui';
        this.root.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 320px;
            background: #0a0a0a;
            border: 1px solid #333;
            border-radius: 12px;
            color: #f4f4f5;
            font-family: monospace;
            font-size: 13px;
            z-index: 9999999;
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        `;
        document.body.appendChild(this.root);
        this.render();
    }

    render(state) {
        if (!this.root) return;

        if (!state || !state.active) {
            this.root.innerHTML = `
                <div style="padding: 16px; display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-weight: bold; color: #ff4444;">🔴 GVP Recorder V2</span>
                    <button id="gvp-btn-start" style="
                        background: #222; border: 1px solid #444; color: white;
                        padding: 6px 12px; border-radius: 6px; cursor: pointer;
                    ">▶ Start Mission</button>
                </div>
            `;
            this.root.querySelector('#gvp-btn-start').onclick = () => this.manager.start();
            return;
        }

        const { current, currentStepData } = state;
        const step = current.step;

        const isCaptured = !!currentStepData || step.noCapture;
        const statusColor = isCaptured ? '#00cc66' : '#ffaa00';
        const statusText = isCaptured ? 'READY' : 'WAITING';

        this.root.innerHTML = `
            <div style="padding: 12px; background: #141414; border-bottom: 1px solid #333;">
                <div style="font-size: 11px; color: #888; margin-bottom: 4px;">
                    SCENARIO ${current.scenarioIdx + 1}/${current.totalScenarios}
                </div>
                <div style="font-weight: bold; margin-bottom: 8px;">
                    ${current.scenario.title}
                </div>
                <div style="display: flex; gap: 4px; height: 4px; margin-bottom: 4px;">
                    ${Array(current.totalSteps).fill(0).map((_, i) => `
                        <div style="flex:1; background: ${i <= current.stepIdx ? '#ff4444' : '#333'}; border-radius: 2px;"></div>
                    `).join('')}
                </div>
            </div>

            <div style="padding: 16px; flex-grow: 1;">
                <div style="font-size: 11px; color: #888; margin-bottom: 4px;">INSTRUCTION</div>
                <div style="font-size: 14px; line-height: 1.4; margin-bottom: 16px;">
                    ${step.instruct}
                </div>

                ${currentStepData ? `
                    <div style="background: #1a1a1a; padding: 8px; border-radius: 6px; border-left: 3px solid #00cc66; font-size: 11px; margin-bottom: 16px;">
                        <div style="color: #888;">CAPTURED:</div>
                        <div style="color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${currentStepData.target.tag}.${currentStepData.target.classes}
                        </div>
                    </div>
                ` : ''}
            </div>

            <div style="padding: 12px; border-top: 1px solid #333; display: flex; gap: 8px;">
                <button id="gvp-btn-retry" style="
                    flex: 1; background: #222; border: 1px solid #444; color: #ccc;
                    padding: 8px; border-radius: 6px; cursor: pointer;
                ">🔄 Retry</button>
                <button id="gvp-btn-next" ${!isCaptured ? 'disabled' : ''} style="
                    flex: 2; background: ${isCaptured ? '#00cc66' : '#333'}; 
                    border: 1px solid ${isCaptured ? '#00aa55' : '#444'}; 
                    color: ${isCaptured ? 'black' : '#666'};
                    font-weight: bold;
                    padding: 8px; border-radius: 6px; cursor: ${isCaptured ? 'pointer' : 'not-allowed'};
                ">✅ Next</button>
                <button id="gvp-btn-skip" style="
                    flex: 0.5; background: #222; border: 1px solid #444; color: #ccc;
                    padding: 8px; border-radius: 6px; cursor: pointer; opacity: 0.5;
                ">⏭</button>
            </div>
        `;

        this.root.querySelector('#gvp-btn-next').onclick = () => this.manager.confirmStep();
        this.root.querySelector('#gvp-btn-retry').onclick = () => this.manager.retryStep();
        this.root.querySelector('#gvp-btn-skip').onclick = () => {
            if (confirm('Skip entire scenario?')) this.manager.skipScenario();
        };
    }
}
