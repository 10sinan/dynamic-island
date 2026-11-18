// D-Bus entry point for the Claude Code hook (tools/di-claude-hook):
//   object  /org/gnome/Shell/Extensions/DynamicIsland  on the shell's own bus name
//   method  org.gnome.Shell.Extensions.DynamicIsland.ClaudeEvent(kind, project, message, pids, session)
// Only local processes of this user's session can call it; it just shows a
// notification in the island.
import Gio from 'gi://Gio';

export const OBJECT_PATH = '/org/gnome/Shell/Extensions/DynamicIsland';
const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.DynamicIsland">
    <method name="ClaudeEvent">
      <arg type="s" direction="in" name="kind"/>
      <arg type="s" direction="in" name="project"/>
      <arg type="s" direction="in" name="message"/>
      <arg type="s" direction="in" name="pids"/>
      <arg type="s" direction="in" name="session"/>
    </method>
  </interface>
</node>`;

export class ClaudeBridge {
    /** @param {(ev: {kind, project, message, pids: number[]}) => void} onEvent */
    constructor(onEvent) {
        this._onEvent = onEvent;
        this._obj = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._obj.export(Gio.DBus.session, OBJECT_PATH);
    }

    ClaudeEvent(kind, project, message, pids, session) {
        const ev = {
            kind: ['done', 'waiting', 'working'].includes(kind) ? kind : 'done',
            session: String(session).slice(0, 80),
            project: String(project).slice(0, 80),
            message: String(message).slice(0, 200),
            pids: String(pids).split(',').map(Number).filter(n => Number.isInteger(n) && n > 1).slice(0, 64),
        };
        try {
            this._onEvent?.(ev);
        } catch (e) {
            console.warn(`[dynamic-island] claude event failed: ${e.message}`);
        }
    }

    destroy() {
        this._onEvent = null;
        try {
            this._obj?.unexport();
        } catch {}
        this._obj = null;
    }
}
