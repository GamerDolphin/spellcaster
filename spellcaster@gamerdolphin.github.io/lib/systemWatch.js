// SPDX-License-Identifier: GPL-2.0-or-later
//
// Reads how busy the computer is, every couple of seconds:
//   'ram' - share of memory in use (/proc/meminfo, MemAvailable)
//   'cpu' - share of CPU time in use (/proc/stat)

import GLib from 'gi://GLib';

const INTERVAL_S = 2;
const decoder = new TextDecoder();

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes) : null;
    } catch {
        return null;
    }
}

function readCpu() {
    const text = readFile('/proc/stat');
    if (!text)
        return null;
    const v = text.split('\n', 1)[0].trim().split(/\s+/).slice(1).map(Number);
    return {idle: v[3] + (v[4] ?? 0), total: v.reduce((a, b) => a + b, 0)};
}

/** Share of RAM in use, 0..1 (what's not "available" to new programs). */
export function readRam() {
    const text = readFile('/proc/meminfo');
    if (!text)
        return null;
    const get = key => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? NaN);
    const total = get('MemTotal'), avail = get('MemAvailable');
    if (!(total > 0) || Number.isNaN(avail))
        return null;
    return Math.max(0, Math.min(1, 1 - avail / total));
}

export class LoadWatch {
    /**
     * @param {() => string} source returns 'ram' or 'cpu'
     * @param {(load: number) => void} callback load is 0..1
     */
    constructor(source, callback) {
        this._source = source;
        this._callback = callback;
        this._id = 0;
        this._lastCpu = null;
    }

    _sample() {
        if (this._source() === 'cpu') {
            const now = readCpu();
            const last = this._lastCpu;
            this._lastCpu = now;
            if (now && last) {
                const dt = now.total - last.total;
                if (dt > 0)
                    this._callback(Math.max(0, Math.min(1, 1 - (now.idle - last.idle) / dt)));
            }
        } else {
            const ram = readRam();
            if (ram !== null)
                this._callback(ram);
        }
    }

    start() {
        if (this._id)
            return;
        this._lastCpu = readCpu();
        this._sample();
        this._id = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, INTERVAL_S, () => {
            this._sample();
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
