// Parses every extension file as an ES module and reports syntax errors.
// Run with: gjs -m tools/check-syntax.js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const root = GLib.build_filenamev([GLib.path_get_dirname(import.meta.url.replace('file://', '')), '..']);
const dec = new TextDecoder();
let bad = 0;
function walk(dir) {
    const e = Gio.File.new_for_path(dir).enumerate_children('standard::*', 0, null);
    let info;
    while ((info = e.next_file(null))) {
        const p = GLib.build_filenamev([dir, info.get_name()]);
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            if (!info.get_name().startsWith('.'))
                walk(p);
        } else if (p.endsWith('.js')) {
            const src = dec.decode(GLib.file_get_contents(p)[1]);
            try {
                Reflect.parse(src, {target: 'module'});
            } catch (err) {
                bad++;
                print(`✗ ${p}: ${err}`);
            }
        }
    }
}
walk(decodeURIComponent(root));
print(bad ? `${bad} file(s) with syntax errors` : 'All files parse OK');
if (bad)
    imports.system.exit(1);
