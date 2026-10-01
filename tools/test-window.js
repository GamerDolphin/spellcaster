// A plain window for the headless test session.
// gjs -m tools/test-window.js "Title"
import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: null, flags: 32 /* NON_UNIQUE */});
app.connect('activate', () => {
    const w = new Gtk.ApplicationWindow({application: app, title: ARGV[0] ?? 'Test', default_width: 640, default_height: 420});
    const l = new Gtk.Label({label: `🪟 ${ARGV[0] ?? 'Test window'}`});
    l.add_css_class('title-1');
    w.set_child(l);
    w.present();
});
app.run([]);
