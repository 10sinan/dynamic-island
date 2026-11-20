// The list behind the clipboard history: newest first, at most `limit`
// entries, and copying something that is already in the list moves it to the
// top instead of adding a duplicate. No GNOME imports: unit-tested with gjs.

export class ClipList {
    constructor(limit = 10) {
        this._limit = limit;
        this._items = [];
    }

    get items() {
        return this._items;
    }

    /** @param {{key: string}} item  `key` identifies equal content */
    add(item) {
        const i = this._items.findIndex(x => x.key === item.key);
        if (i === 0)
            return this._items[0];   // already the newest: nothing changes
        if (i > 0)
            this._items.splice(i, 1);
        this._items.unshift({...item, at: item.at ?? Date.now()});
        if (this._items.length > this._limit)
            this._items.length = this._limit;
        return this._items[0];
    }

    remove(key) {
        const i = this._items.findIndex(x => x.key === key);
        if (i >= 0)
            this._items.splice(i, 1);
    }

    clear() {
        this._items = [];
    }
}

/** Clipboard formats that password managers use to say "this is secret". */
const SECRET_MIMES = ['x-kde-passwordmanagerhint', 'application/x-nspasswordmanager', 'x-nspasswordmanager'];

export function isSecret(mimetypes) {
    return mimetypes.some(m => SECRET_MIMES.includes(m.toLowerCase()));
}

/** What to store for a clipboard offering these formats: 'text' | 'image' | null. */
export function pickKind(mimetypes) {
    if (isSecret(mimetypes))
        return null;
    if (mimetypes.some(m => /^text\/plain/.test(m) || m === 'UTF8_STRING' || m === 'STRING' || m === 'text/plain;charset=utf-8'))
        return 'text';
    if (mimetypes.includes('image/png'))
        return 'image';
    return null;
}

/** One line for the list: whitespace collapsed, cut at `max` characters. */
export function oneLine(text, max = 110) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
