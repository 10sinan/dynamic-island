// D-Bus entry point for the Claude Code hook (tools/di-claude-hook):
//   object  /org/gnome/Shell/Extensions/DynamicIsland  on the shell's own bus name
//   method  org.gnome.Shell.Extensions.DynamicIsland.ClaudeEvent(kind, project, message, pids, session)
// Only local processes of this user's session can call it; it just shows a
// notification in the island.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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
    <method name="ClaudePermission">
      <arg type="s" direction="in" name="project"/>
      <arg type="s" direction="in" name="tool"/>
      <arg type="s" direction="in" name="summary"/>
      <arg type="s" direction="in" name="pids"/>
      <arg type="s" direction="in" name="session"/>
      <arg type="s" direction="out" name="decision"/>
    </method>
  </interface>
</node>`;

export class ClaudeBridge {
    /**
     * @param {(ev) => void} onEvent
     * @param {(req: {project, tool, summary, pids, session}, reply: (d: 'allow'|'deny'|'ask') => void) => void} onPermission
     */
    constructor(onEvent, onPermission) {
        this._onEvent = onEvent;
        this._onPermission = onPermission;
        this._pending = new Set();
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

    /**
     * Answered later, when the user clicks (an "Async" method gets the
     * invocation). Whatever goes wrong the answer is 'ask': the caller (the
     * hook) then prints nothing and Claude Code shows its own dialog.
     */
    ClaudePermissionAsync(params, invocation) {
        const [project, tool, summary, pids, session] = params;
        let done = false;
        const reply = decision => {
            if (done)
                return;
            done = true;
            this._pending.delete(reply);
            const d = ['allow', 'deny'].includes(decision) ? decision : 'ask';
            try {
                invocation.return_value(new GLib.Variant('(s)', [d]));
            } catch {}
        };
        if (!this._onPermission) {
            reply('ask');
            return;
        }
        this._pending.add(reply);
        const req = {
            project: String(project).slice(0, 80),
            tool: String(tool).slice(0, 60),
            summary: String(summary).slice(0, 240),
            pids: String(pids).split(',').map(Number).filter(n => Number.isInteger(n) && n > 1).slice(0, 64),
            session: String(session).slice(0, 80),
        };
        try {
            this._onPermission(req, reply);
        } catch (e) {
            console.warn(`[dynamic-island] claude permission failed: ${e.message}`);
            reply('ask');
        }
    }

    destroy() {
        for (const reply of [...(this._pending ?? [])])
            reply('ask');   // nobody is left to click: back to Claude Code's own dialog
        this._onPermission = null;
        this._onEvent = null;
        try {
            this._obj?.unexport();
        } catch {}
        this._obj = null;
    }
}
