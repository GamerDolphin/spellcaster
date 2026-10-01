// SPDX-License-Identifier: GPL-2.0-or-later
//
// Reads CPU load from /proc/stat every couple of seconds.

import GLib from 'gi://GLib';

const INTERVAL_S = 2;
const decoder = new TextDecoder();

function readCpu() {
    try {
        const [ok, bytes] = GLib.file_get_contents('/proc/stat');
        if (!ok)
            return null;
        const line = decoder.decode(bytes).split('\n', 1)[0];
        const v = line.trim().split(/\s+/).slice(1).map(Number);
        const idle = v[3] + (v[4] ?? 0);
        const total = v.reduce((a, b) => a + b, 0);
        return {idle, total};
    } catch {
        return null;
    }
}

export class CpuWatch {
    /** @param {(load: number) => void} callback load is 0..1 */
    constructor(callback) {
        this._callback = callback;
        this._id = 0;
        this._last = null;
    }

    start() {
        if (this._id)
            return;
        this._last = readCpu();
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, INTERVAL_S, () => {
            const now = readCpu();
            if (now && this._last) {
                const dt = now.total - this._last.total;
                const di = now.idle - this._last.idle;
                if (dt > 0)
                    this._callback(Math.max(0, Math.min(1, 1 - di / dt)));
            }
            this._last = now;
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._id) {
            GLib.source_remove(this._id);
            this._id = 0;
        }
    }
}
